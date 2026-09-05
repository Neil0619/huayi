import type { AnalysisBilledCall } from "./analysis-ports.js";
import type { AnalysisQuery } from "./analysis-database.js";
import { CloudFault } from "./cloud-fault.js";
import type { PracticeGenerationKind } from "./paid-practice-generator.js";

interface FailedTaskRow {
  attempt_id: string | null;
  reservation_id: string;
  reserved_micro_usd: string;
  session_id: string;
}

export async function settleFailedPracticeGeneration(
  queries: { tenant: AnalysisQuery; trusted: AnalysisQuery },
  command: {
    billedCalls?: AnalysisBilledCall[];
    generationId: string;
    kind: PracticeGenerationKind;
    leaseToken: string;
    leaseExpiredAt?: Date;
    ledgerId(): string;
    now: Date;
    ownerUserId: string;
    reservationId: string;
    stableErrorCode: "model_output_invalid" | "model_unavailable";
    terminalState?: "abandoned" | "failed";
  },
) {
  const tasks = await queries.tenant.rows<FailedTaskRow>(
    `UPDATE practice_generation_tasks SET state=$4,stable_error_code=$5,updated_at=$6
      WHERE id=$1 AND owner_user_id=$2 AND lease_token=$3 AND state='dispatched'
      AND ($7::timestamptz IS NULL OR lease_expires_at<=$7)
      RETURNING session_id::text,attempt_id::text,reservation_id::text,
        reserved_micro_usd::text`,
    [
      command.generationId,
      command.ownerUserId,
      command.leaseToken,
      command.terminalState ?? "failed",
      command.stableErrorCode,
      command.now,
      command.leaseExpiredAt ?? null,
    ],
  );
  const task = tasks[0];
  if (task === undefined) return false;
  if (task.reservation_id !== command.reservationId) {
    throw new CloudFault("revision_conflict", "Practice reservation changed.");
  }
  const calls =
    command.billedCalls?.length === 0
      ? [{ costMicroUsd: 0, usage: { cachedInputTokens: 0, inputTokens: 0, outputTokens: 0 } }]
      : (command.billedCalls ?? [
          {
            costMicroUsd: Number(task.reserved_micro_usd),
            usage: { cachedInputTokens: 0, inputTokens: 0, outputTokens: 0 },
          },
        ]);
  const totalCost = calls.reduce((sum, call) => sum + call.costMicroUsd, 0);
  if (calls.length < 1 || calls.length > 2 || totalCost > Number(task.reserved_micro_usd)) {
    throw new CloudFault("revision_conflict", "Practice settlement is invalid.");
  }
  await queries.trusted.rows(
    `SELECT settle_practice_generation_quota(
      $1,$2,$3,$4::uuid[],$5::jsonb,'failed',$6
    )`,
    [
      command.ownerUserId,
      command.generationId,
      command.reservationId,
      calls.map(() => command.ledgerId()),
      JSON.stringify(
        calls.map((call) => ({
          cachedInputTokens: call.usage.cachedInputTokens,
          costMicroUsd: call.costMicroUsd,
          inputTokens: call.usage.inputTokens,
          outputTokens: call.usage.outputTokens,
        })),
      ),
      command.now,
    ],
  );
  await queries.tenant.rows(
    `UPDATE practice_sessions SET current_generation_id=NULL,generation_lease_token=NULL,
      generation_lease_expires_at=NULL,updated_at=$3
      WHERE id=$1 AND owner_user_id=$2 AND current_generation_id=$4`,
    [task.session_id, command.ownerUserId, command.now, command.generationId],
  );
  if (task.attempt_id !== null) {
    await queries.tenant.rows(
      `UPDATE practice_attempts SET current_generation_id=NULL,feedback_lease_token=NULL,
        feedback_lease_expires_at=NULL,updated_at=$3
        WHERE id=$1 AND owner_user_id=$2 AND current_generation_id=$4`,
      [task.attempt_id, command.ownerUserId, command.now, command.generationId],
    );
  }
  return true;
}
