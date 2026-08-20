import {
  createLearningItemResponseSchema,
  learningItemDetailResponseSchema,
  type LearningItemDetailResponse,
} from "@huayi/cloud-contracts";

import type { AnalysisDatabase } from "./analysis-database.js";
import { CloudFault } from "./cloud-fault.js";
import type { LearningLibraryRepository } from "./learning-library-module.js";

export interface LibraryRow {
  archived_at: Date | null;
  canonical_key: string;
  consecutive_mastered: number;
  content: unknown;
  created_at: Date;
  due_at: Date | null;
  has_practice_history: boolean;
  id: string;
  last_rating: "effortful" | "forgot" | "mastered" | null;
  level: number;
  practice_completed_at: Date | null;
  practice_rating: "effortful" | "forgot" | "mastered" | null;
  practice_session_id: string | null;
  practice_type: "dialogue" | "sentence-creation" | null;
  revision: number;
  source_examples: unknown;
  system_attributes: string[];
  tags: string[];
  type: "expression" | "sentence-pattern";
  updated_at: Date;
}

export const learningLibraryViewSql = `SELECT items.id::text,items.type,items.canonical_key,items.content,
  items.archived_at,
  items.system_attributes,items.revision,items.created_at,items.updated_at,
  schedule.level,schedule.due_at,schedule.consecutive_mastered,schedule.last_rating,
  EXISTS(SELECT 1 FROM practice_session_items history
    WHERE history.learning_item_id=items.id) has_practice_history,
  COALESCE((SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
    'id',sources.id::text,'analysisId',sources.analysis_id::text,
    'analysisUnitId',sources.analysis_unit_id,'sourceText',sources.source_text,
    'sourceTitle',sources.source_title,'sourceType',sources.source_type,
    'translationZh',sources.translation_zh)) ORDER BY sources.created_at,sources.id)
    FROM source_examples sources WHERE sources.learning_item_id=items.id),'[]'::jsonb) source_examples,
  COALESCE((SELECT jsonb_agg(tags.display_name ORDER BY tags.normalized_name)
    FROM learning_item_tags joins JOIN tags ON tags.id=joins.tag_id
    WHERE joins.learning_item_id=items.id),'[]'::jsonb) tags,
  recent.id::text practice_session_id,recent.type practice_type,
  recent.updated_at practice_completed_at,recent.rating practice_rating
  FROM learning_items items JOIN schedule_states schedule
    ON schedule.learning_item_id=items.id AND items.deleted_at IS NULL
  LEFT JOIN LATERAL (SELECT sessions.id,sessions.type,sessions.updated_at,links.rating
    FROM practice_session_items links JOIN practice_sessions sessions ON sessions.id=links.session_id
    WHERE links.learning_item_id=items.id AND sessions.status='completed' AND links.rating IS NOT NULL
    ORDER BY sessions.updated_at DESC,sessions.id DESC LIMIT 1) recent ON TRUE`;

export function mapLearningLibraryView(row: LibraryRow): LearningItemDetailResponse {
  return learningItemDetailResponseSchema.parse({
    archivedAt: row.archived_at?.toISOString() ?? null,
    hasPracticeHistory: row.has_practice_history,
    item: {
      canonicalKey: row.canonical_key,
      content: row.content,
      createdAt: row.created_at.toISOString(),
      id: row.id,
      revision: row.revision,
      sourceExamples: row.source_examples,
      systemAttributes: row.system_attributes,
      tags: row.tags,
      type: row.type,
      updatedAt: row.updated_at.toISOString(),
    },
    recentPractice:
      row.practice_session_id === null ||
      row.practice_type === null ||
      row.practice_completed_at === null ||
      row.practice_rating === null
        ? null
        : {
            completedAt: row.practice_completed_at.toISOString(),
            rating: row.practice_rating,
            sessionId: row.practice_session_id,
            type: row.practice_type,
          },
    schedule: {
      consecutiveMastered: row.consecutive_mastered,
      dueAt: row.due_at?.toISOString() ?? null,
      ...(row.last_rating === null ? {} : { lastRating: row.last_rating }),
      level: row.level,
    },
  });
}

function escapeLike(value: string) {
  return value
    .toLocaleLowerCase("en-US")
    .replaceAll("\\", "\\\\")
    .replaceAll("%", "\\%")
    .replaceAll("_", "\\_");
}

