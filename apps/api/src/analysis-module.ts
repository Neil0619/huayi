import {
  analysisEventReadSchema,
  startAnalysisGenerationRequestSchema,
  captureAnalysisGenerationRequestSchema,
  type AnalysisEventRead,
  type StartAnalysisGenerationRequest,
  type AnalysisContentRead,
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
import { analysisSourceUnits } from "./analysis-segmentation.js";
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
import { modelEvents } from "./model-events.js";
import type { ModelExecution } from "./model-execution.js";
import type { DeepSeekPriceSchedule, DeepSeekPriceSnapshot } from "./deepseek-price-schedule.js";
import { replaceCandidateAliases } from "./analysis-candidate-ids.js";
import { assembleTrustedContent, createAnalysisRecord } from "./analysis-trusted-content.js";

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
  reservedCostMicroUsd?: (input: StartAnalysisGenerationRequest) => number;
  studyCaptures: StudyCaptureReader;
}

interface CaptureContext {
  captureId: string;
  expectedRevision: number;
  intent: "initial" | "reanalysis";
  source: AnalysisContentRead["source"];
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

  async function prepareAnalysis(
    command: {
      execution?: ModelExecution;
      idempotencyKey: string;
      input: StartAnalysisGenerationRequest;
      userId: string;
    },
    capture?: CaptureContext,
  ): Promise<AsyncIterable<AnalysisEventRead>> {
    const input = startAnalysisGenerationRequestSchema.parse(command.input);
    const sentences = analysisSourceUnits(input);
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
                  ...("outputContract" in input ? { outputContract: input.outputContract } : {}),
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
        analysisEventReadSchema.parse({
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
    command: {
      execution?: ModelExecution;
      idempotencyKey: string;
      input: StartAnalysisGenerationRequest;
      userId: string;
    };
    input: StartAnalysisGenerationRequest;
    reservation: { id: string };
    sentences: SegmentedSentence[];
    dispatchPricing?: DeepSeekPriceSnapshot;
    capture?: CaptureContext;
  }): AsyncIterable<AnalysisEventRead> {
    const { capture, claim, command, dispatchPricing, input, reservation, sentences } = context;
    let generatedBilling:
      | {
          actualCostMicroUsd?: number;
          billedCalls?: readonly AnalysisBilledCall[];
          usage?: ModelUsage;
        }
      | undefined;
    yield analysisEventReadSchema.parse({
      requestId: claim.requestId,
      unitCount: sentences.length,
      type: "analysis.started",
    });
    try {
      const model =
        dispatchPricing === undefined || dependencies.modelForPricing === undefined
          ? dependencies.model
          : dependencies.modelForPricing(dispatchPricing);
      const generated = yield* modelEvents((emit: (event: AnalysisEventRead) => void) =>
        model.analyze({
          ...command.execution,
          input,
          sentences,
          onPreview: (preview) =>
            emit(
              analysisEventReadSchema.parse({
                requestId: claim.requestId,
                section: "overall",
                text: preview.text,
                type: "analysis.preview",
              }),
            ),
        }),
      );
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
        const preview = analysisEventReadSchema.parse({
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
      if (content.result.type === "sentence-passage-analysis-v3") {
        for (const { analysisUnitId, ordinal, sourceText, sentenceStructure } of content.result
          .sentences)
          yield analysisEventReadSchema.parse({
            type: "analysis.structure",
            requestId: claim.requestId,
            unit: { analysisUnitId, ordinal, sourceText, sentenceStructure },
          });
      }
      const committed = await dependencies.committer.complete({
        ...generatedBilling,
        record: createAnalysisRecord(
          content,
          dependencies.ids(),
          dependencies.clock.now().toISOString(),
        ),
        leaseToken: claim.leaseToken,
        ...(dispatchPricing === undefined
          ? {}
          : { priceVersionId: dispatchPricing.priceVersionId }),
        requestId: claim.requestId,
        reservationId: reservation.id,
        userId: command.userId,
      });
      const completed = analysisEventReadSchema.parse({
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
    execution?: ModelExecution;
    idempotencyKey: string;
    input: StartAnalysisGenerationRequest;
    userId: string;
  }): AsyncIterable<AnalysisEventRead> {
    yield* await preparePlatformAnalysis(command);
  }

  async function preparePlatformAnalysis(command: {
    execution?: ModelExecution;
    idempotencyKey: string;
    input: StartAnalysisGenerationRequest;
    userId: string;
  }) {
    return prepareAnalysis(command);
  }

  async function prepareStudyCaptureAnalysis(command: {
    execution?: ModelExecution;
    captureId: string;
    idempotencyKey: string;
    input: unknown;
    userId: string;
  }) {
    const request = captureAnalysisGenerationRequestSchema.parse(command.input);
    const detail = await dependencies.studyCaptures.get(command.userId, command.captureId);
    if (detail === null) throw new CloudFault("not_found", "StudyCapture not found.");
    const input = startAnalysisGenerationRequestSchema.parse({
      ...("outputContract" in request ? { outputContract: request.outputContract } : {}),
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
      {
        ...(command.execution ? { execution: command.execution } : {}),
        idempotencyKey: command.idempotencyKey,
        input,
        userId: command.userId,
      },
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

async function* replay(event: AnalysisEventRead): AsyncIterable<AnalysisEventRead> {
  yield structuredClone(event);
}

export type AnalysisModule = ReturnType<typeof createAnalysisModule>;
