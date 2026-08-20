import { z } from "zod/v3";

import type { AnalysisQuery } from "./analysis-database.js";
import { CloudFault } from "./cloud-fault.js";

export interface LockedExternalWordbookJob {
  direction: "import" | "export";
  id: string;
  lease_expires_at: Date | null;
  lease_nonce_hash: string | null;
  next_page: number | null;
  revision: number;
  state: "pending" | "active" | "completed" | "failed" | "cancelled" | "source-limit-reached";
  target: "eudic" | "shanbay";
}

const payloadSchema = z.strictObject({
  contextLine: z.string().trim().min(1).max(2_000).optional(),
  headword: z.string().trim().min(1).max(200),
});

export function externalWordbookInstant(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export async function lockExternalWordbookJob(
  tenant: AnalysisQuery,
  jobId: string,
): Promise<LockedExternalWordbookJob> {
  const rows = await tenant.rows<LockedExternalWordbookJob>(
    `SELECT id::text,target,direction,state,next_page,lease_nonce_hash,lease_expires_at,revision
     FROM external_wordbook_jobs WHERE id=$1 FOR UPDATE`,
    [jobId],
  );
  if (rows[0] === undefined) throw new CloudFault("not_found", "Wordbook job not found.");
  return rows[0];
}

export async function loadCurrentExternalWordbookLease(
  tenant: AnalysisQuery,
  job: LockedExternalWordbookJob,
  expiresAt: string,
) {
  if (job.direction === "import") {
    if (job.next_page === null || job.next_page > 50) {
      throw new CloudFault("wordbook_job_not_claimable", "The import has no remaining page.");
    }
    return {
      expiresAt,
      jobId: job.id,
      kind: "eudic-import" as const,
      page: job.next_page,
      pageSize: 100 as const,
    };
  }
  const items = await tenant.rows<{ id: string; payload_snapshot: unknown }>(
    `SELECT id::text,payload_snapshot FROM external_wordbook_items
     WHERE job_id=$1 AND state='in-flight' ORDER BY created_at,id`,
    [job.id],
  );
  if (items.length === 0) {
    throw new CloudFault("wordbook_job_not_claimable", "The export has no leased items.");
  }
  return {
    entries: items.map((item) => ({
      itemId: item.id,
      ...payloadSchema.parse(item.payload_snapshot),
    })),
    expiresAt,
    jobId: job.id,
    kind: "export" as const,
  };
}
