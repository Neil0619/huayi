import type { SubmitWordbookReceiptsRequest } from "@huayi/cloud-contracts";

import type { AnalysisQuery } from "./analysis-database.js";
import { CloudFault } from "./cloud-fault.js";

type ExportReceiptRequest = Extract<SubmitWordbookReceiptsRequest, { kind: "export" }>;

export async function applyExternalWordbookExportReceipts(
  tenant: AnalysisQuery,
  input: {
    jobId: string;
    jobState: "pending" | "active" | "completed" | "failed" | "cancelled" | "source-limit-reached";
    now: string;
    request: Omit<ExportReceiptRequest, "leaseToken">;
    target: "eudic" | "shanbay";
  },
): Promise<void> {
  const leased = await tenant.rows<{ id: string }>(
    `SELECT id::text FROM external_wordbook_items
     WHERE job_id=$1 AND state='in-flight' ORDER BY id`,
    [input.jobId],
  );
  const expected = leased.map(({ id }) => id).sort();
  const received = input.request.receipts.map(({ itemId }) => itemId).sort();
  if (JSON.stringify(expected) !== JSON.stringify(received) || expected.length === 0) {
    throw new CloudFault("wordbook_lease_stale", "Export receipts must match the lease.");
  }
  for (const receipt of input.request.receipts) {
    const valid =
      receipt.outcome === "failed" ||
      (input.target === "eudic" && ["created", "already-present"].includes(receipt.outcome)) ||
      (input.target === "shanbay" && receipt.outcome === "confirmed");
    if (!valid) throw new CloudFault("invalid_request", "Receipt outcome is invalid.");
    await tenant.rows(
      receipt.outcome === "failed"
        ? `UPDATE external_wordbook_items SET state='failed',stable_error_code=$2,
             receipt=NULL,updated_at=$3 WHERE id=$1`
        : `UPDATE external_wordbook_items SET state='delivered',stable_error_code=NULL,
             receipt=$2::jsonb,updated_at=$3 WHERE id=$1`,
      [
        receipt.itemId,
        receipt.outcome === "failed"
          ? receipt.stableErrorCode
          : JSON.stringify({
              outcome: receipt.outcome,
              recordedAt: input.now,
              target: input.target,
            }),
        input.now,
      ],
    );
  }
  const counts = await tenant.rows<{ failed: number; pending: number }>(
    `SELECT count(*) FILTER (WHERE state='failed')::int failed,
       count(*) FILTER (WHERE state IN ('pending','in-flight'))::int pending
     FROM external_wordbook_items WHERE job_id=$1`,
    [input.jobId],
  );
  const state =
    input.jobState === "cancelled"
      ? "cancelled"
      : (counts[0]?.pending ?? 0) > 0
        ? "active"
        : (counts[0]?.failed ?? 0) > 0
          ? "failed"
          : "completed";
  const errors = await tenant.rows<{ stable_error_code: string }>(
    `SELECT stable_error_code FROM external_wordbook_items
     WHERE job_id=$1 AND state='failed' ORDER BY updated_at,id LIMIT 1`,
    [input.jobId],
  );
  await tenant.rows(
    `UPDATE external_wordbook_jobs SET state=$2,last_error_code=$3,
       lease_nonce_hash=NULL,lease_expires_at=NULL,revision=revision+1,updated_at=$4
     WHERE id=$1`,
    [input.jobId, state, errors[0]?.stable_error_code ?? null, input.now],
  );
}
