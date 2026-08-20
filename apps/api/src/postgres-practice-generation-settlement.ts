import type { AnalysisBilledCall } from "./analysis-ports.js";
import type { AnalysisQuery } from "./analysis-database.js";
import { CloudFault } from "./cloud-fault.js";
import type { PracticeGenerationKind } from "./paid-practice-generator.js";

const featureByKind: Record<PracticeGenerationKind, string> = {
  "dialogue-assistant": "practice.dialogue-assistant",
  "dialogue-final-feedback": "practice.dialogue-final-feedback",
  "dialogue-start": "practice.dialogue-start",
  "sentence-feedback": "practice.sentence-feedback",
  "sentence-prompt": "practice.sentence-prompt",
};

interface FailedTaskRow {
  attempt_id: string | null;
  price_version_id: string;
  reservation_id: string;
  reserved_micro_usd: string;
  session_id: string;
}

interface ReservationRow {
  owner_user_id: string;
  period_start: Date;
  request_id: string;
  reserved_micro_usd: string;
  status: string;
  user_id: string;
}

export async function settleFailedPracticeGeneration(
  query: AnalysisQuery,
  command: {
    billedCalls?: AnalysisBilledCall[];
    generationId: string;
    kind: PracticeGenerationKind;
    leaseToken: string;
    ledgerId(): string;
    now: Date;
    ownerUserId: string;
    reservationId: string;
    stableErrorCode: "model_output_invalid" | "model_unavailable";
  },
) {
  const tasks = await query.rows<FailedTaskRow>(
    `UPDATE practice_generation_tasks SET state='failed',stable_error_code=$4,updated_at=$5
      WHERE id=$1 AND owner_user_id=$2 AND lease_token=$3 AND state='dispatched'
      RETURNING session_id::text,attempt_id::text,reservation_id::text,
        price_version_id::text,reserved_micro_usd::text`,
    [
      command.generationId,
      command.ownerUserId,
      command.leaseToken,
      command.stableErrorCode,
      command.now,
    ],
  );
  const task = tasks[0];
  if (task === undefined) return false;
  if (task.reservation_id !== command.reservationId) {
    throw new CloudFault("revision_conflict", "Practice reservation changed.");
  }
  const reservations = await query.rows<ReservationRow>(
    `SELECT user_id::text,owner_user_id::text,request_id::text,period_start,
      reserved_micro_usd::text,status FROM quota_reservations WHERE id=$1 FOR UPDATE`,
    [command.reservationId],
  );
  const reservation = reservations[0];
  if (
    reservation === undefined ||
    reservation.user_id !== command.ownerUserId ||
    reservation.owner_user_id !== command.ownerUserId ||
    reservation.request_id !== command.generationId ||
    !["active", "released"].includes(reservation.status)
  ) {
    throw new CloudFault("revision_conflict", "Practice reservation changed.");
  }
  const calls = command.billedCalls ?? [
    {
      costMicroUsd: Number(task.reserved_micro_usd),
      usage: { cachedInputTokens: 0, inputTokens: 0, outputTokens: 0 },
    },
  ];
  const totalCost = calls.reduce((sum, call) => sum + call.costMicroUsd, 0);
  if (calls.length < 1 || calls.length > 2 || totalCost > Number(reservation.reserved_micro_usd)) {
    throw new CloudFault("revision_conflict", "Practice settlement is invalid.");
  }
  for (const [ordinal, call] of calls.entries()) {
    await query.rows(
      `INSERT INTO usage_ledger(
        id,user_id,owner_user_id,request_id,call_ordinal,period_start,feature,
        price_version_id,cost_micro_usd,outcome,input_tokens,cached_input_tokens,output_tokens
      ) VALUES($1,$2,$2,$3,$4,$5,$6,$7,$8,'failed',$9,$10,$11)`,
      [
        command.ledgerId(),
        command.ownerUserId,
        command.generationId,
        ordinal,
        reservation.period_start,
        featureByKind[command.kind],
        task.price_version_id,
        call.costMicroUsd,
        call.usage.inputTokens,
        call.usage.cachedInputTokens,
        call.usage.outputTokens,
      ],
    );
  }
  await query.rows("UPDATE quota_reservations SET status='settled',updated_at=$2 WHERE id=$1", [
    command.reservationId,
    command.now,
  ]);
  await query.rows(
    `UPDATE practice_sessions SET current_generation_id=NULL,generation_lease_token=NULL,
      generation_lease_expires_at=NULL,updated_at=$3
      WHERE id=$1 AND owner_user_id=$2 AND current_generation_id=$4`,
    [task.session_id, command.ownerUserId, command.now, command.generationId],
  );
  if (task.attempt_id !== null) {
    await query.rows(
      `UPDATE practice_attempts SET current_generation_id=NULL,feedback_lease_token=NULL,
        feedback_lease_expires_at=NULL,updated_at=$3
        WHERE id=$1 AND owner_user_id=$2 AND current_generation_id=$4`,
      [task.attempt_id, command.ownerUserId, command.now, command.generationId],
    );
  }
  return true;
}
