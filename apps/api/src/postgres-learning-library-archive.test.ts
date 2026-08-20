import { readFile } from "node:fs/promises";

import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AnalysisDatabase, AnalysisQuery } from "./analysis-database.js";
import { createPostgresLearningLibrary } from "./postgres-learning-library.js";
import { createPostgresLearningLibraryMaintenance } from "./postgres-learning-library-maintenance.js";

const migrationUrl = new URL("../migrations/0001-cloud-v1-foundation.sql", import.meta.url);
const ownerUserId = "00000000-0000-0000-0000-00000000000a";
const itemId = "60000000-0000-0000-0000-00000000000a";

function query(executor: {
  query<Row>(text: string, parameters?: unknown[]): Promise<{ rows: Row[] }>;
}): AnalysisQuery {
  return {
    rows: async <Row>(text: string, parameters = []) =>
      (await executor.query<Row>(text, [...parameters])).rows,
  };
}

describe("Postgres learning item archive", () => {
  let database: PGlite;
  let adapter: AnalysisDatabase;

  beforeEach(async () => {
    database = new PGlite();
    await database.waitReady;
    await database.exec(await readFile(migrationUrl, "utf8"));
    adapter = {
      async transaction(userId, operation) {
        return database.transaction(async (transaction) => {
          await transaction.exec("SET LOCAL ROLE huayi_context_setter");
          await transaction.query("SELECT huayi_private.set_owner_context($1)", [userId]);
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
    await database.exec(`INSERT INTO user_profiles(
        user_id,owner_user_id,email,status,timezone,daily_goal
      ) VALUES('${ownerUserId}','${ownerUserId}','a@example.test','active','UTC',5);
      INSERT INTO learning_items(id,owner_user_id,type,canonical_key,content,created_at)
      VALUES('${itemId}','${ownerUserId}','expression','to be frank',
        '{"type":"expression","text":"to be frank","meaningZh":"坦率地说","usageZh":"用于直接表达意见。"}',
        '2026-08-13T02:00:00Z');
      INSERT INTO schedule_states(learning_item_id,owner_user_id,level,due_at)
      VALUES('${itemId}','${ownerUserId}',0,'2026-08-13T02:30:00Z');
      INSERT INTO source_examples(id,owner_user_id,learning_item_id,source_text,source_type)
      VALUES('80000000-0000-0000-0000-00000000000a','${ownerUserId}','${itemId}',
        'To be frank.','manual');
      INSERT INTO practice_sessions(id,owner_user_id,type,status,prompt,updated_at)
      VALUES('90000000-0000-0000-0000-00000000000a','${ownerUserId}',
        'sentence-creation','completed','Write.','2026-08-13T02:45:00Z');
      INSERT INTO practice_session_items(
        session_id,learning_item_id,owner_user_id,position,rating,schedule_before,schedule_after
      ) VALUES('90000000-0000-0000-0000-00000000000a','${itemId}','${ownerUserId}',0,
        'mastered','{"level":-1,"dueAt":null,"consecutiveMastered":0}',
        '{"level":0,"dueAt":"2026-08-14T00:00:00Z","consecutiveMastered":1,"lastRating":"mastered"}');`);
  });

  afterEach(async () => database.close());

  it("archives and restores a practiced item with strict replay and maintenance boundaries", async () => {
    const maintenance = createPostgresLearningLibraryMaintenance(adapter);
    const archiveCommand = {
      expectedRevision: 1,
      id: itemId,
      idempotencyKey: "archive-practiced",
      now: "2026-08-13T04:00:00.000Z",
      ownerUserId,
      requestHash: "1".repeat(64),
    };
    const archived = await maintenance.archive(archiveCommand);
    expect(archived).toMatchObject({
      archivedAt: "2026-08-13T04:00:00.000Z",
      item: { revision: 2 },
      schedule: { dueAt: "2026-08-13T02:30:00.000Z", level: 0 },
    });
    await expect(maintenance.archive(archiveCommand)).resolves.toEqual(archived);
    await expect(
      maintenance.archive({ ...archiveCommand, requestHash: "9".repeat(64) }),
    ).rejects.toMatchObject({ code: "idempotency_conflict" });
    await expect(
      maintenance.archive({
        ...archiveCommand,
        expectedRevision: 2,
        idempotencyKey: "archive-again",
        requestHash: "8".repeat(64),
      }),
    ).rejects.toMatchObject({ code: "invalid_request" });
    await expect(
      createPostgresLearningLibrary(adapter).list(ownerUserId, {
        archived: false,
        dueAt: "2026-08-13T05:00:00.000Z",
        limit: 20,
      }),
    ).resolves.toMatchObject({ items: [] });
    await expect(
      createPostgresLearningLibrary(adapter).list(ownerUserId, {
        archived: true,
        dueAt: "2026-08-13T05:00:00.000Z",
        limit: 20,
      }),
    ).resolves.toMatchObject({ items: [{ archivedAt: "2026-08-13T04:00:00.000Z" }] });
    const counts = await database.query<{ links: number; schedules: number; sources: number }>(
      `SELECT
        (SELECT count(*)::int FROM practice_session_items WHERE learning_item_id=$1) links,
        (SELECT count(*)::int FROM schedule_states WHERE learning_item_id=$1) schedules,
        (SELECT count(*)::int FROM source_examples WHERE learning_item_id=$1) sources`,
      [itemId],
    );
    expect(counts.rows[0]).toEqual({ links: 1, schedules: 1, sources: 1 });
    await expect(
      maintenance.patch({
        canonicalKey: "to be frank",
        expectedRevision: 2,
        id: itemId,
        idempotencyKey: "patch-archived",
        now: "2026-08-13T04:30:00.000Z",
        ownerUserId,
        request: {
          content: archived.item.content,
          expectedRevision: 2,
          systemAttributes: archived.item.systemAttributes,
          tags: archived.item.tags,
        },
        requestHash: "2".repeat(64),
        tags: [],
      }),
    ).rejects.toMatchObject({ code: "learning_item_archived" });
    const activeCandidate = "60000000-0000-0000-0000-00000000000c";
    await database.exec(`INSERT INTO learning_items(id,owner_user_id,type,canonical_key,content)
      VALUES('${activeCandidate}','${ownerUserId}','expression','frankly',
      '{"type":"expression","text":"frankly","meaningZh":"坦率地说","usageZh":"测试。"}');
      INSERT INTO schedule_states(learning_item_id,owner_user_id,level)
      VALUES('${activeCandidate}','${ownerUserId}',-1);`);
    await expect(maintenance.suggestionContext(ownerUserId, itemId, 2)).rejects.toMatchObject({
      code: "learning_item_archived",
    });
    await expect(
      maintenance.previewMerge(ownerUserId, itemId, {
        sourceRevision: 2,
        targetItemId: activeCandidate,
        targetRevision: 1,
      }),
    ).rejects.toMatchObject({ code: "learning_item_archived" });
    await expect(
      maintenance.merge({
        id: activeCandidate,
        idempotencyKey: "merge-archived-target",
        now: "2026-08-13T04:40:00.000Z",
        ownerUserId,
        requestHash: "7".repeat(64),
        sourceRevision: 1,
        targetItemId: itemId,
        targetRevision: 2,
      }),
    ).rejects.toMatchObject({ code: "learning_item_archived" });
    const restoreCommand = {
      expectedRevision: 2,
      id: itemId,
      idempotencyKey: "restore-practiced",
      now: "2026-08-13T05:00:00.000Z",
      ownerUserId,
      requestHash: "3".repeat(64),
    };
    const restored = await maintenance.restore(restoreCommand);
    expect(restored).toMatchObject({ archivedAt: null, item: { revision: 3 } });
    await expect(maintenance.restore(restoreCommand)).resolves.toEqual(restored);
    await expect(
      maintenance.restore({
        ...restoreCommand,
        expectedRevision: 3,
        idempotencyKey: "restore-again",
        requestHash: "6".repeat(64),
      }),
    ).rejects.toMatchObject({ code: "invalid_request" });
  });
});
