import {
  analysisDeleteResponseSchema,
  analysisEventSchema,
  analysisRecordSchema,
} from "@huayi/cloud-contracts";

import type { AnalysisDatabase, AnalysisQuery } from "./analysis-database.js";
import type { AnalysisCommitter, AnalysisRepository } from "./analysis-ports.js";
import { deletePostgresAnalysis, mutatePostgresAnalysis } from "./postgres-analysis-mutations.js";
import { replayPostgresCandidateConfirmation } from "./postgres-candidate-confirmation-replay.js";
import { confirmPostgresCandidates } from "./postgres-candidate-confirmation.js";

interface AnalysisRow {
  archived_at: Date | null;
  candidates: unknown;
  created_at: Date;
  id: string;
  model_metadata: unknown;
  result: unknown;
  review_state: "pendingReview" | "reviewed";
  revision: number;
  selection_kind: "passage" | "phrase" | "sentence";
  source_context: string | null;
  source_normalized_hash: string;
  source_text: string;
  source_title: string | null;
  source_type: "manual" | "study-capture";
  study_capture_id: string | null;
  updated_at: Date;
}

const selectRecord = `SELECT id::text, review_state, archived_at, source_type, source_title,
  source_context,source_text,source_normalized_hash,study_capture_id::text,selection_kind,
  result,model_metadata,revision,created_at,updated_at,
  COALESCE((SELECT jsonb_agg(jsonb_build_object(
    'id', candidates.id::text, 'ordinal', candidates.ordinal, 'payload', candidates.payload,
    'analysisUnitId', candidates.analysis_unit_id, 'type', candidates.candidate_type
  ) ORDER BY candidates.ordinal) FROM analysis_candidates candidates
    WHERE candidates.analysis_id=records.id), '[]'::jsonb) AS candidates
  FROM analysis_records records`;

function mapRecord(row: AnalysisRow) {
  return analysisRecordSchema.parse({
    archivedAt: row.archived_at?.toISOString() ?? null,
    candidates: row.candidates,
    createdAt: row.created_at.toISOString(),
    id: row.id,
    modelMetadata: row.model_metadata,
    result: row.result,
    reviewState: row.review_state,
    revision: row.revision,
    selectionKind: row.selection_kind,
    source: {
      ...(row.source_title === null ? {} : { title: row.source_title }),
      type: row.source_type,
      ...(row.source_context === null ? {} : { userContext: row.source_context }),
    },
    sourceNormalizedHash: row.source_normalized_hash,
    sourceText: row.source_text,
    ...(row.study_capture_id === null ? {} : { studyCaptureId: row.study_capture_id }),
    updatedAt: row.updated_at.toISOString(),
  });
}

