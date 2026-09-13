import { createHash } from "node:crypto";
import type { AnalysisDatabase } from "./analysis-database.js";
import type { PracticeRepository } from "./practice-module.js";
import { CloudFault } from "./cloud-fault.js";
import { parsePracticeGenerationOutput } from "./practice-generation-output.js";
import {
  lockFeedbackSession,
  lockFeedbackAttempt,
  lockFeedbackGeneration,
} from "./postgres-feedback-claim.js";
import { beginPracticeWrite } from "./postgres-practice-idempotency.js";
import { applyFeedbackReceipts, readFeedbackReceipt } from "./postgres-feedback-receipt.js";
import { loadPracticeSession } from "./postgres-practice-view.js";
import { readPracticeTeachingState } from "./postgres-practice-teaching-view.js";

type Command = Parameters<PracticeRepository["completeFeedback"]>[0];
function digest(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
function conflict(): never {
  throw new CloudFault("revision_conflict", "Practice feedback changed.");
}

export function completeSentenceFeedback(database: AnalysisDatabase, command: Command) {
  return database.transaction(command.ownerUserId, async ({ tenant, trusted }) => {
    const saved = await beginPracticeWrite(
      trusted,
      command.ownerUserId,
      command.operation,
      command.idempotencyKey,
      command.requestHash,
    );
    if (saved == null) return conflict();
    const receipt = readFeedbackReceipt(saved, command);
    if ("generationId" in receipt && receipt.generationId !== command.generationId)
      return conflict();
    // Every path that mutates the aggregate follows session -> answer -> generation.
    const current = await lockFeedbackSession(tenant, command.sessionId);
    const attempt = await lockFeedbackAttempt(tenant, command.sessionId, command.attemptId);
    const generation = await lockFeedbackGeneration(
      tenant,
      command.sessionId,
      command.attemptId,
      command.generationId,
    );
    if (generation.lease_token !== command.feedbackLeaseToken) return conflict();
    const context = {
      kind: "sentence-feedback" as const,
      input: {
        answer: attempt.answer,
        ...(attempt.teaching_contract === null
          ? {}
          : { teachingContract: attempt.teaching_contract }),
      },
    };
    let output;
    try {
      output = parsePracticeGenerationOutput(
        {
          kind: "sentence-feedback",
          feedback: command.feedback,
          ...(command.teachingFeedback === undefined
            ? {}
            : { teachingFeedback: command.teachingFeedback }),
        },
        context,
      );
    } catch {
      return conflict();
    }
    const outputHash = digest(output);
    if (generation.state === "applied") {
      if (
        attempt.feedback !== command.feedback ||
        (generation.applied_output_hash === null
          ? attempt.teaching_contract !== null || command.teachingFeedback !== undefined
          : generation.applied_output_hash !== outputHash)
      )
        return conflict();
      try {
        const stored = parsePracticeGenerationOutput(
          {
            kind: "sentence-feedback",
            feedback: attempt.feedback,
            ...(attempt.feedback_structured == null
              ? {}
              : { teachingFeedback: attempt.feedback_structured }),
          },
          context,
        );
        if (digest(stored) !== outputHash) return conflict();
      } catch {
        return conflict();
      }
      // Replaying an earlier answer must not mutate the active rewrite or its draft/rating.
      return loadPracticeSession(tenant, command.sessionId);
    }
    if (
      generation.state !== "ready" ||
      attempt.feedback !== null ||
      attempt.current_generation_id !== command.generationId ||
      attempt.feedback_lease_token !== command.feedbackLeaseToken ||
      current.status !== "awaiting-feedback"
    )
      return conflict();
    try {
      if (digest(parsePracticeGenerationOutput(generation.output, context)) !== outputHash)
        return conflict();
    } catch {
      return conflict();
    }
    const state = await readPracticeTeachingState(tenant, command.sessionId);
    if (
      (state?.contract ?? null) !== attempt.teaching_contract ||
      (state !== null && state.round.ordinal !== attempt.ordinal)
    )
      return conflict();
    const before = await loadPracticeSession(tenant, command.sessionId);
    if (
      before.attempts?.[attempt.ordinal]?.id !== attempt.id ||
      before.attempts.length !== attempt.ordinal + 1
    )
      return conflict();
    await tenant.rows(
      `UPDATE practice_generation_tasks SET state='applied',output=NULL,applied_output_hash=$2,updated_at=$3 WHERE id=$1`,
      [command.generationId, outputHash, command.now],
    );
    await tenant.rows(
      `UPDATE practice_attempts SET feedback=$2,feedback_structured=$3::jsonb,feedback_completed_at=$4,
      feedback_lease_token=NULL,feedback_lease_expires_at=NULL,current_generation_id=NULL,updated_at=$4 WHERE id=$1`,
      [
        command.attemptId,
        command.feedback,
        command.teachingFeedback === undefined ? null : JSON.stringify(command.teachingFeedback),
        command.now,
      ],
    );
    await tenant.rows(
      `UPDATE practice_sessions SET status='completed',final_feedback=$2,completed_at=$3,revision=revision+1,updated_at=$3 WHERE id=$1`,
      [command.sessionId, command.feedback, command.now],
    );
    const response = await loadPracticeSession(tenant, command.sessionId);
    await applyFeedbackReceipts(tenant, command, response);
    return response;
  });
}
