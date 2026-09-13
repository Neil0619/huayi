import type { AnalysisDatabase, AnalysisQuery } from "./analysis-database.js";
import { CloudFault } from "./cloud-fault.js";
import { insertTeachingAttempt } from "./postgres-practice-teaching-attempt.js";
import type { PracticeRepository } from "./practice-module.js";
import { beginPracticeWrite } from "./postgres-practice-idempotency.js";
import { loadPracticeSession } from "./postgres-practice-view.js";
import { completeSentenceFeedback } from "./postgres-feedback-completion.js";
import {
  lockFeedbackSession,
  lockFeedbackAttempt,
  lockFeedbackGeneration,
  feedbackClaim,
  resumeFeedbackClaim,
} from "./postgres-feedback-claim.js";
import {
  readFeedbackReceipt,
  saveFeedbackReceipt,
  type FeedbackReceiptCommand,
} from "./postgres-feedback-receipt.js";

type RetryCommand = Parameters<PracticeRepository["beginFeedbackRetry"]>[0];
type AttemptCommand = Parameters<PracticeRepository["recordAttempt"]>[0];
async function replayClaim(
  query: AnalysisQuery,
  saved: unknown,
  command: RetryCommand | AttemptCommand,
  retry: boolean,
) {
  const { attemptId, ...common } = command;
  const receipt = readFeedbackReceipt(saved, { ...common, ...(retry ? { attemptId } : {}) });
  if (!("generationId" in receipt)) return { claimed: false as const, session: receipt };
  await lockFeedbackSession(query, receipt.sessionId);
  if (receipt.state === "applied")
    return {
      claimed: false as const,
      session: await loadPracticeSession(query, receipt.sessionId),
    };
  const attempt = await lockFeedbackAttempt(query, receipt.sessionId, receipt.attemptId);
  const generation = await lockFeedbackGeneration(
    query,
    receipt.sessionId,
    receipt.attemptId,
    receipt.generationId,
  );
  return resumeFeedbackClaim(query, receipt.session, attempt, generation, command);
}
async function insertGeneration(query: AnalysisQuery, command: RetryCommand | AttemptCommand) {
  await query.rows(
    `INSERT INTO practice_generation_tasks(id,owner_user_id,session_id,attempt_id,kind,state,request_hash,lease_token,lease_expires_at,created_at,updated_at)
    VALUES($1,$2,$3,$4,'sentence-feedback','claimed',$5,$6,$7,$8,$8)`,
    [
      command.generationId,
      command.ownerUserId,
      command.sessionId,
      command.attemptId,
      command.requestHash,
      command.feedbackLeaseToken,
      command.feedbackLeaseExpiresAt,
      command.now,
    ],
  );
  await query.rows(
    `UPDATE practice_attempts SET current_generation_id=$3,feedback_lease_token=$4,feedback_lease_expires_at=$5,updated_at=$6 WHERE id=$1 AND session_id=$2`,
    [
      command.attemptId,
      command.sessionId,
      command.generationId,
      command.feedbackLeaseToken,
      command.feedbackLeaseExpiresAt,
      command.now,
    ],
  );
}
async function begin(
  query: AnalysisQuery,
  command: FeedbackReceiptCommand,
  operation: "practice.attempt" | "practice.feedback-retry",
) {
  try {
    return await beginPracticeWrite(
      query,
      command.ownerUserId,
      operation,
      command.idempotencyKey,
      command.requestHash,
    );
  } catch (error) {
    if (error instanceof Error && error.message.includes("idempotency conflict"))
      throw new CloudFault(
        "idempotency_conflict",
        "The feedback key was reused for different input.",
      );
    throw error;
  }
}
export function createPostgresSentenceFeedbackOperations(
  database: AnalysisDatabase,
): Pick<
  PracticeRepository,
  "beginFeedbackRetry" | "completeFeedback" | "recordAttempt" | "releaseFeedbackLease"