export function createPostgresAnalysisStore(options: {
  database: AnalysisDatabase;
  ledgerId: () => string;
  priceVersionId: string;
}): AnalysisRepository & AnalysisCommitter {
  return {
    async archive(command) {
      return analysisRecordSchema.parse(
        await mutatePostgresAnalysis(options.database, "analysis.archive", command),
      );
    },
    async complete(command) {
      const quota = await options.database.transaction(
        command.userId,
        async ({ tenant, trusted }) => {
          const record = command.record;
          await trusted.rows("SELECT require_analysis_lease($1,$2,$3)", [
            command.userId,
            command.requestId,
            command.leaseToken,
          ]);
          await tenant.rows(
            `INSERT INTO analysis_records (id,owner_user_id,study_capture_id,review_state,
           archived_at,source_type,source_title,source_context,source_text,source_normalized_hash,
           selection_kind,result,model_metadata,revision,created_at,updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb,$14,$15,$16)`,
            [
              record.id,
              command.userId,
              record.studyCaptureId ?? null,
              record.reviewState,
              record.archivedAt,
              record.source.type,
              record.source.title ?? null,
              record.source.userContext ?? null,
              record.sourceText,
              record.sourceNormalizedHash,
              record.selectionKind,
              JSON.stringify(record.result),
              JSON.stringify(record.modelMetadata),
              record.revision,
              record.createdAt,
              record.updatedAt,
            ],
          );
          for (const candidate of record.candidates) {
            await tenant.rows(
              `INSERT INTO analysis_candidates (id, analysis_id, owner_user_id, candidate_type,
             payload,analysis_unit_id,ordinal) VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7)`,
              [
                candidate.id,
                record.id,
                command.userId,
                candidate.type,
                JSON.stringify(candidate.payload),
                candidate.analysisUnitId,
                candidate.ordinal,
              ],
            );
          }
          const calls = settlementCalls(
            command,
            command.actualCostMicroUsd ??
              (await reservedCostMicroUsd(
                trusted,
                command.userId,
                command.requestId,
                command.leaseToken,
                command.reservationId,
              )),
          );
          await trusted.rows(
            `SELECT settle_quota_reservation($1,$2::uuid[],'analysis',$3,$4::jsonb,'succeeded')`,
            [
              command.reservationId,
              calls.map(() => options.ledgerId()),
              command.priceVersionId ?? options.priceVersionId,
              JSON.stringify(calls),
            ],
          );
          const quota = await quotaSummary(tenant, command.userId);
          const event = analysisEventSchema.parse({
            analysis: record,
            quota,
            type: "analysis.completed",
          });
          await trusted.rows("SELECT finish_analysis_request($1,$2,$3,$4::jsonb)", [
            command.userId,
            command.requestId,
            command.leaseToken,
            JSON.stringify(event),
          ]);
          return quota;
        },
      );
      return { quota, record: command.record };
    },
    async confirmCandidates(command) {
      return confirmPostgresCandidates(options.database, command);
    },
    async replayCandidateConfirmation(command) {
      return replayPostgresCandidateConfirmation(options.database, command);
    },
    async fail(command) {
      return options.database.transaction(command.userId, async ({ tenant, trusted }) => {
        await trusted.rows("SELECT require_analysis_lease($1,$2,$3)", [
          command.userId,
          command.requestId,
          command.leaseToken,
        ]);
        const calls = settlementCalls(
          command,
          command.actualCostMicroUsd ??
            (await reservedCostMicroUsd(
              trusted,
              command.userId,
              command.requestId,
              command.leaseToken,
              command.reservationId,
            )),
        );
        await trusted.rows(
          "SELECT settle_quota_reservation($1,$2::uuid[],'analysis',$3,$4::jsonb,'failed')",
          [
            command.reservationId,
            calls.map(() => options.ledgerId()),
            command.priceVersionId ?? options.priceVersionId,
            JSON.stringify(calls),
          ],
        );
        const parsedEvent = analysisEventSchema.parse({
          error: command.error,
          quota: await quotaSummary(tenant, command.userId),
          type: "analysis.failed",
        });
        if (parsedEvent.type !== "analysis.failed") throw new Error("Invalid failed event.");
        await trusted.rows("SELECT finish_analysis_request($1,$2,$3,$4::jsonb)", [
          command.userId,
          command.requestId,
          command.leaseToken,
          JSON.stringify(parsedEvent),
        ]);
        return parsedEvent;
      });
    },
    async delete(command) {
      return analysisDeleteResponseSchema.parse(
        await deletePostgresAnalysis(options.database, command),
      );
    },
    async findById(userId, id) {
      const rows = await options.database.transaction(userId, ({ tenant }) =>
        tenant.rows<AnalysisRow>(`${selectRecord} WHERE id = $1`, [id]),
      );
      return rows[0] === undefined ? null : mapRecord(rows[0]);
    },
    async list(userId, query) {
      const rows = await options.database.transaction(userId, ({ tenant }) =>
        tenant.rows<AnalysisRow>(
          `${selectRecord} WHERE archived_at IS ${query.archived ? "NOT " : ""}NULL
          AND ($1::text IS NULL OR review_state=$1)
          AND ($2::text IS NULL OR source_type=$2)
          AND ($3::text IS NULL OR selection_kind=$3)
          AND ($4::text IS NULL OR lower(source_text COLLATE "C") LIKE $4 ESCAPE '\\'
            OR lower(COALESCE(source_title,'') COLLATE "C") LIKE $4 ESCAPE '\\')
          AND ($5::timestamptz IS NULL OR (created_at,id)<($5::timestamptz,$6::uuid))
          ORDER BY created_at DESC,id DESC LIMIT $7`,
          [
            query.reviewState ?? null,
            query.sourceType ?? null,
            query.selectionKind ?? null,
            query.query === undefined ? null : `%${escapeLike(query.query)}%`,
            query.boundary?.createdAt ?? null,
            query.boundary?.id ?? null,
            query.limit + 1,
          ],
        ),
      );
      const hasMore = rows.length > query.limit;
      return {
        hasMore,
        items: rows.slice(0, query.limit).map(mapRecord),
      };
    },
    async processNothingToSave(command) {
      return analysisRecordSchema.parse(
        await mutatePostgresAnalysis(options.database, "analysis.process", command),
      );
    },
    async save(userId, record) {
      await options.database.transaction(userId, async ({ tenant }) => {
        await tenant.rows(
          `INSERT INTO analysis_records (id,owner_user_id,study_capture_id,review_state,source_type,
          source_title,source_context,source_text,source_normalized_hash,selection_kind,result,
          model_metadata,revision,created_at,updated_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,$13,$14,$15)`,
          [
            record.id,
            userId,
            record.studyCaptureId ?? null,
            record.reviewState,
            record.source.type,
            record.source.title ?? null,
            record.source.userContext ?? null,
            record.sourceText,
            record.sourceNormalizedHash,
            record.selectionKind,
            JSON.stringify(record.result),
            JSON.stringify(record.modelMetadata),
            record.revision,
            record.createdAt,
            record.updatedAt,
          ],
        );
        for (const candidate of record.candidates) {
          await tenant.rows(
            `INSERT INTO analysis_candidates (id,analysis_id,owner_user_id,candidate_type,
             payload,analysis_unit_id,ordinal) VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7)`,
            [
              candidate.id,
              record.id,
              userId,
              candidate.type,
              JSON.stringify(candidate.payload),
              candidate.analysisUnitId,
              candidate.ordinal,
            ],
          );
        }
      });
      return record;
    },
    async restore(command) {
      return analysisRecordSchema.parse(
        await mutatePostgresAnalysis(options.database, "analysis.restore", command),
      );
    },
  };
}

