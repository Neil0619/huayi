import {
  analysisEventSchema,
  startAnalysisRequestSchema,
  studyCaptureAnalyzeRequestSchema,
  type AnalysisEvent,
  type AnalysisRecord,
  type StartAnalysisRequest,
  type AnalysisContent,
  type ModelUsage,
} from "@huayi/cloud-contracts";
import { createHash } from "node:crypto";

import type {
  AnalysisCommitter,
  AnalysisBilledCall,
  AnalysisModel,
  AnalysisQuota,
  AnalysisRequestLifecycle,
  AnalysisRepository,
  SegmentedSentence,
  StudyCaptureReader,
} from "./analysis-ports.js";
import type { Clock } from "./security.js";
import { segmentSentences } from "./analysis-segmentation.js";
import { ANALYSIS_GENERATION_LEASE_MS } from "./analysis-timeouts.js";
import {
  modelUsageFromError,
  publicAnalysisError,
  publicModelErrorCode,
  publicModelErrorMessage,
} from "./analysis-error-mapping.js";
import { createAnalysisHistoryModule } from "./analysis-history-module.js";
import { createCandidateConfirmationModule } from "./candidate-confirmation-module.js";
import { CloudFault } from "./cloud-fault.js";
import type { DeepSeekPriceSchedule, DeepSeekPriceSnapshot } from "./deepseek-price-schedule.js";
import { replaceCandidateAliases } from "./analysis-candidate-ids.js";
import { assembleTrustedContent } from "./analysis-trusted-content.js";

export { segmentSentences } from "./analysis-segmentation.js";

interface AnalysisDependencies {
  clock: Clock;
  committer: AnalysisCommitter;
  cursorKey: Uint8Array;
  ids: () => string;
  model: AnalysisModel;
  modelForPricing?: (pricing: DeepSeekPriceSnapshot) => AnalysisModel;
  priceVersionId?: string;
  pricing?: DeepSeekPriceSchedule;
  quota: AnalysisQuota;
  requestLifecycle: AnalysisRequestLifecycle;
  repository: AnalysisRepository;
  reservedCostMicroUsd?: (input: StartAnalysisRequest) => number;
  studyCaptures: StudyCaptureReader;
}

interface CaptureContext {
  captureId: string;
  expectedRevision: number;
  intent: "initial" | "reanalysis";
  source: AnalysisContent["source"];
}

