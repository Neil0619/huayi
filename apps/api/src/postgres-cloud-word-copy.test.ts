import { readFile } from "node:fs/promises";

import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AnalysisDatabase, AnalysisQuery } from "./analysis-database.js";
import { createCloudWordCopyModule } from "./cloud-word-copy-module.js";
import { createPostgresCloudWordCopy } from "./postgres-cloud-word-copy.js";

const migrationUrl = new URL("../migrations/0001-cloud-v1-foundation.sql", import.meta.url);
const userA = "00000000-0000-0000-0000-00000000000a";
const userB = "00000000-0000-0000-0000-00000000000b";
const existingWordId = "10000000-0000-0000-0000-000000000001";

function query(executor: {
  query<Row>(text: string, parameters?: unknown[]): Promise<{ rows: Row[] }>;
}): AnalysisQuery {
  return {
    rows: async <Row>(text: string, parameters = []) =>
      (await executor.query<Row>(text, [...parameters])).rows,
  };
}

describe("Postgres CloudWordCopy authority", () => {
  let database: PGlite;
  let adapter: AnalysisDatabase;
  let sequence: number;

  beforeEach(async () => {
    database = new PGlite();
    await database.waitReady;
    await database.exec(await readFile(migrationUrl, "utf8"));
    adapter = {
      async transaction(ownerUserId, operation) {
        return database.transaction(async (transaction) => {
          await transaction.exec("SET LOCAL ROLE huayi_context_setter");
          await transaction.query("SELECT huayi_private.set_owner_context($1)", [ownerUserId]);
          const execute = query(transaction);
          return operation({
            tenant: {
              rows: async (text, parameters) => {
                await transaction.exec("SET LOCAL ROLE huayi_business");
                return execute.rows(text, parameters);
              },
            },
            trusted: {
              rows: async (text, parameters) => {
                await transaction.exec("SET LOCAL ROLE huayi_context_setter");
                return execute.rows(text, parameters);
              },
            },
          });
        });
      },
      async trusted(operation) {
        return database.transaction((transaction) => operation(query(transaction)));
      },
    };
    sequence = 0;
    await database.exec(`INSERT INTO user_profiles
      (user_id,owner_user_id,email,status,timezone,daily_goal)
      VALUES ('${userA}','${userA}','a@example.test','active','UTC',5),
        ('${userB}','${userB}','b@example.test','active','UTC',5);
      INSERT INTO word_entries(id,owner_user_id,headword,canonical_key,notes)
      VALUES('${existingWordId}','${userA}','sustain','sustain','keep this note');`);
  });

  afterEach(async () => database.close());

  const module = () =>
    createCloudWordCopyModule({
      ids: () => `90000000-0000-0000-0000-${String(++sequence).padStart(12, "0")}`,
      now: () => new Date("2026-08-13T10:00:00.000Z"),
      repository: createPostgresCloudWordCopy(adapter),
    });

  it("copies local-first observations without overwriting notes and dedupes exact context", async () => {
    const copy = {
      collectedAt: "2026-08-12T08:00:00.000Z",
      contextualMeaningZh: "维持",
      headword: "sustain",
      sentence: "The effort cannot be sustained.",
    };
    const words = module();
    await expect(words.copy(userA, "copy-key", copy)).resolves.toEqual({
      contextCreated: true,
      wordId: existingWordId,
    });
    await expect(words.copy(userA, "copy-key", copy)).resolves.toEqual({
      contextCreated: true,
      wordId: existingWordId,
    });
    await expect(
      words.copy(userA, "copy-second", {
        ...copy,
        collectedAt: "2026-08-12T09:00:00.000Z",
      }),
    ).resolves.toEqual({ contextCreated: false, wordId: existingWordId });
    await expect(
      words.copy(userA, "copy-key", { ...copy, sentence: "Changed." }),
    ).rejects.toMatchObject({ code: "idempotency_conflict" });

    const state = await database.query<{
      contextual_meaning: string;
      notes: string;
      observed_at: Date;
      revision: number;
      source_type: string;
    }>(`SELECT words.notes,words.revision,contexts.contextual_meaning,contexts.source_type,
      contexts.observed_at FROM word_entries words JOIN context_observations contexts
      ON contexts.word_entry_id=words.id WHERE words.id='${existingWordId}'`);
    expect(state.rows).toMatchObject([
      {
        contextual_meaning: "维持",
        notes: "keep this note",
        observed_at: new Date(copy.collectedAt),
        revision: 2,
        source_type: "extension-collection",
      },
    ]);
    await expect(words.copy(userB, "copy-user-b", copy)).resolves.toMatchObject({
      contextCreated: true,
    });
    expect(
      (await database.query("SELECT 1 FROM word_entries WHERE canonical_key='sustain'")).rows,
    ).toHaveLength(2);
  });

  it("atomically imports and replays a confirmed local batch", async () => {
    const words = module();
    await words.copy(userA, "copy-before-import", {
      collectedAt: "2026-08-11T08:00:00.000Z",
      contextualMeaningZh: "维持",
      headword: "sustain",
      sentence: "The effort cannot be sustained.",
    });
    const request = {
      entries: [
        {
          contexts: [
            {
              collectedAt: "2026-08-12T08:00:00.000Z",
              contextKey: "local-sustain-context-1",
              contextualMeaningZh: "维持",
              sentence: "The effort cannot be sustained.",
            },
            {
              collectedAt: "2026-08-12T09:00:00.000Z",
              contextKey: "local-sustain-context-2",
              sentence: "Sustain the note.",
            },
          ],
          entryKey: "local-sustain",
          headword: "sustain",
        },
        {
          contexts: [],
          entryKey: "local-acquire",
          headword: "acquire",
        },
      ],
    };
    const first = await words.importLocal(userA, "batch-key", request);
    expect(first.entries).toMatchObject([
      {
        contexts: [
          { contextKey: "local-sustain-context-1", outcome: "duplicate" },
          { contextKey: "local-sustain-context-2", outcome: "created" },
        ],
        entryKey: "local-sustain",
        wordId: existingWordId,
        wordOutcome: "existing",
      },
      { contexts: [], entryKey: "local-acquire", wordOutcome: "created" },
    ]);
    expect(first.summary).toEqual({
      contextCount: 2,
      createdContextCount: 1,
      createdWordCount: 1,
      duplicateContextCount: 1,
      existingWordCount: 1,
      wordCount: 2,
    });
    await expect(words.importLocal(userA, "batch-key", request)).resolves.toEqual(first);
    await expect(
      words.importLocal(userA, "batch-key", {
        ...request,
        entries: request.entries.map((entry, index) =>
          index === 0
            ? {
                ...entry,
                contexts: entry.contexts.map((context, contextIndex) =>
                  contextIndex === 0 ? { ...context, contextualMeaningZh: "改变" } : context,
                ),
              }
            : entry,
        ),
      }),
    ).rejects.toMatchObject({ code: "idempotency_conflict" });
    expect((await database.query("SELECT 1 FROM word_entries")).rows).toHaveLength(2);
    expect((await database.query("SELECT 1 FROM context_observations")).rows).toHaveLength(2);
    expect(
      (
        await database.query<{
          contextual_meaning: string | null;
          revision: number;
          source_type: string;
        }>(
          `SELECT contexts.contextual_meaning,contexts.source_type,words.revision
           FROM word_entries words JOIN context_observations contexts
             ON contexts.word_entry_id=words.id
           WHERE words.id=$1 ORDER BY contexts.observed_at`,
          [existingWordId],
        )
      ).rows,
    ).toEqual([
      {
        contextual_meaning: "维持",
        revision: 3,
        source_type: "extension-collection",
      },
      {
        contextual_meaning: null,
        revision: 3,
        source_type: "extension-local-import",
      },
    ]);
  });
});
