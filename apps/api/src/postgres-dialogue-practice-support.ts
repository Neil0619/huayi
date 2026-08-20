import type { PracticeSession } from "@huayi/cloud-contracts";

import type { AnalysisQuery } from "./analysis-database.js";
import { CloudFault } from "./cloud-fault.js";

export async function beginDialogueWrite(
  query: AnalysisQuery,
  ownerUserId: string,
  operation: string,
  key: string,
  requestHash: string,
) {
  const rows = await query.rows<{ response: unknown }>(
    "SELECT begin_idempotent_write($1,$2,$3,$4) AS response",
    [ownerUserId, operation, key, requestHash],
  );
  return rows[0]?.response;
}

export async function saveDialogueWrite(
  query: AnalysisQuery,
  command: { idempotencyKey: string; now: string; ownerUserId: string; requestHash: string },
  operation: string,
  response: PracticeSession,
) {
  await query.rows(
    `INSERT INTO idempotency_records(owner_user_id,operation,key,request_hash,response,expires_at)
      VALUES($1,$2,$3,$4,$5::jsonb,$6::timestamptz)`,
    [
      command.ownerUserId,
      operation,
      command.idempotencyKey,
      command.requestHash,
      JSON.stringify(response),
      new Date(Date.parse(command.now) + 7 * 86_400_000).toISOString(),
    ],
  );
}

export async function replaceDialogueWrite(
  query: AnalysisQuery,
  ownerUserId: string,
  operation: string,
  key: string,
  response: PracticeSession,
) {
  await query.rows(
    `UPDATE idempotency_records SET response=$4::jsonb
      WHERE owner_user_id=$1 AND operation=$2 AND key=$3`,
    [ownerUserId, operation, key, JSON.stringify(response)],
  );
}

export async function requireDialogueState(
  query: AnalysisQuery,
  sessionId: string,
  status: "active" | "awaiting-feedback",
  expectedRevision: number | undefined,
) {
  const rows = await query.rows<{
    pending_generation: string | null;
    revision: number;
    status: string;
    type: string;
  }>(
    `SELECT type,status,pending_generation,revision FROM practice_sessions
      WHERE id=$1 FOR UPDATE`,
    [sessionId],
  );
  const row = rows[0];
  if (row?.type !== "dialogue") throw new CloudFault("not_found", "Dialogue not found.");
  if (row.status !== status || row.revision !== expectedRevision) {
    throw new CloudFault("revision_conflict", "Practice session revision changed.");
  }
  return row;
}
