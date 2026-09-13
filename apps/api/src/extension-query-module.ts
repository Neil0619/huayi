import {
  extensionQueryEventReadSchema,
  extensionQueryGenerationReadSchema,
  extensionQueryGenerationRequestSchema,
  type ExtensionQueryEventRead,
  type ExtensionQueryGenerationRequest,
} from "@huayi/cloud-contracts";
import { createHash } from "node:crypto";

import { CloudFault } from "./cloud-fault.js";
import { modelEvents } from "./model-events.js";
import { validateQueryGenerationResult } from "./query-generation-result.js";
import { modelUsageFromError } from "./analysis-error-mapping.js";
import type { ModelExecution } from "./model-execution.js";
import type {
  ExtensionQueryModel,
  ExtensionQueryQuota,
  ExtensionQueryStore,
} from "./extension-query-ports.js";
import type { DeepSeekPriceSchedule, DeepSeekPriceSnapshot } from "./deepseek-price-schedule.js";

const GENERATION_TTL_MS = 60 * 60 * 1_000;
const GENERATION_LEASE_MS = 2 * 60 * 1_000;

interface Dependencies {
  readonly ids: () => string;
  readonly model: ExtensionQueryModel;
  readonly modelForPricing?: (pricing: DeepSeekPriceSnapshot) => ExtensionQueryModel;
  readonly now: () => Date;
  readonly priceVersionId?: string;
  readonly pricing?: DeepSeekPriceSchedule;
  readonly quota: ExtensionQueryQuota;
  readonly reservedCostMicroUsd: (input: ExtensionQueryGenerationRequest) => number;
  readonly store: ExtensionQueryStore;
}

function failure(error: unknown, requestId: string) {
  const code =
    error instanceof Error && "code" in error && error.code === "model_output_invalid"
      ? "model_output_invalid"
      : "model_unavailable";
  return {
    code,
    message:
      code === "model_output_invalid"
        ? "The model output was invalid."
        : "The model is temporarily unavailable.",
    requestId,
  } as const;
}

async function* replay(
  ...events: ExtensionQueryEventRead[]
): AsyncIterable<ExtensionQueryEventRead> {
  for (const event of events) yield structuredClone(event);
}

