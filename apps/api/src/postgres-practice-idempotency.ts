import type { PracticeSession } from "@huayi/cloud-contracts";

import type { AnalysisQuery } from "./analysis-database.js";

export async function beginPracticeWrite(
  trusted: AnalysisQuery,
  ownerUserId: string,
  operation: string,
  key: string,
  requestHash: string,
) {
  const rows = await trusted.rows<{ response: unknown }>(
    "SELECT begin_idempotent_write($1,$2,$3,$4) AS response",
    [ownerUserId, operation, key, requestHash],
  );
  return rows[0]?.response;
}

export async function savePracticeWrite(
  tenant: AnalysisQuery,
  command: { idempotencyKey: string; now: string; ownerUserId: string; requestHash: string },
  operation: string,
  response: PracticeSession,
) {
  const expiresAt = new Date(Date.parse(command.now) + 7 * 86_400_000).toISOString();
  await tenant.rows(
    `INSERT INTO idempotency_records(owner_user_id,operation,key,request_hash,response,expires_at)
      VALUES($1,$2,$3,$4,$5::jsonb,$6::timestamptz)`,
    [
      command.ownerUserId,
      operation,
      command.idempotencyKey,
      command.requestHash,
      JSON.stringify(response),
      expiresAt,
    ],
  );
}
