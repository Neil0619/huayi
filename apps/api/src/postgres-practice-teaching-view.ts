import {
  practiceTeachingDetailSchema,
  practiceTeachingStateSchema,
  type PracticeTeachingState,
} from "@huayi/cloud-contracts";
import type { AnalysisQuery } from "./analysis-database.js";
import { loadPracticeSession } from "./postgres-practice-view.js";

export async function readPracticeTeachingState(
  query: AnalysisQuery,
  id: string,
): Promise<PracticeTeachingState | null> {
  const rows = await query.rows<{ teaching_state: unknown }>(
    "SELECT to_jsonb(practice_sessions)->'teaching_state' teaching_state FROM practice_sessions WHERE id=$1",
    [id],
  );
  const value = rows[0]?.teaching_state;
  return value == null ? null : practiceTeachingStateSchema.parse(value);
}

/** Caller owns a repeatable-read snapshot or holds the session row lock. */
export async function loadPracticeTeaching(query: AnalysisQuery, id: string) {
  const session = await loadPracticeSession(query, id);
  const state = await readPracticeTeachingState(query, id);
  if (state === null)
    return practiceTeachingDetailSchema.parse({ version: 1, session, teaching: null });
  const rows = await query.rows<{
    id: string;
    ordinal: number;
    parent_attempt_id: string | null;
    teaching_contract: string | null;
    hint_viewed_at: Date | null;
    feedback_structured: unknown;
    feedback_completed_at: Date | null;
  }>(
    "SELECT id,ordinal,parent_attempt_id,teaching_contract,hint_viewed_at,feedback_structured,feedback_completed_at FROM practice_attempts WHERE session_id=$1 ORDER BY ordinal",
    [id],
  );
  if (rows.some((row) => row.teaching_contract !== state.contract))
    throw new Error("Practice teaching contract mismatch.");
  return practiceTeachingDetailSchema.parse({
    version: 1,
    session,
    teaching: {
      ...state,
      attempts: rows.map((row) => ({
        attemptId: row.id,
        ordinal: row.ordinal,
        parentAttemptId: row.parent_attempt_id,
        hintViewedAt: row.hint_viewed_at?.toISOString() ?? null,
        feedback: row.feedback_structured,
        feedbackCompletedAt: row.feedback_completed_at?.toISOString() ?? null,
      })),
    },
  });
}