function escapeLike(value: string): string {
  return value.toLocaleLowerCase("en-US").replace(/[\\%_]/gu, "\\$&");
}

function settlementCalls(
  command: {
    actualCostMicroUsd?: number;
    billedCalls?: Parameters<AnalysisCommitter["complete"]>[0]["billedCalls"];
    usage?: Parameters<AnalysisCommitter["complete"]>[0]["usage"];
  },
  fallbackCostMicroUsd: number,
) {
  if (command.billedCalls !== undefined) {
    return command.billedCalls.map((call) => ({
      cachedInputTokens: call.usage.cachedInputTokens,
      costMicroUsd: call.costMicroUsd,
      inputTokens: call.usage.inputTokens,
      outputTokens: call.usage.outputTokens,
    }));
  }
  return [
    {
      cachedInputTokens: command.usage?.cachedInputTokens ?? null,
      costMicroUsd: fallbackCostMicroUsd,
      inputTokens: command.usage?.inputTokens ?? null,
      outputTokens: command.usage?.outputTokens ?? null,
    },
  ];
}

async function reservedCostMicroUsd(
  query: AnalysisQuery,
  userId: string,
  requestId: string,
  leaseToken: string,
  reservationId: string,
): Promise<number> {
  const rows = await query.rows<{ reserved_micro_usd: string }>(
    `SELECT analysis_reservation_amount($1,$2,$3,$4)::text AS reserved_micro_usd`,
    [userId, requestId, leaseToken, reservationId],
  );
  const value = Number(rows[0]?.reserved_micro_usd);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error("Invalid active reservation.");
  return value;
}

async function quotaSummary(query: AnalysisQuery, userId: string) {
  const rows = await query.rows<{
    limit_micro_usd: string;
    reserved_micro_usd: string;
    used_micro_usd: string;
    period_end: Date;
    period_start: Date;
  }>(
    `SELECT grants.limit_micro_usd::text,
      COALESCE((SELECT sum(cost_micro_usd) FROM usage_ledger WHERE user_id=$1
        AND period_start=grants.period_start),0)::text AS used_micro_usd,
      COALESCE((SELECT sum(reserved_micro_usd) FROM quota_reservations WHERE user_id=$1
        AND period_start=grants.period_start AND status='active'),0)::text AS reserved_micro_usd,
      grants.period_start, grants.period_end FROM quota_grants grants
      WHERE grants.user_id=$1 AND grants.superseded_at IS NULL
      ORDER BY grants.period_start DESC LIMIT 1`,
    [userId],
  );
  const row = rows[0];
  if (row === undefined) throw new Error("Missing quota grant.");
  const limitMicroUsd = Number(row.limit_micro_usd);
  const usedMicroUsd = Number(row.used_micro_usd);
  const reservedMicroUsd = Number(row.reserved_micro_usd);
  const committed = usedMicroUsd + reservedMicroUsd;
  const percentUsed =
    limitMicroUsd === 0 ? 100 : Math.min(100, (usedMicroUsd / limitMicroUsd) * 100);
  return {
    availableMicroUsd: Math.max(0, limitMicroUsd - committed),
    limitMicroUsd,
    percentUsed,
    periodEnd: row.period_end.toISOString(),
    periodStart: row.period_start.toISOString(),
    reservedMicroUsd,
    usedMicroUsd,
    warning:
      committed >= limitMicroUsd
        ? ("exhausted" as const)
        : percentUsed >= 80
          ? ("warning" as const)
          : ("available" as const),
  };
}