export function createPostgresLearningLibrary(
  database: AnalysisDatabase,
  options: { id(): string } = { id: () => crypto.randomUUID() },
): LearningLibraryRepository {
  return {
    async create(command) {
      try {
        return await database.transaction(command.ownerUserId, async ({ tenant, trusted }) => {
          const replay = await trusted.rows<{ response: unknown }>(
            "SELECT begin_idempotent_write($1,'learning.create',$2,$3) AS response",
            [command.ownerUserId, command.idempotencyKey, command.requestHash],
          );
          if (replay[0]?.response !== null && replay[0]?.response !== undefined) {
            return createLearningItemResponseSchema.parse(replay[0].response);
          }
          const exact = await tenant.rows<{ id: string }>(
            `SELECT id::text FROM learning_items
              WHERE type=$1 AND canonical_key=$2 AND deleted_at IS NULL LIMIT 1`,
            [
              command.request.content.type === "sentence_pattern"
                ? "sentence-pattern"
                : "expression",
              command.canonicalKey,
            ],
          );
          if (exact[0] !== undefined) {
            throw new CloudFault("exact_duplicate", "An exact learning item already exists.");
          }
          await tenant.rows(
            `INSERT INTO learning_items(
              id,owner_user_id,type,canonical_key,content,system_attributes,revision,created_at,updated_at
            ) VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb,1,$7::timestamptz,$7::timestamptz)`,
            [
              command.id,
              command.ownerUserId,
              command.request.content.type === "sentence_pattern"
                ? "sentence-pattern"
                : "expression",
              command.canonicalKey,
              JSON.stringify(command.request.content),
              JSON.stringify(command.request.systemAttributes),
              command.now,
            ],
          );
          await tenant.rows(
            `INSERT INTO schedule_states(
              learning_item_id,owner_user_id,level,due_at,consecutive_mastered
            ) VALUES($1,$2,-1,NULL,0)`,
            [command.id, command.ownerUserId],
          );
          for (const tag of command.tags) {
            await tenant.rows(
              `INSERT INTO tags(id,owner_user_id,normalized_name,display_name)
                VALUES($1,$2,$3,$4) ON CONFLICT(owner_user_id,normalized_name) DO NOTHING`,
              [options.id(), command.ownerUserId, tag.normalizedName, tag.displayName.trim()],
            );
            await tenant.rows(
              `INSERT INTO learning_item_tags(learning_item_id,tag_id,owner_user_id)
                SELECT $1,id,$2 FROM tags WHERE normalized_name=$3`,
              [command.id, command.ownerUserId, tag.normalizedName],
            );
          }
          const rows = await tenant.rows<LibraryRow>(
            `${learningLibraryViewSql} WHERE items.id=$1`,
            [command.id],
          );
          if (rows[0] === undefined) {
            throw new CloudFault("not_found", "Created learning item could not be read.");
          }
          const response = mapLearningLibraryView(rows[0]);
          const expiresAt = new Date(
            Date.parse(command.now) + 7 * 24 * 60 * 60 * 1_000,
          ).toISOString();
          await trusted.rows(
            `INSERT INTO idempotency_records(
              owner_user_id,operation,key,request_hash,response,expires_at
            ) VALUES($1,'learning.create',$2,$3,$4::jsonb,$5::timestamptz)`,
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
        if (error instanceof CloudFault) throw error;
        if (error instanceof Error && error.message.includes("idempotency conflict")) {
          throw new CloudFault("idempotency_conflict", "The idempotency key is already in use.");
        }
        const databaseError = error as { code?: unknown; constraint_name?: unknown };
        if (
          databaseError.code === "23505" &&
          typeof databaseError.constraint_name === "string" &&
          databaseError.constraint_name.includes("learning_items")
        ) {
          throw new CloudFault("exact_duplicate", "An exact learning item already exists.");
        }
        throw error;
      }
    },
    async findById(ownerUserId, id) {
      const rows = await database.transaction(ownerUserId, ({ tenant }) =>
        tenant.rows<LibraryRow>(`${learningLibraryViewSql} WHERE items.id=$1`, [id]),
      );
      return rows[0] === undefined ? null : mapLearningLibraryView(rows[0]);
    },
    async list(ownerUserId, query) {
      const rows = await database.transaction(ownerUserId, ({ tenant }) =>
        tenant.rows<LibraryRow>(
          `${learningLibraryViewSql} WHERE
          (($1::boolean AND items.archived_at IS NOT NULL) OR
            (NOT $1::boolean AND items.archived_at IS NULL))
          AND ($2::text IS NULL OR items.type=$2)
          AND ($3::text IS NULL OR EXISTS (SELECT 1 FROM learning_item_tags j JOIN tags t ON t.id=j.tag_id
            WHERE j.learning_item_id=items.id AND t.normalized_name=$3))
          AND ($4::text IS NULL OR items.system_attributes ? $4)
          AND ($5::text IS NULL OR lower(items.content::text COLLATE "C") LIKE $5 ESCAPE '\\')
          AND ($6::text IS NULL OR ($6='new' AND schedule.level=-1)
            OR ($6='due' AND schedule.level>=0 AND schedule.due_at<=$7::timestamptz))
          AND ($8::timestamptz IS NULL OR (items.created_at,items.id)<($8::timestamptz,$9::uuid))
          ORDER BY items.created_at DESC,items.id DESC LIMIT $10`,
          [
            query.archived,
            query.type ?? null,
            query.tag ?? null,
            query.systemAttribute ?? null,
            query.query === undefined ? null : `%${escapeLike(query.query)}%`,
            query.due ?? null,
            query.dueAt,
            query.boundary?.createdAt ?? null,
            query.boundary?.id ?? null,
            query.limit + 1,
          ],
        ),
      );
      return {
        hasMore: rows.length > query.limit,
        items: rows.slice(0, query.limit).map(mapLearningLibraryView),
      };
    },
  };
}
