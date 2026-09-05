import {
  extensionQueryEventSchema,
  extensionQueryGenerationSchema,
  extensionQueryRequestSchema,
  storeAnalysisResultSchema,
  type ExtensionQueryEvent,
  type ExtensionQueryRequest,
} from "@huayi/cloud-contracts";
import { createHash } from "node:crypto";

import { CloudFault } from "./cloud-fault.js";
import { modelEvents } from "./model-events.js";
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
  readonly reservedCostMicroUsd: (input: ExtensionQueryRequest) => number;
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

async function* replay(...events: ExtensionQueryEvent[]): AsyncIterable<ExtensionQueryEvent> {
  for (const event of events) yield structuredClone(event);
}

export function createExtensionQueryModule(dependencies: Dependencies) {
  async function prepare(command: {
    execution?: ModelExecution;
    idempotencyKey: string;
    input: ExtensionQueryRequest;
    userId: string;
  }): Promise<AsyncIterable<ExtensionQueryEvent>> {
    const input = extensionQueryRequestSchema.parse(command.input);
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
    const started = extensionQueryEventSchema.parse({
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
      input: ExtensionQueryRequest;
      userId: string;
    };
    input: ExtensionQueryRequest;
    reservation: { id: string };
    started: ExtensionQueryEvent;
  }): AsyncIterable<ExtensionQueryEvent> {
    yield context.started;
    const dispatchedAt = dependencies.now();
    const dispatchPricing = dependencies.pricing?.at(dispatchedAt);
    await dependencies.store.markDispatched({
      ...(dispatchPricing === undefined ? {} : { dispatchedAt, pricing: dispatchPricing }),
      id: context.claim.id,
      leaseToken: context.claim.leaseToken,
      userId: context.command.userId,
    });
    try {
      const model =
        dispatchPricing === undefined || dependencies.modelForPricing === undefined
          ? dependencies.model
          : dependencies.modelForPricing(dispatchPricing);
      const generated = yield* modelEvents((emit: (event: ExtensionQueryEvent) => void) =>
        model.run(context.input, context.claim.id, {
          ...context.command.execution,
          onPreview: (update) =>
            emit(
              extensionQueryEventSchema.parse({
                generationId: context.claim.id,
                type: "query.preview-v2",
                version: 2,
                update,
              }),
            ),
        }),
      );
      const result = storeAnalysisResultSchema.parse(generated.result);
      yield await dependencies.store.complete({
        ...(generated.billedCalls === undefined ? {} : { billedCalls: generated.billedCalls }),
        costMicroUsd: generated.costMicroUsd,
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
      const value = error as {
        billedCalls?: readonly { costMicroUsd: number; usage: never }[];
        usage?: never;
        usageCostMicroUsd?: number;
      };
      yield await dependencies.store.fail({
        ...(value.billedCalls === undefined ? {} : { billedCalls: value.billedCalls }),
        ...(value.usageCostMicroUsd === undefined ? {} : { costMicroUsd: value.usageCostMicroUsd }),
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
      extensionQueryGenerationSchema.nullable().parse(await dependencies.store.find(userId, id)),
    prepare,
  };
}

export type ExtensionQueryModule = ReturnType<typeof createExtensionQueryModule>;
