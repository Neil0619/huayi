import {
  learningItemDetailResponseSchema,
  learningItemMergeResponseSchema,
} from "@huayi/cloud-contracts";

import type { AnalysisDatabase, AnalysisQuery } from "./analysis-database.js";
import { CloudFault } from "./cloud-fault.js";
import type { LearningLibraryMaintenanceRepository } from "./learning-library-maintenance.js";
import { createPostgresLearningItemDelete } from "./postgres-learning-item-delete.js";
import {
  learningLibraryViewSql,
  mapLearningLibraryView,
  type LibraryRow,
} from "./postgres-learning-library.js";

async function begin(
  trusted: AnalysisQuery,
  ownerUserId: string,
  operation: string,
  idempotencyKey: string,
  requestHash: string,
) {
  const rows = await trusted.rows<{ response: unknown }>(
    "SELECT begin_idempotent_write($1,$2,$3,$4) AS response",
    [ownerUserId, operation, idempotencyKey, requestHash],
  );
  return rows[0]?.response;
}

async function save(
  trusted: AnalysisQuery,
  command: {
    idempotencyKey: string;
    now: string;
    ownerUserId: string;
    requestHash: string;
  },
  operation: string,
  response: unknown,
) {
  const expiresAt = new Date(Date.parse(command.now) + 7 * 24 * 60 * 60 * 1_000).toISOString();
  await trusted.rows(
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

async function view(tenant: AnalysisQuery, id: string) {
  const rows = await tenant.rows<LibraryRow>(`${learningLibraryViewSql} WHERE items.id=$1`, [id]);
  return rows[0] === undefined ? null : mapLearningLibraryView(rows[0]);
}

async function lockedItem(tenant: AnalysisQuery, id: string) {
  const rows = await tenant.rows<{
    archived_at: Date | null;
    revision: number;
    system_attributes: string[];
    type: "expression" | "sentence-pattern";
  }>(
    `SELECT archived_at,revision,system_attributes,type FROM learning_items
      WHERE id=$1 AND deleted_at IS NULL FOR UPDATE`,
    [id],
  );
  if (rows[0] === undefined) throw new CloudFault("not_found", "Learning item not found.");
  return rows[0];
}

function requireActiveItem(item: { archived_at: Date | null }) {
  if (item.archived_at !== null) {
    throw new CloudFault("learning_item_archived", "Learning item is archived.");
  }
}

function requireRevision(actual: number, expected: number) {
  if (actual !== expected) throw new CloudFault("revision_conflict", "Learning item changed.");
}

function contentType(content: { type: string }) {
  return content.type === "sentence_pattern" ? "sentence-pattern" : "expression";
}

async function replaceTags(
  tenant: AnalysisQuery,
  options: { id(): string },
  command: Parameters<LearningLibraryMaintenanceRepository["patch"]>[0],
) {
  await tenant.rows("DELETE FROM learning_item_tags WHERE learning_item_id=$1", [command.id]);
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
}

function translateDatabaseError(error: unknown): never {
  if (error instanceof CloudFault) throw error;
  if (error instanceof Error && error.message.includes("idempotency conflict")) {
    throw new CloudFault("idempotency_conflict", "The idempotency key is already in use.");
  }
  const databaseError = error as { code?: unknown; constraint_name?: unknown };
  if (databaseError.code === "23505") {
    throw new CloudFault("exact_duplicate", "An exact learning item already exists.");
  }
  throw error;
}

export function createPostgresLearningLibraryMaintenance(
  database: AnalysisDatabase,
  options: { id(): string } = { id: () => crypto.randomUUID() },
): LearningLibraryMaintenanceRepository {
  const changeArchiveState = async (
    command: Parameters<LearningLibraryMaintenanceRepository["archive"]>[0],
    operation: "learning.archive" | "learning.restore",
    archive: boolean,
  ) => {
    try {
      return await database.transaction(command.ownerUserId, async ({ tenant, trusted }) => {
        const replay = await begin(
          trusted,
          command.ownerUserId,
          operation,
          command.idempotencyKey,
          command.requestHash,
        );
        if (replay !== null && replay !== undefined) {
          return learningItemDetailResponseSchema.parse(replay);
        }
        const item = await lockedItem(tenant, command.id);
        requireRevision(item.revision, command.expectedRevision);
        if ((item.archived_at !== null) === archive) {
          throw new CloudFault(
            "invalid_request",
            archive ? "Learning item is already archived." : "Learning item is not archived.",
          );
        }
        await tenant.rows(
          `UPDATE learning_items SET archived_at=$2::timestamptz,
            revision=revision+1,updated_at=$3::timestamptz WHERE id=$1`,
          [command.id, archive ? command.now : null, command.now],
        );
        const updated = await view(tenant, command.id);
        if (updated === null) throw new CloudFault("not_found", "Learning item not found.");
        await save(trusted, command, operation, updated);
        return updated;
      });
    } catch (error) {
      return translateDatabaseError(error);
    }
  };
  return {
    archive: (command) => changeArchiveState(command, "learning.archive", true),
    delete: createPostgresLearningItemDelete(database),
    async merge(command) {
      try {
        return await database.transaction(command.ownerUserId, async ({ tenant, trusted }) => {
          const replay = await begin(
            trusted,
            command.ownerUserId,
            "learning.merge",
            command.idempotencyKey,
            command.requestHash,
          );
          if (replay !== null && replay !== undefined) {
            return learningItemMergeResponseSchema.parse(replay);
          }
          if (command.id === command.targetItemId) {
            throw new CloudFault("invalid_request", "Merge items must be different.");
          }
          const source = await lockedItem(tenant, command.id);
          const target = await lockedItem(tenant, command.targetItemId);
          requireRevision(source.revision, command.sourceRevision);
          requireRevision(target.revision, command.targetRevision);
          requireActiveItem(source);
          requireActiveItem(target);
          if (source.type !== target.type) {
            throw new CloudFault("invalid_request", "Learning item types must match.");
          }
          const safety = await tenant.rows<{ level: number; practiced: boolean }>(
            `SELECT schedule.level,
              EXISTS(SELECT 1 FROM practice_session_items WHERE learning_item_id=$1) practiced
              FROM schedule_states schedule WHERE learning_item_id=$1`,
            [command.id],
          );
          if (safety[0]?.practiced !== false || safety[0]?.level !== -1) {
            throw new CloudFault("learning_item_in_use", "This learning item cannot be merged.");
          }
          await tenant.rows(
            `DELETE FROM source_examples source WHERE source.learning_item_id=$1
              AND EXISTS(SELECT 1 FROM source_examples target WHERE target.learning_item_id=$2
                AND target.source_text=source.source_text
                AND target.translation_zh IS NOT DISTINCT FROM source.translation_zh
                AND target.source_type=source.source_type
                AND target.source_title IS NOT DISTINCT FROM source.source_title
                AND target.analysis_id IS NOT DISTINCT FROM source.analysis_id
                AND target.analysis_unit_id IS NOT DISTINCT FROM source.analysis_unit_id)`,
            [command.id, command.targetItemId],
          );
          await tenant.rows(
            "UPDATE source_examples SET learning_item_id=$2 WHERE learning_item_id=$1",
            [command.id, command.targetItemId],
          );
          await tenant.rows(
            `INSERT INTO learning_item_tags(learning_item_id,tag_id,owner_user_id)
              SELECT $2,tag_id,owner_user_id FROM learning_item_tags WHERE learning_item_id=$1
              ON CONFLICT DO NOTHING`,
            [command.id, command.targetItemId],
          );
          await tenant.rows(
            `UPDATE learning_items SET system_attributes=(SELECT COALESCE(
                jsonb_agg(DISTINCT value ORDER BY value),'[]'::jsonb)
              FROM jsonb_array_elements_text(system_attributes || $2::jsonb) value),
              revision=revision+1,updated_at=$3::timestamptz WHERE id=$1`,
            [command.targetItemId, JSON.stringify(source.system_attributes), command.now],
          );
          await tenant.rows("DELETE FROM learning_items WHERE id=$1", [command.id]);
          const merged = await view(tenant, command.targetItemId);
          if (merged === null) throw new CloudFault("not_found", "Learning item not found.");
          const response = learningItemMergeResponseSchema.parse({
            deletedSourceId: command.id,
            target: merged,
          });
          await save(trusted, command, "learning.merge", response);
          return response;
        });
      } catch (error) {
        return translateDatabaseError(error);
      }
    },
    async patch(command) {
      try {
        return await database.transaction(command.ownerUserId, async ({ tenant, trusted }) => {
          const replay = await begin(
            trusted,
            command.ownerUserId,
            "learning.patch",
            command.idempotencyKey,
            command.requestHash,
          );
          if (replay !== null && replay !== undefined) {
            return learningItemDetailResponseSchema.parse(replay);
          }
          const item = await lockedItem(tenant, command.id);
          requireRevision(item.revision, command.expectedRevision);
          requireActiveItem(item);
          if (item.type !== contentType(command.request.content)) {
            throw new CloudFault("invalid_request", "Learning item type cannot change.");
          }
          await tenant.rows(
            `UPDATE learning_items SET canonical_key=$2,content=$3::jsonb,
              system_attributes=$4::jsonb,revision=revision+1,updated_at=$5::timestamptz
              WHERE id=$1`,
            [
              command.id,
              command.canonicalKey,
              JSON.stringify(command.request.content),
              JSON.stringify(command.request.systemAttributes),
              command.now,
            ],
          );
          await replaceTags(tenant, options, command);
          const updated = await view(tenant, command.id);
          if (updated === null) throw new CloudFault("not_found", "Learning item not found.");
          await save(trusted, command, "learning.patch", updated);
          return updated;
        });
      } catch (error) {
        return translateDatabaseError(error);
      }
    },
    async previewMerge(ownerUserId, sourceId, request) {
      return database.transaction(ownerUserId, async ({ tenant }) => {
        if (sourceId === request.targetItemId) {
          throw new CloudFault("invalid_request", "Merge items must be different.");
        }
        const source = await view(tenant, sourceId);
        const target = await view(tenant, request.targetItemId);
        if (source === null || target === null) {
          throw new CloudFault("not_found", "Learning item not found.");
        }
        requireRevision(source.item.revision, request.sourceRevision);
        requireRevision(target.item.revision, request.targetRevision);
        if (source.archivedAt !== null || target.archivedAt !== null) {
          throw new CloudFault("learning_item_archived", "Learning item is archived.");
        }
        if (source.item.type !== target.item.type) {
          throw new CloudFault("invalid_request", "Learning item types must match.");
        }
        const practiced = await tenant.rows<{ exists: boolean }>(
          "SELECT EXISTS(SELECT 1 FROM practice_session_items WHERE learning_item_id=$1) AS exists",
          [sourceId],
        );
        const blockedReason =
          practiced[0]?.exists === true
            ? "source_has_practice_history"
            : source.schedule.level !== -1
              ? "source_is_scheduled"
              : null;
        return {
          allowed: blockedReason === null,
          blockedReason,
          scheduleDecision: "keep-target",
          source,
          target,
        };
      });
    },
    async suggestionContext(ownerUserId, id, expectedRevision) {
      return database.transaction(ownerUserId, async ({ tenant }) => {
        const source = await view(tenant, id);
        if (source === null) throw new CloudFault("not_found", "Learning item not found.");
        requireRevision(source.item.revision, expectedRevision);
        if (source.archivedAt !== null) {
          throw new CloudFault("learning_item_archived", "Learning item is archived.");
        }
        const rows = await tenant.rows<LibraryRow>(
          `${learningLibraryViewSql} WHERE items.id<>$1 AND items.type=$2
            AND items.archived_at IS NULL
            ORDER BY items.updated_at DESC,items.id DESC LIMIT 50`,
          [id, source.item.type],
        );
        return { candidates: rows.map(mapLearningLibraryView), source };
      });
    },
    restore: (command) => changeArchiveState(command, "learning.restore", false),
  };
}
