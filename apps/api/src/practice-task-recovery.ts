import { randomUUID } from "node:crypto";
import type { AnalysisDatabase } from "./analysis-database.js";
import { practiceGenerationOutputSchema } from "./paid-practice-generator.js";
import { createPostgresPracticeRepository } from "./postgres-practice-repository.js";
import { createPostgresDialoguePracticeRepository } from "./postgres-dialogue-practice-repository.js";
import { loadPracticeSession } from "./postgres-practice-view.js";
interface Recovery {
  task_id: string;
  owner_id: string;
  operation: string;
  request_hash: string;
  session_id: string;
  generation_id: string;
  attempt_id: string | null;
  lease_token: string;
  output: unknown;
}
/** Apply already billed, validated output through its authoritative domain repository.
 * No provider, quota reservation, or generation acquisition is reachable from here. */
export function createPracticeTaskRecovery(database: AnalysisDatabase) {
  const practice = createPostgresPracticeRepository(database);
  const dialogue = createPostgresDialoguePracticeRepository(database);
  return async () => {
    const ready = await database.trusted((query) =>
      query.rows<Recovery>("SELECT * FROM huayi_private.ready_learning_task_recoveries()"),
    );
    for (const item of ready) {
      const common = {
        generationId: item.generation_id,
        generationLeaseToken: item.lease_token,
        idempotencyKey: item.task_id,
        now: new Date().toISOString(),
        ownerUserId: item.owner_id,
        requestHash: item.request_hash,
        sessionId: item.session_id,
      };
      try {
        const output = practiceGenerationOutputSchema.parse(item.output);
        switch (output.kind) {
          case "sentence-prompt":
            await practice.completeSentencePrompt({ ...common, prompt: output.prompt });
            break;
          case "sentence-feedback":
            if (
              !item.attempt_id ||
              !["practice.attempt", "practice.feedback-retry"].includes(item.operation)
            )
              continue;
            await practice.completeFeedback({
              ...common,
              attemptId: item.attempt_id,
              feedback: output.feedback,
              feedbackLeaseToken: item.lease_token,
              operation:
                item.operation === "practice.attempt"
                  ? "practice.attempt"
                  : "practice.feedback-retry",
            });
            break;
          case "dialogue-start":
            await dialogue.completeStart({
              ...common,
              opener: output.opener,
              openerTurnId: randomUUID(),
              plan: output.plan,
              prompt: output.prompt,
            });
            break;
          case "dialogue-assistant":
            if (
              !["practice.dialogue-turn", "practice.dialogue-assistant-retry"].includes(
                item.operation,
              )
            )
              continue;
            await dialogue.completeAssistant({
              ...common,
              assistantTurn: output.assistantTurn,
              turnId: randomUUID(),
              operation:
                item.operation === "practice.dialogue-turn"
                  ? "practice.dialogue-turn"
                  : "practice.dialogue-assistant-retry",
            });
            break;
          case "dialogue-final-feedback": {
            const session = await database.transaction(item.owner_id, ({ tenant }) =>
              loadPracticeSession(tenant, item.session_id),
            );
            const itemFeedbacks = output.itemFeedbacks.map((feedback) => ({
              feedback: feedback.feedback,
              itemId: session.items[Number(feedback.itemAlias.slice(5)) - 1]?.itemId ?? "",
            }));
            if (
              itemFeedbacks.some((feedback) => !feedback.itemId) ||
              new Set(itemFeedbacks.map((feedback) => feedback.itemId)).size !==
                session.items.length
            )
              continue;
            await dialogue.completeFinish({
              ...common,
              finalFeedback: output.summary,
              itemFeedbacks,
            });
            break;
          }
        }
      } catch {
        // A concurrent recovery or changed practice is reconciled on the next wake.
        // Leave unknown outcomes visible; never turn a conflict into a paid retry.
      }
    }
  };
}
