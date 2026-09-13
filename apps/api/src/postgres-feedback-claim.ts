import type { PracticeSession } from "@huayi/cloud-contracts";
import type { AnalysisQuery } from "./analysis-database.js";
import { CloudFault } from "./cloud-fault.js";
import type { PracticeFeedbackClaim } from "./practice-module.js";
import { findPracticeItem, loadPracticeSession } from "./postgres-practice-view.js";
import { readPracticeTeachingState } from "./postgres-practice-teaching-view.js";

export interface FeedbackAttemptRow {
  id: string;
  ordinal: number;
  teaching_contract: "practice-teaching-v1" | null;
  current_generation_id: string | null;
  feedback: string | null;
  feedback_lease_token: string | null;
  answer: string;
  feedback_structured: unknown;
}
export interface FeedbackGenerationRow {
  id: string;
  state: "abandoned" | "applied" | "claimed" | "dispatched" | "failed" | "ready" | "reserved";
  lease_expires_at: Date;
  lease_token: string;
  output: unknown;
  applied_output_hash: string | null;
}
export async function lockFeedbackSession(query: AnalysisQuery, sessionId: string) {
  const rows = await query.rows<{ status: string; revision: number; phase: string }>(
    `SELECT status,revision,COALESCE(to_jsonb(practice_sessions)#>>'{workspace_state,phase}','active') phase
      FROM practice_sessions WHERE id=$1 FOR UPDATE`,
    [sessionId],
  );
  if (!rows[0]) throw new CloudFault("not_found", "Practice session not found.");
  return rows[0];
}
export async function lockFeedbackAttempt(
  query: AnalysisQuery,
  sessionId: string,
  attemptId: string,
) {
  const rows = await query.rows<FeedbackAttemptRow>(
    `SELECT id::text,answer,feedback,current_generation_id::text,feedback_lease_token,
    COALESCE((to_jsonb(practice_attempts)->>'ordinal')::integer,0) ordinal,
    to_jsonb(practice_attempts)->>'teaching_contract' teaching_contract,
    to_jsonb(practice_attempts)->'feedback_structured' feedback_structured
    FROM practice_attempts WHERE session_id=$1 AND id=$2 FOR UPDATE`,
    [sessionId, attemptId],
  );
  if (!rows[0]) throw new CloudFault("revision_conflict", "Practice answer changed.");
  return rows[0];
}
export async function lockFeedbackGeneration(
  query: AnalysisQuery,
  sessionId: string,
  attemptId: string,
  generationId: string,
) {
  const rows = await query.rows<FeedbackGenerationRow>(
    `SELECT id::text,state,lease_expires_at,lease_token,output,
    to_jsonb(practice_generation_tasks)->>'applied_output_hash' applied_output_hash FROM practice_generation_tasks
    WHERE id=$1 AND session_id=$2 AND attempt_id=$3 AND kind='sentence-feedback' FOR UPDATE`,
    [generationId, sessionId, attemptId],
  );
  if (!rows[0]) throw new CloudFault("revision_conflict", "Practice generation changed.");
  return rows[0];
}
/** Session and answer are locked. A ready result may be applied after target erasure. */
export async function feedbackClaim(
  query: AnalysisQuery,
  sessionId: string,
  attempt: FeedbackAttemptRow,
  generation: Pick<FeedbackGenerationRow, "id" | "lease_token" | "state">,
): Promise<PracticeFeedbackClaim> {
  const session = await loadPracticeSession(query, sessionId);
  const state = await readPracticeTeachingState(query, sessionId);
  if (
    session.attempts?.[attempt.ordinal]?.id !== attempt.id ||
    (state?.contract ?? null) !== attempt.teaching_contract
  )
    throw new CloudFault("revision_conflict", "Practice answer contract changed.");
  const content =
    state === null
      ? (await findPracticeItem(query, session.items[0]?.itemId ?? ""))?.item.content
      : state.target.state === "available"
        ? state.target.content
        : undefined;
  if (content === undefined && ["claimed", "reserved"].includes(generation.state))
    throw new CloudFault("not_found", "Learning target is unavailable.");
  return {
    claimed: true,
    attemptId: attempt.id,
    ordinal: attempt.ordinal,
    ...(attempt.teaching_contract === null ? {} : { teachingContract: attempt.teaching_contract }),
    ...(content === undefined ? {} : { itemContent: content }),
    generationId: generation.id,
    leaseToken: generation.lease_token,
    session,
  };
}
/** Same-key replay never creates another generation, including after terminal failure. */
export async function resumeFeedbackClaim(
  query: AnalysisQuery,
  session: PracticeSession,
  attempt: FeedbackAttemptRow,
  generation: FeedbackGenerationRow,
  command: { now: string; feedbackLeaseToken: string; feedbackLeaseExpiresAt: string },
): Promise<PracticeFeedbackClaim> {
  if (
    generation.state === "ready" ||
    (generation.state === "dispatched" &&
      generation.lease_expires_at.getTime() <= Date.parse(command.now))
  )
    return feedbackClaim(query, session.id, attempt, generation);
  if (
    ["claimed", "reserved"].includes(generation.state) &&
    generation.lease_expires_at.getTime() <= Date.parse(command.now)
  ) {
    if (attempt.current_generation_id !== generation.id || attempt.feedback !== null)
      throw new CloudFault("revision_conflict", "Practice generation changed.");
    await query.rows(
      "UPDATE practice_generation_tasks SET lease_token=$2,lease_expires_at=$3,updated_at=$4 WHERE id=$1",
      [generation.id, command.feedbackLeaseToken, command.feedbackLeaseExpiresAt, command.now],
    );
    await query.rows(
      "UPDATE practice_attempts SET feedback_lease_token=$2,feedback_lease_expires_at=$3,updated_at=$4 WHERE id=$1",
      [attempt.id, command.feedbackLeaseToken, command.feedbackLeaseExpiresAt, command.now],
    );
    return feedbackClaim(query, session.id, attempt, {
      ...generation,
      lease_token: command.feedbackLeaseToken,
    });
  }
  return { claimed: false, session };
}
