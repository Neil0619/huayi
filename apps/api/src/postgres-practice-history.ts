import {
  deletePracticeSessionResponseSchema,
  practiceHistoryDetailResponseSchema,
  practiceHistorySummarySchema,
  type PracticeHistorySummary,
} from "@huayi/cloud-contracts";

import type { AnalysisDatabase } from "./analysis-database.js";
import { CloudFault } from "./cloud-fault.js";
import type { PracticeHistoryRepository } from "./practice-history-module.js";
import { loadPracticeSession } from "./postgres-practice-view.js";

interface SummaryRow {
  completed_at: Date | null;
  created_at: Date;
  id: string;
  items: unknown;
  revision: number;
  status: "active" | "awaiting-feedback" | "completed" | "failed";
  type: "dialogue" | "sentence-creation";
  updated_at: Date;
}

const summarySql = `SELECT sessions.id::text,sessions.type,sessions.status,sessions.revision,
  sessions.created_at,sessions.updated_at,sessions.completed_at,
  COALESCE((SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
    'itemId',links.learning_item_id::text,'learningItemDeletedAt',CASE
      WHEN learning.deleted_at IS NULL THEN NULL
      ELSE to_char(learning.deleted_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END,
    'rating',links.rating)) ORDER BY links.position)
    FROM practice_session_items links JOIN learning_items learning
      ON learning.id=links.learning_item_id
    WHERE links.session_id=sessions.id),'[]'::jsonb) items
  FROM practice_sessions sessions`;

function mapSummary(row: SummaryRow): PracticeHistorySummary {
  return practiceHistorySummarySchema.parse({
    completedAt: row.completed_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
    id: row.id,
    items: row.items,
    revision: row.revision,
    status: row.status,
    type: row.type,
    updatedAt: row.updated_at.toISOString(),
  });
}

function translate(error: unknown): never {
  if (error instanceof CloudFault) throw error;
  if (error instanceof Error && error.message.includes("idempotency conflict")) {
    throw new CloudFault("idempotency_conflict", "The idempotency key is already in use.");
  }
  throw error;
}

export function createPostgresPracticeHistory(
  database: AnalysisDatabase,
): PracticeHistoryRepository {
  return {
    async delete(command) {
      try {
        return await database.transaction(command.ownerUserId, async ({ tenant, trusted }) => {
          const replay = await trusted.rows<{ response: unknown }>(
            "SELECT begin_idempotent_write($1,'practice.delete',$2,$3) AS response",
            [command.ownerUserId, command.idempotencyKey, command.requestHash],
          );
          if (replay[0]?.response !== null && replay[0]?.response !== undefined) {
            return deletePracticeSessionResponseSchema.parse(replay[0].response);
          }
          const sessions = await tenant.rows<{
            generation_lease_token: string | null;
            pending_generation: string | null;
            revision: number;
            status: string;
          }>(
            `SELECT status,revision,pending_generation,generation_lease_token
              FROM practice_sessions WHERE id=$1 FOR UPDATE`,
            [command.sessionId],
          );
          const session = sessions[0];
          if (session === undefined)
            throw new CloudFault("not_found", "Practice session not found.");
          if (session.revision !== command.expectedRevision) {
            throw new CloudFault("revision_conflict", "Practice session revision changed.");
          }
          const feedbackLease = await tenant.rows<{ exists: boolean }>(
            `SELECT EXISTS(SELECT 1 FROM practice_attempts WHERE session_id=$1
              AND feedback_lease_token IS NOT NULL) AS exists`,
            [command.sessionId],
          );
          if (
            (session.status !== "completed" && session.status !== "failed") ||
            session.pending_generation !== null ||
            session.generation_lease_token !== null ||
            feedbackLease[0]?.exists === true
          ) {
            throw new CloudFault(
              "practice_session_in_use",
              "This practice session cannot be removed.",
            );
          }
          const response = deletePracticeSessionResponseSchema.parse({
            deleted: true,
            id: command.sessionId,
          });
          const linkedItems = await tenant.rows<{ learning_item_id: string }>(
            "SELECT learning_item_id::text FROM practice_session_items WHERE session_id=$1",
            [command.sessionId],
          );
          await tenant.rows("DELETE FROM practice_sessions WHERE id=$1", [command.sessionId]);
          for (const item of linkedItems) {
            await tenant.rows(
              `DELETE FROM learning_items learning WHERE learning.id=$1
                AND learning.deleted_at IS NOT NULL
                AND NOT EXISTS(SELECT 1 FROM practice_session_items links
                  WHERE links.learning_item_id=learning.id)`,
              [item.learning_item_id],
            );
          }
          const expiresAt = new Date(
            Date.parse(command.now) + 7 * 24 * 60 * 60 * 1_000,
          ).toISOString();
          await tenant.rows(
            `INSERT INTO idempotency_records(
              owner_user_id,operation,key,request_hash,response,expires_at
            ) VALUES($1,'practice.delete',$2,$3,$4::jsonb,$5::timestamptz)`,
            [
              command.ownerUserId,
              command.idempotencyKey,
              command.requestHash,
              JSON.stringify(response),
              expiresAt,
            ],
          );
          return response;
        });
      } catch (error) {
        return translate(error);
      }
    },
    async findById(ownerUserId, id) {
      return database.transaction(ownerUserId, async ({ tenant }) => {
        const rows = await tenant.rows<{ completed_at: Date | null }>(
          "SELECT completed_at FROM practice_sessions WHERE id=$1",
          [id],
        );
        if (rows[0] === undefined) return null;
        const itemLabels = await tenant.rows<{ item_id: string; label: string }>(
          `SELECT links.learning_item_id::text AS item_id,
            CASE items.content->>'type'
              WHEN 'expression' THEN items.content->>'text'
              WHEN 'sentence_pattern' THEN items.content->>'template'
            END AS label
            FROM practice_session_items links
            JOIN learning_items items ON items.id=links.learning_item_id
            WHERE links.session_id=$1 AND items.deleted_at IS NULL AND items.content IS NOT NULL
            ORDER BY links.position`,
          [id],
        );
        return practiceHistoryDetailResponseSchema.parse({
          completedAt: rows[0].completed_at?.toISOString() ?? null,
          itemLabels: itemLabels.map((item) => ({ itemId: item.item_id, label: item.label })),
          session: await loadPracticeSession(tenant, id),
        });
      });
    },
    async list(ownerUserId, query) {
      const rows = await database.transaction(ownerUserId, ({ tenant }) =>
        tenant.rows<SummaryRow>(
          `${summarySql} WHERE ($1::text IS NULL OR sessions.status=$1)
          AND ($2::text IS NULL OR sessions.type=$2)
          AND ($3::uuid IS NULL OR
            ($4::timestamptz IS NULL AND (
              (sessions.completed_at IS NULL AND sessions.id<$3::uuid) OR
              sessions.completed_at IS NOT NULL)) OR
            ($4::timestamptz IS NOT NULL AND sessions.completed_at IS NOT NULL AND
              (sessions.completed_at,sessions.id)<($4::timestamptz,$3::uuid)))
          ORDER BY (sessions.completed_at IS NULL) DESC,
            sessions.completed_at DESC NULLS LAST,sessions.id DESC LIMIT $5`,
          [
            query.status ?? null,
            query.type ?? null,
            query.boundary?.id ?? null,
            query.boundary?.completedAt ?? null,
            query.limit + 1,
          ],
        ),
      );
      return {
        hasMore: rows.length > query.limit,
        items: rows.slice(0, query.limit).map(mapSummary),
      };
    },
  };
}
