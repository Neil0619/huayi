import { readFile } from "node:fs/promises";

import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AnalysisDatabase, AnalysisQuery } from "./analysis-database.js";
import { createPostgresWordLibrary } from "./postgres-word-library.js";
import { createPostgresWordListExportRepository } from "./word-list-export.js";

const migrationUrl = new URL("../migrations/0001-cloud-v1-foundation.sql", import.meta.url);
const userA = "00000000-0000-0000-0000-00000000000a";
const userB = "00000000-0000-0000-0000-00000000000b";
const wordA = "70000000-0000-0000-0000-00000000000a";
const wordB = "70000000-0000-0000-0000-00000000000b";
const wordC = "70000000-0000-0000-0000-00000000000d";

function query(executor: {
  query<Row>(text: string, parameters?: unknown[]): Promise<{ rows: Row[] }>;
}): AnalysisQuery {
  return {
    rows: async <Row>(text: string, parameters = []) =>
      (await executor.query<Row>(text, [...parameters])).rows,
  };
}

describe("Postgres word library", () => {
  let database: PGlite;
  let adapter: AnalysisDatabase;
  beforeEach(async () => {
    database = new PGlite();
    await database.waitReady;
    await database.exec(await readFile(migrationUrl, "utf8"));
    adapter = {
      async transaction(ownerUserId, operation) {
        return database.transaction(async (transaction) => {
          await transaction.exec("SET LOCAL ROLE huayi_context_setter");
          await transaction.query("SELECT huayi_private.set_owner_context($1)", [ownerUserId]);
          return operation({
            tenant: {
              rows: async (text, parameters) => {
                await transaction.exec("SET LOCAL ROLE huayi_business");
                return query(transaction).rows(text, parameters);
              },
            },
            trusted: query(transaction),
          });
        });
      },
      async trusted(operation) {
        return operation(query(database));
      },
    };
    await database.exec(`INSERT INTO user_profiles(user_id,owner_user_id,email,status,timezone,daily_goal)
      VALUES('${userA}','${userA}','a@example.test','active','UTC',5),
        ('${userB}','${userB}','b@example.test','active','UTC',5);
      INSERT INTO word_entries(id,owner_user_id,headword,canonical_key,notes,revision,created_at,updated_at)
      VALUES('${wordA}','${userA}','Run into','run into','old',1,'2026-08-13T03:00:00Z','2026-08-13T03:00:00Z'),
      ('${wordB}','${userA}','100% sure','100% sure',NULL,1,'2026-08-13T02:00:00Z','2026-08-13T02:00:00Z'),
      ('70000000-0000-0000-0000-00000000000c','${userB}','Run into','run into',NULL,1,
      '2026-08-13T04:00:00Z','2026-08-13T04:00:00Z');
      INSERT INTO context_observations(
        id,owner_user_id,word_entry_id,content_hash,source_text,contextual_meaning,source_type,observed_at
      ) VALUES('71000000-0000-0000-0000-00000000000a','${userA}','${wordA}','a','First.','第一','manual',
      '2026-08-13T04:00:00Z'),('71000000-0000-0000-0000-00000000000b','${userA}','${wordA}','b',
      'Second.','第二','web-selection','2026-08-13T05:00:00Z');
      INSERT INTO external_wordbook_jobs(id,owner_user_id,target,direction,state)
      VALUES('72000000-0000-0000-0000-00000000000a','${userA}','eudic','export','completed');
      INSERT INTO external_wordbook_items(
        id,owner_user_id,job_id,word_entry_id,payload_snapshot,state,attempt_count,receipt
      )
      VALUES('73000000-0000-0000-0000-00000000000a','${userA}',
      '72000000-0000-0000-0000-00000000000a','${wordB}',
      '{"headword":"100% sure"}'::jsonb,'delivered',1,
      '{"outcome":"created","recordedAt":"2026-08-13T03:00:00.000Z","target":"eudic"}'::jsonb);`);
  });
  afterEach(async () => database.close());

  it("filters normalized literal headwords and paginates deterministic contexts under RLS", async () => {
    const words = createPostgresWordLibrary(adapter);
    const exportWords = createPostgresWordListExportRepository(adapter);
    await expect(exportWords.listCanonicalKeys(userA)).resolves.toEqual(["100% sure", "run into"]);
    await expect(exportWords.listCanonicalKeys(userB)).resolves.toEqual(["run into"]);
    await expect(words.list(userA, { canonicalQuery: "100%", limit: 20 })).resolves.toMatchObject({
      items: [{ id: wordB }],
    });
    await expect(words.findById(userB, wordA, { limit: 1 })).resolves.toBeNull();
    const first = await words.findById(userA, wordA, { limit: 1 });
    expect(first).toMatchObject({ contexts: [{ sourceText: "Second." }], hasMore: true });
    const boundary = first?.contexts[0];
    if (boundary === undefined) throw new Error("Expected a context boundary.");
    await expect(
      words.findById(userA, wordA, {
        boundary: { id: boundary.id, observedAt: boundary.observedAt },
        limit: 1,
      }),
    ).resolves.toMatchObject({ contexts: [{ sourceText: "First." }], hasMore: false });
  });

  it("patches and snapshots deletion while refusing externally referenced entries", async () => {
    const words = createPostgresWordLibrary(adapter);
    const patch = {
      idempotencyKey: "patch-1",
      now: "2026-08-13T06:00:00.000Z",
      ownerUserId: userA,
      request: { expectedRevision: 1, notes: null },
      requestHash: "a".repeat(64),
      wordId: wordA,
    };
    await expect(words.patch(patch)).resolves.toMatchObject({ revision: 2 });
    await expect(words.patch(patch)).resolves.toMatchObject({ revision: 2 });
    await expect(
      words.delete({
        idempotencyKey: "delete-referenced",
        now: patch.now,
        ownerUserId: userA,
        request: { expectedRevision: 1 },
        requestHash: "b".repeat(64),
        wordId: wordB,
      }),
    ).rejects.toMatchObject({ code: "word_entry_in_use" });
    const deletion = {
      idempotencyKey: "delete-1",
      now: patch.now,
      ownerUserId: userA,
      request: { expectedRevision: 2 },
      requestHash: "c".repeat(64),
      wordId: wordA,
    };
    await expect(words.delete(deletion)).resolves.toEqual({ deleted: true, id: wordA });
    await expect(words.delete(deletion)).resolves.toEqual({ deleted: true, id: wordA });
    await expect(words.delete({ ...deletion, requestHash: "d".repeat(64) })).rejects.toMatchObject({
      code: "idempotency_conflict",
    });
    const rows = await database.query<{ contexts: number; words: number }>(
      `SELECT (SELECT count(*)::int FROM word_entries WHERE id=$1) words,
       (SELECT count(*)::int FROM context_observations WHERE word_entry_id=$1) contexts`,
      [wordA],
    );
    expect(rows.rows[0]).toEqual({ contexts: 0, words: 0 });
  });

  it("upserts one canonical word and immutable manual contexts without overwriting notes", async () => {
    const words = createPostgresWordLibrary(adapter);
    const create = {
      canonicalKey: "make do",
      context: {
        contentHash: "1".repeat(64),
        contextualMeaningZh: "将就使用",
        id: "71000000-0000-0000-0000-00000000000d",
        observedAt: "2026-08-13T06:00:00.000Z",
        sourceText: "We can make do with this.",
        sourceTitle: "Manual note",
        sourceType: "manual" as const,
      },
      idempotencyKey: "upsert-create",
      now: "2026-08-13T06:00:00.000Z",
      ownerUserId: userA,
      request: {
        context: {
          contextualMeaningZh: "将就使用",
          sourceText: "We can make do with this.",
          sourceTitle: "Manual note",
        },
        headword: "Make do",
        notes: "created note",
      },
      requestHash: "1".repeat(64),
      wordId: wordC,
    };
    await expect(words.upsert(create)).resolves.toMatchObject({
      contextOutcome: "created",
      word: { id: wordC, notes: "created note", revision: 1 },
      wordOutcome: "created",
    });
    await expect(words.upsert(create)).resolves.toMatchObject({ word: { revision: 1 } });
    await expect(words.upsert({ ...create, requestHash: "2".repeat(64) })).rejects.toMatchObject({
      code: "idempotency_conflict",
    });

    const append = {
      ...create,
      canonicalKey: "run into",
      context: {
        contentHash: "2".repeat(64),
        contextualMeaningZh: "偶然遇见",
        id: "71000000-0000-0000-0000-00000000000e",
        observedAt: "2026-08-13T07:00:00.000Z",
        sourceText: "I ran into her.",
        sourceType: "manual" as const,
      },
      idempotencyKey: "upsert-append",
      now: "2026-08-13T07:00:00.000Z",
      request: {
        context: { contextualMeaningZh: "偶然遇见", sourceText: "I ran into her." },
        headword: "RUN INTO",
        notes: "must not overwrite",
      },
      requestHash: "3".repeat(64),
      wordId: "70000000-0000-0000-0000-00000000000e",
    };
    await expect(words.upsert(append)).resolves.toMatchObject({
      contextOutcome: "created",
      word: { headword: "Run into", id: wordA, notes: "old", revision: 2 },
      wordOutcome: "existing",
    });
    await expect(
      words.upsert({
        ...append,
        context: { ...append.context, id: "71000000-0000-0000-0000-00000000000f" },
        idempotencyKey: "upsert-duplicate",
        requestHash: "4".repeat(64),
      }),
    ).resolves.toMatchObject({ contextOutcome: "duplicate", word: { revision: 2 } });
    await expect(
      words.upsert({
        canonicalKey: append.canonicalKey,
        idempotencyKey: "upsert-omitted",
        now: append.now,
        ownerUserId: append.ownerUserId,
        request: { headword: "run into" },
        requestHash: "5".repeat(64),
        wordId: append.wordId,
      }),
    ).resolves.toMatchObject({ contextOutcome: "omitted", word: { revision: 2 } });
    await expect(
      words.upsert({
        canonicalKey: append.canonicalKey,
        idempotencyKey: "upsert-other-owner",
        now: append.now,
        ownerUserId: userB,
        request: { headword: "run into" },
        requestHash: "6".repeat(64),
        wordId: append.wordId,
      }),
    ).resolves.toMatchObject({ word: { id: "70000000-0000-0000-0000-00000000000c" } });

    const concurrent = (suffix: "1" | "2") => ({
      canonicalKey: "hold forth",
      idempotencyKey: `upsert-concurrent-${suffix}`,
      now: "2026-08-13T08:00:00.000Z",
      ownerUserId: userA,
      request: { headword: "hold forth" },
      requestHash: suffix.repeat(64),
      wordId: `70000000-0000-0000-0000-00000000001${suffix}`,
    });
    const converged = await Promise.all([
      words.upsert(concurrent("1")),
      words.upsert(concurrent("2")),
    ]);
    expect(converged.map(({ wordOutcome }) => wordOutcome).sort()).toEqual(["created", "existing"]);
    const convergedRows = await database.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM word_entries WHERE owner_user_id=$1 AND canonical_key='hold forth'",
      [userA],
    );
    expect(convergedRows.rows[0]?.count).toBe(1);

    const stored = await database.query<{
      contexts: number;
      notes: string;
      revision: number;
      source_type: string;
    }>(
      `SELECT w.notes,w.revision,count(c.id)::int AS contexts,max(c.source_type) AS source_type
       FROM word_entries w LEFT JOIN context_observations c ON c.word_entry_id=w.id
       WHERE w.id=$1 GROUP BY w.id`,
      [wordA],
    );
    expect(stored.rows[0]).toEqual({
      contexts: 3,
      notes: "old",
      revision: 2,
      source_type: "web-selection",
    });
  });
});
