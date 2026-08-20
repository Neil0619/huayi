import {
  cloudWordCopyBatchResponseSchema,
  cloudWordCopyResponseSchema,
  type CloudWordCopyBatchResponse,
} from "@huayi/cloud-contracts";

import type { AnalysisDatabase, AnalysisQuery } from "./analysis-database.js";
import { CloudFault } from "./cloud-fault.js";
import type { CloudWordCopyRepository, PreparedCloudWordEntry } from "./cloud-word-copy-module.js";

interface WriteCommand {
  idempotencyKey: string;
  now: string;
  ownerUserId: string;
  requestHash: string;
}

function translate(error: unknown): never {
  if (error instanceof CloudFault) throw error;
  if (error instanceof Error && error.message.includes("idempotency conflict")) {
    throw new CloudFault("idempotency_conflict", "The idempotency key is already in use.");
  }
  throw error;
}

async function idempotentWrite<Response>(
  database: AnalysisDatabase,
  operation: "cloud-word-copy.copy" | "cloud-word-copy.import-local-v2",
  command: WriteCommand,
  parse: (value: unknown) => Response,
  write: (tenant: AnalysisQuery) => Promise<Response>,
): Promise<Response> {
  try {
    return await database.transaction(command.ownerUserId, async ({ tenant, trusted }) => {
      const replay = await trusted.rows<{ response: unknown }>(
        "SELECT begin_idempotent_write($1,$2,$3,$4) AS response",
        [command.ownerUserId, operation, command.idempotencyKey, command.requestHash],
      );
      if (replay[0]?.response !== null && replay[0]?.response !== undefined) {
        return parse(replay[0].response);
      }
      const response = parse(await write(tenant));
      await tenant.rows(
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
      return response;
    });
  } catch (error) {
    return translate(error);
  }
}

async function upsertEntry(
  tenant: AnalysisQuery,
  ownerUserId: string,
  now: string,
  entry: PreparedCloudWordEntry,
) {
  const inserted = await tenant.rows<{ id: string }>(
    `INSERT INTO word_entries(id,owner_user_id,headword,canonical_key,notes,created_at,updated_at)
     VALUES($1,$2,$3,$4,NULL,$5,$5)
     ON CONFLICT(owner_user_id,canonical_key) DO NOTHING RETURNING id::text`,
    [entry.wordId, ownerUserId, entry.headword, entry.canonicalKey, now],
  );
  const current = await tenant.rows<{ id: string }>(
    "SELECT id::text FROM word_entries WHERE canonical_key=$1 FOR UPDATE",
    [entry.canonicalKey],
  );
  const wordId = current[0]?.id;
  if (wordId === undefined) throw new CloudFault("not_found", "Word entry not found.");
  const contexts = [];
  for (const context of entry.contexts) {
    const created = await tenant.rows<{ id: string }>(
      `INSERT INTO context_observations(
         id,owner_user_id,word_entry_id,content_hash,source_text,source_title,
         contextual_meaning,source_type,observed_at,created_at,updated_at
       ) VALUES($1,$2,$3,$4,$5,NULL,$6,$7,$8,$9,$9)
       ON CONFLICT(owner_user_id,word_entry_id,content_hash) DO NOTHING RETURNING id::text`,
      [
        context.contextId,
        ownerUserId,
        wordId,
        context.contentHash,
        context.sentence,
        context.contextualMeaningZh ?? null,
        context.sourceType,
        context.collectedAt,
        now,
      ],
    );
    contexts.push({
      contextKey: context.contextKey,
      outcome: created.length === 0 ? ("duplicate" as const) : ("created" as const),
    });
  }
  if (contexts.some((context) => context.outcome === "created") && inserted.length === 0) {
    await tenant.rows("UPDATE word_entries SET revision=revision+1,updated_at=$2 WHERE id=$1", [
      wordId,
      now,
    ]);
  }
  return {
    contexts,
    entryKey: entry.entryKey,
    wordId,
    wordOutcome: inserted.length === 0 ? ("existing" as const) : ("created" as const),
  };
}

function summary(entries: Awaited<ReturnType<typeof upsertEntry>>[]) {
  const contexts = entries.flatMap((entry) => entry.contexts);
  return {
    contextCount: contexts.length,
    createdContextCount: contexts.filter((context) => context.outcome === "created").length,
    createdWordCount: entries.filter((entry) => entry.wordOutcome === "created").length,
    duplicateContextCount: contexts.filter((context) => context.outcome === "duplicate").length,
    existingWordCount: entries.filter((entry) => entry.wordOutcome === "existing").length,
    wordCount: entries.length,
  };
}

export function createPostgresCloudWordCopy(database: AnalysisDatabase): CloudWordCopyRepository {
  return {
    copy(command) {
      return idempotentWrite(
        database,
        "cloud-word-copy.copy",
        command,
        (value) => cloudWordCopyResponseSchema.parse(value),
        async (tenant) => {
          const result = await upsertEntry(tenant, command.ownerUserId, command.now, command.entry);
          return cloudWordCopyResponseSchema.parse({
            contextCreated: result.contexts[0]?.outcome === "created",
            wordId: result.wordId,
          });
        },
      );
    },
    importBatch(command) {
      return idempotentWrite(
        database,
        "cloud-word-copy.import-local-v2",
        command,
        (value) => cloudWordCopyBatchResponseSchema.parse(value),
        async (tenant): Promise<CloudWordCopyBatchResponse> => {
          const entries = [];
          for (const entry of command.entries) {
            entries.push(await upsertEntry(tenant, command.ownerUserId, command.now, entry));
          }
          return cloudWordCopyBatchResponseSchema.parse({ entries, summary: summary(entries) });
        },
      );
    },
  };
}
