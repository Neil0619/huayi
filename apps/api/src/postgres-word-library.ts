import {
  contextObservationSchema,
  deleteWordEntryResponseSchema,
  patchWordEntryResponseSchema,
  upsertWordResponseSchema,
  wordEntryCoreSchema,
  type WordEntryCore,
} from "@huayi/cloud-contracts";

import type { AnalysisDatabase } from "./analysis-database.js";
import { CloudFault } from "./cloud-fault.js";
import type { WordLibraryRepository } from "./word-library-module.js";

interface WordRow {
  canonical_key: string;
  created_at: Date;
  headword: string;
  id: string;
  notes: string | null;
  revision: number;
  updated_at: Date;
}
interface ContextRow {
  contextual_meaning: string | null;
  id: string;
  observed_at: Date;
  source_text: string | null;
  source_title: string | null;
  source_type: string;
}

function mapWord(row: WordRow): WordEntryCore {
  return wordEntryCoreSchema.parse({
    canonicalKey: row.canonical_key,
    createdAt: row.created_at.toISOString(),
    headword: row.headword,
    id: row.id,
    ...(row.notes === null ? {} : { notes: row.notes }),
    revision: row.revision,
    updatedAt: row.updated_at.toISOString(),
  });
}

function mapContext(row: ContextRow) {
  return contextObservationSchema.parse({
    ...(row.contextual_meaning === null ? {} : { contextualMeaningZh: row.contextual_meaning }),
    id: row.id,
    observedAt: row.observed_at.toISOString(),
    ...(row.source_text === null ? {} : { sourceText: row.source_text }),
    ...(row.source_title === null ? {} : { sourceTitle: row.source_title }),
    sourceType: row.source_type,
  });
}

function escapeLike(value: string) {
  return value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
}

function translate(error: unknown): never {
  if (error instanceof CloudFault) throw error;
  if (error instanceof Error && error.message.includes("idempotency conflict")) {
    throw new CloudFault("idempotency_conflict", "The idempotency key is already in use.");
  }
  throw error;
}

const selectWord = `SELECT id::text,headword,canonical_key,notes,revision,created_at,updated_at
  FROM word_entries`;

