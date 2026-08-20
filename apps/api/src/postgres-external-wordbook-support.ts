import { wordbookJobResourceSchema, type WordbookJobResource } from "@huayi/cloud-contracts";

import type { AnalysisQuery } from "./analysis-database.js";
import { CloudFault } from "./cloud-fault.js";

export interface ExternalJobRow {
  created_at: Date;
  direction: "import" | "export";
  failed_count: number;
  id: string;
  last_error_code: string | null;
  next_page: number | null;
  processed_count: number;
  revision: number;
  state: WordbookJobResource["state"];
  target: "eudic" | "shanbay";
  total_count: number | null;
  updated_at: Date;
}

const projection = `SELECT jobs.id::text,jobs.target,jobs.direction,jobs.state,jobs.next_page,
  jobs.last_error_code,jobs.revision,jobs.created_at,jobs.updated_at,
  count(items.id) FILTER (WHERE items.state='delivered')::int AS processed_count,
  count(items.id) FILTER (WHERE items.state='failed')::int AS failed_count,
  CASE WHEN jobs.direction='export' THEN count(items.id)::int ELSE NULL END AS total_count
  FROM external_wordbook_jobs jobs
  LEFT JOIN external_wordbook_items items ON items.job_id=jobs.id`;

function instant(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export function mapExternalJob(row: ExternalJobRow): WordbookJobResource {
  return wordbookJobResourceSchema.parse({
    createdAt: instant(row.created_at),
    direction: row.direction,
    failedCount: row.failed_count,
    id: row.id,
    lastErrorCode: row.last_error_code,
    nextPage: row.next_page,
    processedCount: row.processed_count,
    revision: row.revision,
    state: row.state,
    target: row.target,
    totalCount: row.total_count,
    updatedAt: instant(row.updated_at),
  });
}

export async function loadExternalJob(
  query: AnalysisQuery,
  jobId: string,
): Promise<WordbookJobResource | null> {
  const rows = await query.rows<ExternalJobRow>(
    `${projection} WHERE jobs.id=$1
     GROUP BY jobs.id,jobs.target,jobs.direction,jobs.state,jobs.next_page,
       jobs.last_error_code,jobs.revision,jobs.created_at,jobs.updated_at`,
    [jobId],
  );
  return rows[0] === undefined ? null : mapExternalJob(rows[0]);
}

export async function listExternalJobs(
  query: AnalysisQuery,
  input: {
    boundary?: { createdAt: string; id: string };
    direction?: string;
    limit: number;
    state?: string;
    target?: string;
  },
) {
  const rows = await query.rows<ExternalJobRow>(
    `${projection}
     WHERE ($1::text IS NULL OR jobs.target=$1)
       AND ($2::text IS NULL OR jobs.direction=$2)
       AND ($3::text IS NULL OR jobs.state=$3)
       AND ($4::timestamptz IS NULL OR (jobs.created_at,jobs.id)<($4::timestamptz,$5::uuid))
     GROUP BY jobs.id,jobs.target,jobs.direction,jobs.state,jobs.next_page,
       jobs.last_error_code,jobs.revision,jobs.created_at,jobs.updated_at
     ORDER BY jobs.created_at DESC,jobs.id DESC LIMIT $6`,
    [
      input.target ?? null,
      input.direction ?? null,
      input.state ?? null,
      input.boundary?.createdAt ?? null,
      input.boundary?.id ?? null,
      input.limit + 1,
    ],
  );
  return {
    hasMore: rows.length > input.limit,
    items: rows.slice(0, input.limit).map(mapExternalJob),
  };
}

export async function replayWordbookWrite(
  trusted: AnalysisQuery,
  ownerUserId: string,
  operation: "wordbook.cancel" | "wordbook.create" | "wordbook.receipt" | "wordbook.retry",
  key: string,
  requestHash: string,
): Promise<WordbookJobResource | null> {
  const rows = await trusted.rows<{ response: unknown }>(
    "SELECT begin_idempotent_write($1,$2,$3,$4) AS response",
    [ownerUserId, operation, key, requestHash],
  );
  const response = rows[0]?.response;
  return response === null || response === undefined
    ? null
    : wordbookJobResourceSchema.parse(response);
}

export async function saveWordbookWrite(
  trusted: AnalysisQuery,
  input: {
    key: string;
    now: string;
    operation: "wordbook.cancel" | "wordbook.create" | "wordbook.receipt" | "wordbook.retry";
    ownerUserId: string;
    requestHash: string;
    response: WordbookJobResource;
  },
): Promise<void> {
  await trusted.rows(
    `INSERT INTO idempotency_records(owner_user_id,operation,key,request_hash,response,expires_at)
     VALUES($1,$2,$3,$4,$5::jsonb,$6::timestamptz)`,
    [
      input.ownerUserId,
      input.operation,
      input.key,
      input.requestHash,
      JSON.stringify(input.response),
      new Date(Date.parse(input.now) + 7 * 86_400_000).toISOString(),
    ],
  );
}

export function translateExternalWordbookError(error: unknown): never {
  if (error instanceof CloudFault) throw error;
  if (error instanceof Error && error.message.includes("idempotency conflict")) {
    throw new CloudFault("idempotency_conflict", "The idempotency key is already in use.");
  }
  throw error;
}
