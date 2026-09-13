import {
  learningTaskPayloadSchema,
  type LearningTaskPayloadRead,
  type PracticeSession,
} from "@huayi/cloud-contracts";
import type { AnalysisModule } from "./analysis-module.js";
import type { DialoguePracticeModule } from "./dialogue-practice-module.js";
import type { ExtensionQueryModule } from "./extension-query-module.js";
import type { LearningLibraryMaintenance } from "./learning-library-maintenance.js";
import type { LearningTaskLease } from "./learning-task-store.js";
import { modelEvents } from "./model-events.js";
import type { ModelExecution } from "./model-execution.js";
import type { PracticeModule } from "./practice-module.js";
import { validateTaskGeneration } from "./generation-snapshot.js";
import type { PracticeReference } from "./practice-reference.js";
import { CloudFault } from "./cloud-fault.js";

export type LearningTaskExecutor = (
  job: LearningTaskLease,
  execution: ModelExecution,
) => AsyncIterable<LearningTaskPayloadRead>;
export function createLearningTaskExecutor(options: {
  analysis: Pick<AnalysisModule, "preparePlatformAnalysis" | "prepareStudyCaptureAnalysis">;
  query: Pick<ExtensionQueryModule, "prepare">;
  practice: Pick<PracticeModule, "startSentence" | "submitAttempt" | "retryFeedback">;
  dialogue: Pick<
    DialoguePracticeModule,
    "startDialogue" | "submitTurn" | "finish" | "retryAssistant"
  >;
  maintenance: Pick<LearningLibraryMaintenance, "suggestions">;
  reference?: Pick<PracticeReference, "generate">;
}): LearningTaskExecutor {
  return async function* execute(job, execution) {
    const { command: c, ownerUserId: owner, id: key } = job;
    validateTaskGeneration(c, job.generationSnapshot);
    const common = { userId: owner, idempotencyKey: key, execution };
    if (c.kind === "instant-query") {
      yield* await options.query.prepare({ ...common, input: c.input });
      return;
    }
    if (c.kind === "analysis") {
      yield* await options.analysis.preparePlatformAnalysis({
        ...common,
        input: c.input,
      });
      return;
    }
    if (c.kind === "capture-analysis") {
      yield* await options.analysis.prepareStudyCaptureAnalysis({
        ...common,
        captureId: c.captureId,
        input: c.input,
      });
      return;
    }
    if (c.kind === "duplicate-suggestions") {
      yield {
        type: "duplicates.completed",
        result: await options.maintenance.suggestions(owner, c.itemId, key, c.input, execution),
      };
      return;
    }
    const session = yield* modelEvents<LearningTaskPayloadRead, PracticeSession>(async (emit) => {
      const run: ModelExecution = {
        ...execution,
        onSession(session) {
          emit({ type: "practice.updated", session });
        },
        onPreview(preview) {
          const parsed = learningTaskPayloadSchema.safeParse({
            type: "practice.preview",
            ...preview,
          });
          if (parsed.success) emit(parsed.data);
        },
      };
      switch (c.kind) {
        case "sentence-reference":
          if (!options.reference)
            throw new CloudFault("model_unavailable", "Reference practice is unavailable.");
          return options.reference.generate(owner, c.sessionId, c.input, key, run);
        case "sentence-start":
          return options.practice.startSentence(owner, key, c.input, run, c.sessionId);
        case "sentence-submit":
          return options.practice.submitAttempt(owner, c.sessionId, key, c.input, run);
        case "sentence-feedback-retry":
          return options.practice.retryFeedback(owner, c.sessionId, c.attemptId, key, c.input, run);
        case "dialogue-start":
          return options.dialogue.startDialogue(owner, key, c.input, run);
        case "dialogue-turn":
          return options.dialogue.submitTurn(owner, c.sessionId, key, c.input, run);
        case "dialogue-finish":
          return options.dialogue.finish(owner, c.sessionId, key, c.input, run);
        case "dialogue-retry":
          return options.dialogue.retryAssistant(owner, c.sessionId, key, c.input, run);
      }
    });
    yield { type: "practice.updated", session };
  };
}