export function createPostgresWordLibrary(database: AnalysisDatabase): WordLibraryRepository {
  const loadContexts = async (
    tenant: { rows<Row>(text: string, parameters?: readonly unknown[]): Promise<Row[]> },
    wordId: string,
    query: { boundary?: { id: string; observedAt: string }; limit: number },
  ) => {
    const rows = await tenant.rows<ContextRow>(
      `SELECT id::text,source_text,source_title,contextual_meaning,source_type,observed_at
       FROM context_observations WHERE word_entry_id=$1
       AND ($2::timestamptz IS NULL OR (observed_at,id)<($2::timestamptz,$3::uuid))
       ORDER BY observed_at DESC,id DESC LIMIT $4`,
      [wordId, query.boundary?.observedAt ?? null, query.boundary?.id ?? null, query.limit + 1],
    );
    return {
      contexts: rows.slice(0, query.limit).map(mapContext),
      hasMore: rows.length > query.limit,
    };
  };
  return {
    async delete(command) {
      try {
        return await database.transaction(command.ownerUserId, async ({ tenant, trusted }) => {
          const replay = await trusted.rows<{ response: unknown }>(
            "SELECT begin_idempotent_write($1,'word.delete',$2,$3) AS response",
            [command.ownerUserId, command.idempotencyKey, command.requestHash],
          );
          if (replay[0]?.response !== null && replay[0]?.response !== undefined) {
            return deleteWordEntryResponseSchema.parse(replay[0].response);
          }
          const rows = await tenant.rows<{ revision: number }>(
            "SELECT revision FROM word_entries WHERE id=$1 FOR UPDATE",
            [command.wordId],
          );
          if (rows[0] === undefined) throw new CloudFault("not_found", "Word entry not found.");
          if (rows[0].revision !== command.request.expectedRevision) {
            throw new CloudFault("revision_conflict", "Word entry revision changed.");
          }
          const reference = await tenant.rows<{ exists: boolean }>(
            "SELECT EXISTS(SELECT 1 FROM external_wordbook_items WHERE word_entry_id=$1) AS exists",
            [command.wordId],
          );
          if (reference[0]?.exists === true) {
            throw new CloudFault("word_entry_in_use", "This word entry cannot be removed.");
          }
          const response = deleteWordEntryResponseSchema.parse({
            deleted: true,
            id: command.wordId,
          });
          await tenant.rows("DELETE FROM word_entries WHERE id=$1", [command.wordId]);
          await tenant.rows(
            `INSERT INTO idempotency_records(owner_user_id,operation,key,request_hash,response,expires_at)
             VALUES($1,'word.delete',$2,$3,$4::jsonb,$5::timestamptz)`,
            [
              command.ownerUserId,
              command.idempotencyKey,
              command.requestHash,
              JSON.stringify(response),
              new Date(Date.parse(command.now) + 7 * 86_400_000).toISOString(),
            ],
          );
          return response;
        });
      } catch (error) {
        return translate(error);
      }
    },
    async findById(ownerUserId, wordId, query) {
      return database.transaction(ownerUserId, async ({ tenant }) => {
        const rows = await tenant.rows<WordRow>(`${selectWord} WHERE id=$1`, [wordId]);
        if (rows[0] === undefined) return null;
        return { ...(await loadContexts(tenant, wordId, query)), word: mapWord(rows[0]) };
      });
    },
    async list(ownerUserId, query) {
      const rows = await database.transaction(ownerUserId, ({ tenant }) =>
        tenant.rows<WordRow>(
          `${selectWord} WHERE ($1::text IS NULL OR canonical_key COLLATE "C" LIKE $1 ESCAPE '\\')
           AND ($2::timestamptz IS NULL OR (created_at,id)<($2::timestamptz,$3::uuid))
           ORDER BY created_at DESC,id DESC LIMIT $4`,
          [
            query.canonicalQuery === undefined ? null : `%${escapeLike(query.canonicalQuery)}%`,
            query.boundary?.createdAt ?? null,
            query.boundary?.id ?? null,
            query.limit + 1,
          ],
        ),
      );
      return {
        hasMore: rows.length > query.limit,
        items: rows.slice(0, query.limit).map(mapWord),
      };
    },
    async patch(command) {
      try {
        return await database.transaction(command.ownerUserId, async ({ tenant, trusted }) => {
          const replay = await trusted.rows<{ response: unknown }>(
            "SELECT begin_idempotent_write($1,'word.patch',$2,$3) AS response",
            [command.ownerUserId, command.idempotencyKey, command.requestHash],
          );
          if (replay[0]?.response !== null && replay[0]?.response !== undefined) {
            return patchWordEntryResponseSchema.parse(replay[0].response);
          }
          const current = await tenant.rows<{ revision: number }>(
            "SELECT revision FROM word_entries WHERE id=$1 FOR UPDATE",
            [command.wordId],
          );
          if (current[0] === undefined) throw new CloudFault("not_found", "Word entry not found.");
          if (current[0].revision !== command.request.expectedRevision) {
            throw new CloudFault("revision_conflict", "Word entry revision changed.");
          }
          await tenant.rows(
            "UPDATE word_entries SET notes=$2,revision=revision+1,updated_at=$3 WHERE id=$1",
            [command.wordId, command.request.notes, command.now],
          );
          const updated = await tenant.rows<WordRow>(`${selectWord} WHERE id=$1`, [command.wordId]);
          if (updated[0] === undefined) {
            throw new CloudFault("not_found", "Word entry not found.");
          }
          const response = mapWord(updated[0]);
          await tenant.rows(
            `INSERT INTO idempotency_records(owner_user_id,operation,key,request_hash,response,expires_at)
             VALUES($1,'word.patch',$2,$3,$4::jsonb,$5::timestamptz)`,
            [
              command.ownerUserId,
              command.idempotencyKey,
              command.requestHash,
              JSON.stringify(response),
              new Date(Date.parse(command.now) + 7 * 86_400_000).toISOString(),
            ],
          );
          return response;
        });
      } catch (error) {
        return translate(error);
      }
    },
    async upsert(command) {
      try {
        return await database.transaction(command.ownerUserId, async ({ tenant, trusted }) => {
          const replay = await trusted.rows<{ response: unknown }>(
            "SELECT begin_idempotent_write($1,'word.upsert',$2,$3) AS response",
            [command.ownerUserId, command.idempotencyKey, command.requestHash],
          );
          if (replay[0]?.response !== null && replay[0]?.response !== undefined) {
            return upsertWordResponseSchema.parse(replay[0].response);
          }
          const inserted = await tenant.rows<{ id: string }>(
            `INSERT INTO word_entries(
               id,owner_user_id,headword,canonical_key,notes,created_at,updated_at
             ) VALUES($1,$2,$3,$4,$5,$6,$6)
             ON CONFLICT(owner_user_id,canonical_key) DO NOTHING RETURNING id::text`,
            [
              command.wordId,
              command.ownerUserId,
              command.request.headword,
              command.canonicalKey,
              command.request.notes ?? null,
              command.now,
            ],
          );
          const wordOutcome = inserted.length > 0 ? "created" : "existing";
          const current = await tenant.rows<WordRow>(
            `${selectWord} WHERE canonical_key=$1 FOR UPDATE`,
            [command.canonicalKey],
          );
          const word = current[0];
          if (word === undefined) throw new CloudFault("not_found", "Word entry not found.");
          let contextOutcome: "created" | "duplicate" | "omitted" = "omitted";
          if (command.context !== undefined) {
            const context = command.context;
            const contextRows = await tenant.rows<{ id: string }>(
              `INSERT INTO context_observations(
                 id,owner_user_id,word_entry_id,content_hash,source_text,source_title,
                 contextual_meaning,source_type,observed_at,created_at,updated_at
               ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$9,$9)
               ON CONFLICT(owner_user_id,word_entry_id,content_hash) DO NOTHING RETURNING id::text`,
              [
                context.id,
                command.ownerUserId,
                word.id,
                context.contentHash,
                context.sourceText ?? null,
                context.sourceTitle ?? null,
                context.contextualMeaningZh ?? null,
                context.sourceType,
                context.observedAt,
              ],
            );
            contextOutcome = contextRows.length > 0 ? "created" : "duplicate";
            if (contextOutcome === "created" && wordOutcome === "existing") {
              const updated = await tenant.rows<WordRow>(
                `UPDATE word_entries SET revision=revision+1,updated_at=$2
                 WHERE id=$1 RETURNING id::text,headword,canonical_key,notes,revision,created_at,updated_at`,
                [word.id, command.now],
              );
              if (updated[0] !== undefined) current[0] = updated[0];
            }
          }
          const response = upsertWordResponseSchema.parse({
            contextOutcome,
            word: mapWord(current[0] ?? word),
            wordOutcome,
          });
          await tenant.rows(
            `INSERT INTO idempotency_records(owner_user_id,operation,key,request_hash,response,expires_at)
             VALUES($1,'word.upsert',$2,$3,$4::jsonb,$5::timestamptz)`,
            [
              command.ownerUserId,
              command.idempotencyKey,
              command.requestHash,
              JSON.stringify(response),
              new Date(Date.parse(command.now) + 7 * 86_400_000).toISOString(),
            ],
          );
          return response;
        });
      } catch (error) {
        return translate(error);
      }
    },
  };
}