> {
  return {
    async beginFeedbackRetry(command) {
      return database.transaction(command.ownerUserId, async ({ tenant, trusted }) => {
        const replay = await begin(trusted, command, "practice.feedback-retry");
        if (replay != null) return replayClaim(tenant, replay, command, true);
        const current = await lockFeedbackSession(tenant, command.sessionId);
        if (
          current.status !== "awaiting-feedback" ||
          current.revision !== command.expectedRevision ||
          !["active", "paused"].includes(current.phase)
        )
          throw new CloudFault("revision_conflict", "Practice session revision changed.");
        let attempt = await lockFeedbackAttempt(tenant, command.sessionId, command.attemptId);
        if (attempt.feedback !== null)
          throw new CloudFault("revision_conflict", "Practice answer changed.");
        const session = await loadPracticeSession(tenant, command.sessionId);
        if (
          session.attempts?.[attempt.ordinal]?.id !== attempt.id ||
          session.attempts.length !== attempt.ordinal + 1
        )
          throw new CloudFault("revision_conflict", "Practice answer changed.");
        if (attempt.current_generation_id !== null) {
          const generation = await lockFeedbackGeneration(
            tenant,
            command.sessionId,
            attempt.id,
            attempt.current_generation_id,
          );
          if (!["failed", "abandoned", "applied"].includes(generation.state)) {
            await saveFeedbackReceipt(
              tenant,
              command,
              "practice.feedback-retry",
              { attemptId: attempt.id, generationId: generation.id },
              session,
            );
            return resumeFeedbackClaim(tenant, session, attempt, generation, command);
          }
        }
        // Unknown dispatches are not permission to spend again. A fresh explicit retry
        // can create a generation only after every prior generation is a known failure.
        const prior = await tenant.rows<{ state: string }>(
          "SELECT state FROM practice_generation_tasks WHERE session_id=$1 AND attempt_id=$2 FOR UPDATE",
          [command.sessionId, attempt.id],
        );
        if (prior.length === 0 || prior.some((generation) => generation.state !== "failed"))
          throw new CloudFault("revision_conflict", "Practice generation outcome is unresolved.");
        await insertGeneration(tenant, command);
        attempt = await lockFeedbackAttempt(tenant, command.sessionId, command.attemptId);
        const claim = await feedbackClaim(tenant, command.sessionId, attempt, {
          id: command.generationId,
          lease_token: command.feedbackLeaseToken,
          state: "claimed",
        });
        await saveFeedbackReceipt(
          tenant,
          command,
          "practice.feedback-retry",
          { attemptId: attempt.id, generationId: command.generationId },
          claim.session,
        );
        return claim;
      });
    },
    completeFeedback: (command) => completeSentenceFeedback(database, command),
    async recordAttempt(command) {
      return database.transaction(command.ownerUserId, async ({ tenant, trusted }) => {
        const replay = await begin(trusted, command, "practice.attempt");
        if (replay != null) return replayClaim(tenant, replay, command, false);
        const current = await lockFeedbackSession(tenant, command.sessionId);
        if (
          current.status !== "active" ||
          current.revision !== command.expectedRevision ||
          !["active", "paused"].includes(current.phase)
        )
          throw new CloudFault("revision_conflict", "Practice session revision changed.");
        const open = await tenant.rows(
          "SELECT id FROM practice_generation_tasks WHERE session_id=$1 AND state IN ('claimed','reserved','dispatched','ready') LIMIT 1",
          [command.sessionId],
        );
        if (open.length)
          throw new CloudFault("generation_busy", "Another practice generation is in progress.");
        if (!(await insertTeachingAttempt(tenant, command)))
          await tenant.rows(
            `INSERT INTO practice_attempts(id,session_id,owner_user_id,answer,submitted_at,feedback_lease_token,feedback_lease_expires_at)
            VALUES($1,$2,$3,$4,$5,$6,$7)`,
            [
              command.attemptId,
              command.sessionId,
              command.ownerUserId,
              command.answer,
              command.now,
              command.feedbackLeaseToken,
              command.feedbackLeaseExpiresAt,
            ],
          );
        await insertGeneration(tenant, command);
        await tenant.rows(
          "UPDATE practice_sessions SET status='awaiting-feedback',revision=revision+1,updated_at=$2 WHERE id=$1",
          [command.sessionId, command.now],
        );
        const attempt = await lockFeedbackAttempt(tenant, command.sessionId, command.attemptId);
        const claim = await feedbackClaim(tenant, command.sessionId, attempt, {
          id: command.generationId,
          state: "claimed",
          lease_token: command.feedbackLeaseToken,
        });
        await saveFeedbackReceipt(
          tenant,
          command,
          "practice.attempt",
          { attemptId: command.attemptId, generationId: command.generationId },
          claim.session,
        );
        return claim;
      });
    },
    async releaseFeedbackLease(command) {
      await database.transaction(command.ownerUserId, async ({ tenant }) => {
        await lockFeedbackSession(tenant, command.sessionId);
        await tenant.rows(
          `UPDATE practice_attempts SET feedback_lease_token=NULL,feedback_lease_expires_at=NULL,updated_at=$4
          WHERE id=$1 AND session_id=$2 AND feedback IS NULL AND feedback_lease_token=$3`,
          [command.attemptId, command.sessionId, command.feedbackLeaseToken, command.now],
        );
      });
    },
  };
}