export function createAnalysisModule(dependencies: AnalysisDependencies) {
  const history = createAnalysisHistoryModule({
    clock: dependencies.clock,
    cursorKey: dependencies.cursorKey,
    repository: dependencies.repository,
  });
  const confirmations = createCandidateConfirmationModule({
    clock: dependencies.clock,
    ids: dependencies.ids,
    repository: dependencies.repository,
  });

  function record(content: AnalysisContent, id: string): AnalysisRecord {
    const now = dependencies.clock.now().toISOString();
    return {
      ...content,
      archivedAt: null,
      createdAt: now,
      id,
      reviewState: "pendingReview",
      revision: 1,
      updatedAt: now,
    };
  }

  async function prepareAnalysis(
    command: {
      idempotencyKey: string;
      input: StartAnalysisRequest;
      userId: string;
    },
    capture?: CaptureContext,
  ): Promise<AsyncIterable<AnalysisEvent>> {
    const input = startAnalysisRequestSchema.parse(command.input);
    const sentences = segmentSentences(input.sourceText);
    const requestId = dependencies.ids();
    const leaseToken = dependencies.ids();
    const recoveryLedgerId = dependencies.ids();
    const begin = {
      idempotencyKey: command.idempotencyKey,
      leaseExpiresAt: new Date(dependencies.clock.now().getTime() + ANALYSIS_GENERATION_LEASE_MS),
      leaseToken,
      requestHash: createHash("sha256")
        .update(
          JSON.stringify(
            capture === undefined
              ? input
              : {
                  captureId: capture.captureId,
                  expectedRevision: capture.expectedRevision,
                  intent: capture.intent,
                },
          ),
        )
        .digest("hex"),
      requestId,
      recoveryLedgerId,
      unitCount: sentences.length,
      userId: command.userId,
    };
    const claim =
      capture === undefined
        ? await dependencies.requestLifecycle.begin(begin)
        : await dependencies.requestLifecycle.beginCapture({
            ...begin,
            captureId: capture.captureId,
            expectedRevision: capture.expectedRevision,
            intent: capture.intent,
          });
    if (claim.kind === "terminal") return replay(claim.event);
    if (claim.kind === "running") {
      return replay(
        analysisEventSchema.parse({
          requestId: claim.requestId,
          unitCount: claim.unitCount,
          type: "analysis.started",
        }),
      );
    }
    let reservation: { id: string };
    let dispatchPricing: DeepSeekPriceSnapshot | undefined;
    try {
      reservation = await dependencies.quota.reserve({
        ...(dependencies.pricing === undefined
          ? {}
          : { pricing: dependencies.pricing.reservation }),
        requestId: claim.requestId,
        reservedMicroUsd: dependencies.reservedCostMicroUsd?.(input) ?? 100_000,
        userId: command.userId,
      });
      await dependencies.requestLifecycle.attachReservation({
        leaseToken: claim.leaseToken,
        ...(dependencies.priceVersionId === undefined
          ? {}
          : { priceVersionId: dependencies.priceVersionId }),
        requestId: claim.requestId,
        reservationId: reservation.id,
        userId: command.userId,
      });
      if (dependencies.pricing !== undefined) {
        const dispatchedAt = dependencies.clock.now();
        dispatchPricing = dependencies.pricing.at(dispatchedAt);
        if (dependencies.requestLifecycle.markDispatched === undefined) {
          throw new Error("Analysis dispatch pricing is unavailable.");
        }
        await dependencies.requestLifecycle.markDispatched({
          dispatchedAt,
          leaseToken: claim.leaseToken,
          pricing: dispatchPricing,
          requestId: claim.requestId,
          userId: command.userId,
        });
      }
    } catch (error) {
      const publicError = publicAnalysisError(error, claim.requestId);
      await dependencies.requestLifecycle.terminalizeWithoutReservation({
        error: publicError,
        leaseToken: claim.leaseToken,
        quota: await dependencies.quota.summary(command.userId),
        requestId: claim.requestId,
        userId: command.userId,
      });
      throw error;
    }
    return executeAcquired({
      claim,
      command,
      input,
      reservation,
      sentences,
      ...(dispatchPricing === undefined ? {} : { dispatchPricing }),
      ...(capture === undefined ? {} : { capture }),
    });
  }

  async function* executeAcquired(context: {
    claim: Extract<Awaited<ReturnType<AnalysisRequestLifecycle["begin"]>>, { kind: "acquired" }>;
    command: { idempotencyKey: string; input: StartAnalysisRequest; userId: string };
    input: StartAnalysisRequest;
    reservation: { id: string };
    sentences: SegmentedSentence[];
    dispatchPricing?: DeepSeekPriceSnapshot;
    capture?: CaptureContext;
  }): AsyncIterable<AnalysisEvent> {
    const { capture, claim, command, dispatchPricing, input, reservation, sentences } = context;
    let generatedBilling:
      | {
          actualCostMicroUsd?: number;
          billedCalls?: readonly AnalysisBilledCall[];
          usage?: ModelUsage;
        }
      | undefined;
    yield analysisEventSchema.parse({
      requestId: claim.requestId,
      unitCount: sentences.length,
      type: "analysis.started",
    });
    try {
      const model =
        dispatchPricing === undefined || dependencies.modelForPricing === undefined
          ? dependencies.model
          : dependencies.modelForPricing(dispatchPricing);
      const generated = await model.analyze({ input, sentences });
      const actualCostMicroUsd = generated.billedCalls?.reduce(
        (total, call) => total + call.costMicroUsd,
        0,
      );
      generatedBilling = {
        ...(actualCostMicroUsd === undefined && generated.usageCostMicroUsd === undefined
          ? {}
          : { actualCostMicroUsd: actualCostMicroUsd ?? generated.usageCostMicroUsd }),
        ...(generated.billedCalls === undefined ? {} : { billedCalls: generated.billedCalls }),
        ...(generated.usage === undefined ? {} : { usage: generated.usage }),
      };
      if (generated.preview !== undefined) {
        const preview = analysisEventSchema.parse({
          requestId: claim.requestId,
          section: "overall",
          text: generated.preview,
          type: "analysis.preview",
        });
        yield preview;
      }
      const content = replaceCandidateAliases(
        assembleTrustedContent(generated.content, input, sentences, capture),
        dependencies.ids,
      );
      const committed = await dependencies.committer.complete({
        ...generatedBilling,
        record: record(content, dependencies.ids()),
        leaseToken: claim.leaseToken,
        ...(dispatchPricing === undefined
          ? {}
          : { priceVersionId: dispatchPricing.priceVersionId }),
        requestId: claim.requestId,
        reservationId: reservation.id,
        userId: command.userId,
      });
      const completed = analysisEventSchema.parse({
        analysis: committed.record,
        quota: committed.quota,
        type: "analysis.completed",
      });
      yield completed;
    } catch (modelError) {
      const failureUsage = modelUsageFromError(modelError);
      const actualCostMicroUsd =
        generatedBilling?.actualCostMicroUsd ?? failureUsage.usageCostMicroUsd;
      const billedCalls = generatedBilling?.billedCalls ?? failureUsage.billedCalls;
      const usage = generatedBilling?.usage ?? failureUsage.usage;
      const errorCode = publicModelErrorCode(modelError);
      const error = {
        code: errorCode,
        message: publicModelErrorMessage(errorCode),
        requestId: claim.requestId,
      };
      const failed = await dependencies.committer.fail({
        ...(actualCostMicroUsd === undefined ? {} : { actualCostMicroUsd }),
        ...(billedCalls === undefined ? {} : { billedCalls }),
        error,
        leaseToken: claim.leaseToken,
        ...(dispatchPricing === undefined
          ? {}
          : { priceVersionId: dispatchPricing.priceVersionId }),
        requestId: claim.requestId,
        reservationId: reservation.id,
        ...(usage === undefined ? {} : { usage }),
        userId: command.userId,
      });
      yield failed;
    }
  }

  async function* startPlatformAnalysis(command: {
    idempotencyKey: string;
    input: StartAnalysisRequest;
    userId: string;
  }): AsyncIterable<AnalysisEvent> {
    yield* await preparePlatformAnalysis(command);
  }

  async function preparePlatformAnalysis(command: {
    idempotencyKey: string;
    input: StartAnalysisRequest;
    userId: string;
  }) {
    return prepareAnalysis(command);
  }

  async function prepareStudyCaptureAnalysis(command: {
    captureId: string;
    idempotencyKey: string;
    input: unknown;
    userId: string;
  }) {
    const request = studyCaptureAnalyzeRequestSchema.parse(command.input);
    const detail = await dependencies.studyCaptures.get(command.userId, command.captureId);
    if (detail === null) throw new CloudFault("not_found", "StudyCapture not found.");
    const input = startAnalysisRequestSchema.parse({
      selectionKind: detail.capture.kind,
      source: {
        ...(detail.capture.title === undefined ? {} : { title: detail.capture.title }),
        type: "manual",
        ...(detail.capture.userContext === undefined
          ? {}
          : { userContext: detail.capture.userContext }),
      },
      sourceText: detail.capture.sourceText,
    });
    return prepareAnalysis(
      { idempotencyKey: command.idempotencyKey, input, userId: command.userId },
      {
        captureId: command.captureId,
        expectedRevision: request.expectedRevision,
        intent: request.intent,
        source: {
          ...(detail.capture.title === undefined ? {} : { title: detail.capture.title }),
          type: "study-capture",
          ...(detail.capture.userContext === undefined
            ? {}
            : { userContext: detail.capture.userContext }),
        },
      },
    );
  }

  return {
    ...confirmations,
    ...history,
    getRequestStatus: (userId: string, requestId: string) =>
      dependencies.requestLifecycle.get(userId, requestId),
    preparePlatformAnalysis,
    prepareStudyCaptureAnalysis,
    startPlatformAnalysis,
  };
}

async function* replay(event: AnalysisEvent): AsyncIterable<AnalysisEvent> {
  yield structuredClone(event);
}

export type AnalysisModule = ReturnType<typeof createAnalysisModule>;