export function createExtensionQueryModule(dependencies: Dependencies) {
  async function prepare(command: {
    execution?: ModelExecution;
    idempotencyKey: string;
    input: ExtensionQueryGenerationRequest;
    userId: string;
  }): Promise<AsyncIterable<ExtensionQueryEventRead>> {
    const input = extensionQueryGenerationRequestSchema.parse(command.input);
    const now = dependencies.now();
    const id = dependencies.ids();
    const leaseToken = dependencies.ids();
    const claim = await dependencies.store.begin({
      expiresAt: new Date(now.getTime() + GENERATION_TTL_MS),
      id,
      idempotencyKey: command.idempotencyKey,
      input,
      leaseExpiresAt: new Date(now.getTime() + GENERATION_LEASE_MS),
      leaseToken,
      requestHash: createHash("sha256").update(JSON.stringify(input)).digest("hex"),
      userId: command.userId,
    });
    const started = extensionQueryEventReadSchema.parse({
      generationId: claim.id,
      type: "query.started",
    });
    if (claim.kind === "running") return replay(started);
    if (claim.kind === "terminal") return replay(started, claim.event);
    if (claim.kind === "expired") {
      return replay(started, await dependencies.store.abandon(command.userId, claim.id));
    }
    let reservation: { id: string };
    try {
      reservation = await dependencies.quota.reserve({
        ...(dependencies.pricing === undefined
          ? {}
          : { pricing: dependencies.pricing.reservation }),
        requestId: claim.id,
        reservedMicroUsd: dependencies.reservedCostMicroUsd(input),
        userId: command.userId,
      });
      await dependencies.store.attachReservation({
        id: claim.id,
        leaseToken: claim.leaseToken,
        ...(dependencies.priceVersionId === undefined
          ? {}
          : { priceVersionId: dependencies.priceVersionId }),
        reservationId: reservation.id,
        userId: command.userId,
      });
    } catch (error) {
      const detail =
        error instanceof CloudFault && error.code === "quota_exhausted"
          ? { code: "quota_exhausted" as const, message: error.message, requestId: claim.id }
          : failure(error, claim.id);
      await dependencies.store.terminalizeWithoutReservation({
        error: detail,
        id: claim.id,
        leaseToken: claim.leaseToken,
        quota: await dependencies.quota.summary(command.userId),
        userId: command.userId,
      });
      throw error;
    }
    return execute({ claim, command, input, reservation, started });
  }

  async function* execute(context: {
    claim: { id: string; kind: "acquired"; leaseToken: string };
    command: {
      execution?: ModelExecution;
      idempotencyKey: string;
      input: ExtensionQueryGenerationRequest;
      userId: string;
    };
    input: ExtensionQueryGenerationRequest;
    reservation: { id: string };
    started: ExtensionQueryEventRead;
  }): AsyncIterable<ExtensionQueryEventRead> {
    yield context.started;
    const dispatchedAt = dependencies.now();
    const dispatchPricing = dependencies.pricing?.at(dispatchedAt);
    let generatedBilling:
      | Pick<
          Awaited<ReturnType<ExtensionQueryModel["run"]>>,
          "billedCalls" | "costMicroUsd" | "usage"
        >
      | undefined = {
      costMicroUsd: 0,
      usage: { cachedInputTokens: 0, inputTokens: 0, outputTokens: 0 },
    };
    let sequence = 0;
    try {
      await dependencies.store.markDispatched({
        ...(dispatchPricing === undefined ? {} : { dispatchedAt, pricing: dispatchPricing }),
        id: context.claim.id,
        leaseToken: context.claim.leaseToken,
        userId: context.command.userId,
      });
      const model =
        dispatchPricing === undefined || dependencies.modelForPricing === undefined
          ? dependencies.model
          : dependencies.modelForPricing(dispatchPricing);
      generatedBilling = undefined;
      const generated = yield* modelEvents((emit: (event: ExtensionQueryEventRead) => void) =>
        model.run(context.input, context.claim.id, {
          ...context.command.execution,
          onPreview: (update) =>
            emit(
              extensionQueryEventReadSchema.parse({
                generationId: context.claim.id,
                type: "query.preview-v2",
                version: 2,
                update: { ...update, sequence: sequence++ },
              }),
            ),
        }),
      );
      generatedBilling = {
        ...(generated.billedCalls === undefined ? {} : { billedCalls: generated.billedCalls }),
        costMicroUsd:
          generated.billedCalls?.reduce((sum, call) => sum + call.costMicroUsd, 0) ??
          generated.costMicroUsd,
        usage: generated.usage,
      };
      const result = validateQueryGenerationResult(generated.result, context.input);
      if (result.type === "explain-sentence-v2") {
        for (const unit of result.sentenceStructures)
          yield extensionQueryEventReadSchema.parse({
            type: "query.structure",
            generationId: context.claim.id,
            sequence: sequence++,
            unit,
          });
      }
      yield await dependencies.store.complete({
        ...generatedBilling,
        id: context.claim.id,
        leaseToken: context.claim.leaseToken,
        ...(dispatchPricing === undefined
          ? {}
          : { priceVersionId: dispatchPricing.priceVersionId }),
        reservationId: context.reservation.id,
        result,
        usage: generated.usage,
        userId: context.command.userId,
      });
    } catch (error) {
      const failureUsage = modelUsageFromError(error);
      const value = generatedBilling ?? {
        billedCalls: failureUsage.billedCalls,
        usage: failureUsage.usage,
        costMicroUsd: failureUsage.usageCostMicroUsd,
      };
      yield await dependencies.store.fail({
        ...(value.billedCalls === undefined ? {} : { billedCalls: value.billedCalls }),
        ...(value.costMicroUsd === undefined ? {} : { costMicroUsd: value.costMicroUsd }),
        error: failure(error, context.claim.id),
        id: context.claim.id,
        leaseToken: context.claim.leaseToken,
        ...(dispatchPricing === undefined
          ? {}
          : { priceVersionId: dispatchPricing.priceVersionId }),
        reservationId: context.reservation.id,
        ...(value.usage === undefined ? {} : { usage: value.usage }),
        userId: context.command.userId,
      });
    }
  }

  return {
    get: async (userId: string, id: string) =>
      extensionQueryGenerationReadSchema
        .nullable()
        .parse(await dependencies.store.find(userId, id)),
    prepare,
  };
}

export type ExtensionQueryModule = ReturnType<typeof createExtensionQueryModule>;
