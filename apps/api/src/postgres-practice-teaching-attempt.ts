import type { AnalysisQuery } from "./analysis-database.js";
import type { PracticeRepository } from "./practice-module.js";
import { CloudFault } from "./cloud-fault.js";
import { readPracticeTeachingState } from "./postgres-practice-teaching-view.js";

/** The caller holds the session lock before assigning the next answer identity. */
export async function insertTeachingAttempt(
  query: AnalysisQuery,
  command: Parameters<PracticeRepository["recordAttempt"]>[0],
): Promise<boolean> {
  const state = await readPracticeTeachingState(query, command.sessionId);
  if (state === null) return false;
  const answers = await query.rows<{ id: string; ordinal: number }>(
    "SELECT id,ordinal FROM practice_attempts WHERE session_id=$1 ORDER BY ordinal",
    [command.sessionId],
  );
  if (
    state.target.state !== "available" ||
    answers.length >= 5 ||
    state.round.ordinal !== answers.length ||
    state.round.parentAttemptId !== (answers.at(-1)?.id ?? null) ||
    answers.some((answer, index) => answer.ordinal !== index)
  )
    throw new CloudFault("revision_conflict", "Practice answer round changed.");
  await query.rows(
    `INSERT INTO practice_attempts(id,session_id,owner_user_id,answer,submitted_at,
    feedback_lease_token,feedback_lease_expires_at,ordinal,parent_attempt_id,teaching_contract,hint_viewed_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      command.attemptId,
      command.sessionId,
      command.ownerUserId,
      command.answer,
      command.now,
      command.feedbackLeaseToken,
      command.feedbackLeaseExpiresAt,
      state.round.ordinal,
      state.round.parentAttemptId,
      state.contract,
      state.round.hintViewedAt,
    ],
  );
  return true;
}
