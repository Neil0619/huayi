import type { AnalysisQuery } from "./analysis-database.js";

/** Generation ownership links are immutable. Read identity first, then take aggregate
 * locks before any generation mutation that also clears session/answer leases. */
export async function lockPracticeGenerationAggregate(query: AnalysisQuery, generationId: string) {
  const identities = await query.rows<{ session_id: string; attempt_id: string | null }>(
    "SELECT session_id::text,attempt_id::text FROM practice_generation_tasks WHERE id=$1",
    [generationId],
  );
  const identity = identities[0];
  if (!identity) return false;
  const sessions = await query.rows("SELECT id FROM practice_sessions WHERE id=$1 FOR UPDATE", [
    identity.session_id,
  ]);
  if (sessions.length === 0) return false;
  if (identity.attempt_id !== null)
    await query.rows("SELECT id FROM practice_attempts WHERE id=$1 AND session_id=$2 FOR UPDATE", [
      identity.attempt_id,
      identity.session_id,
    ]);
  return true;
}
