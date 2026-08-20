import { readFile } from "node:fs/promises";

import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AnalysisDatabase, AnalysisQuery } from "./analysis-database.js";
import type { CloudFault } from "./cloud-fault.js";
import { createPostgresLearningLibrary } from "./postgres-learning-library.js";
import { createPostgresLearningLibraryMaintenance } from "./postgres-learning-library-maintenance.js";

const migrationUrl = new URL("../migrations/0001-cloud-v1-foundation.sql", import.meta.url);
const userA = "00000000-0000-0000-0000-00000000000a";
const userB = "00000000-0000-0000-0000-00000000000b";
const itemA = "60000000-0000-0000-0000-00000000000a";
const itemB = "60000000-0000-0000-0000-00000000000b";

function query(executor: {
  query<Row>(text: string, parameters?: unknown[]): Promise<{ rows: Row[] }>;
}): AnalysisQuery {
  return {
    rows: async <Row>(text: string, parameters = []) =>
      (await executor.query<Row>(text, [...parameters])).rows,
  };
}

describe("Postgres learning library", () => {
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
      INSERT INTO learning_items(id,owner_user_id,type,canonical_key,content,system_attributes,created_at)
      VALUES('${itemA}','${userA}','expression','to be frank',
        '{"type":"expression","text":"to be frank","meaningZh":"坦率地说","usageZh":"用于直接表达意见。"}',
        '["spoken"]','2026-08-13T02:00:00Z'),
        ('${itemB}','${userB}','expression','private',
        '{"type":"expression","text":"private","meaningZh":"私有","usageZh":"私有。"}',
        '[]','2026-08-13T01:00:00Z');
      INSERT INTO schedule_states(learning_item_id,owner_user_id,level,due_at)
      VALUES('${itemA}','${userA}',0,'2026-08-13T02:30:00Z'),('${itemB}','${userB}',-1,NULL);
      INSERT INTO tags(id,owner_user_id,normalized_name,display_name)
      VALUES('70000000-0000-0000-0000-00000000000a','${userA}','writing','Writing');
      INSERT INTO learning_item_tags(learning_item_id,tag_id,owner_user_id)
      VALUES('${itemA}','70000000-0000-0000-0000-00000000000a','${userA}');
      INSERT INTO source_examples(id,owner_user_id,learning_item_id,source_text,source_type)
      VALUES('80000000-0000-0000-0000-00000000000a','${userA}','${itemA}','To be frank.','manual');
      INSERT INTO practice_sessions(id,owner_user_id,type,status,prompt,updated_at)
      VALUES('90000000-0000-0000-0000-00000000000a','${userA}','sentence-creation','completed','Write.','2026-08-13T02:45:00Z');
      INSERT INTO practice_session_items(session_id,learning_item_id,owner_user_id,position,rating,schedule_before,schedule_after)
      VALUES('90000000-0000-0000-0000-00000000000a','${itemA}','${userA}',0,'mastered','{"level":-1,"dueAt":null,"consecutiveMastered":0}','{"level":0,"dueAt":"2026-08-14T00:00:00Z","consecutiveMastered":1,"lastRating":"mastered"}');`);
  });
  afterEach(async () => database.close());

  it("filters inside tenant SQL and returns minimal schedule/practice summary", async () => {
    const repository = createPostgresLearningLibrary(adapter);
    const page = await repository.list(userA, {
      archived: false,
      due: "due",
      dueAt: "2026-08-13T03:00:00.000Z",
      limit: 20,
      query: "frank",
      systemAttribute: "spoken",
      tag: "writing",
      type: "expression",
    });
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({
      item: { id: itemA, sourceExamples: [{ sourceText: "To be frank." }], tags: ["Writing"] },
      recentPractice: { rating: "mastered", type: "sentence-creation" },
      schedule: { level: 0 },
    });
    await expect(
      repository.list(userA, {
        archived: false,
        dueAt: "2026-08-13T03:00:00.000Z",
        limit: 20,
        query: "%_",
      }),
    ).resolves.toMatchObject({ items: [] });
    await expect(repository.findById(userB, itemA)).resolves.toBeNull();
  });

  it("atomically creates, replays, and rejects duplicate or conflicting manual items", async () => {
    const ids = [
      "60000000-0000-0000-0000-00000000000c",
      "70000000-0000-0000-0000-00000000000c",
      "60000000-0000-0000-0000-00000000000d",
      "70000000-0000-0000-0000-00000000000d",
    ];
    const repository = createPostgresLearningLibrary(adapter, {
      id: () => ids.shift() ?? "70000000-0000-0000-0000-00000000000e",
    });
    const base = {
      canonicalKey: "as a result",
      id: "60000000-0000-0000-0000-00000000000c",
      idempotencyKey: "manual-1",
      now: "2026-08-13T03:00:00.000Z",
      ownerUserId: userA,
      request: {
        content: {
          meaningZh: "因此",
          text: "as a result",
          type: "expression" as const,
          usageZh: "用于说明结果。",
        },
        systemAttributes: ["connector"],
        tags: [" Writing "],
      },
      requestHash: "a".repeat(64),
      tags: [{ displayName: " Writing ", normalizedName: "writing" }],
    };
    const created = await repository.create(base);
    expect(created).toMatchObject({
      item: { id: base.id, tags: ["Writing"] },
      recentPractice: null,
      schedule: { dueAt: null, level: -1 },
    });
    await expect(repository.create(base)).resolves.toEqual(created);
    await expect(repository.create({ ...base, requestHash: "b".repeat(64) })).rejects.toMatchObject(
      { code: "idempotency_conflict" },
    );
    await expect(
      repository.create({
        ...base,
        id: "60000000-0000-0000-0000-00000000000d",
        idempotencyKey: "manual-2",
        requestHash: "c".repeat(64),
      }),
    ).rejects.toEqual(expect.objectContaining<Partial<CloudFault>>({ code: "exact_duplicate" }));

    const counts = await database.query<{
      items: number;
      joins: number;
      schedules: number;
      tags: number;
    }>(
      `SELECT
      (SELECT count(*)::int FROM learning_items WHERE owner_user_id=$1 AND canonical_key='as a result') items,
      (SELECT count(*)::int FROM schedule_states WHERE owner_user_id=$1 AND level=-1) schedules,
      (SELECT count(*)::int FROM tags WHERE owner_user_id=$1 AND normalized_name='writing') tags,
      (SELECT count(*)::int FROM learning_item_tags WHERE owner_user_id=$1 AND learning_item_id=$2) joins`,
      [userA, base.id],
    );
    expect(counts.rows[0]).toEqual({ items: 1, joins: 1, schedules: 1, tags: 1 });
  });

  it("requires archive for practiced deletion and snapshots an unpracticed hard-delete replay", async () => {
    const maintenance = createPostgresLearningLibraryMaintenance(adapter);
    await expect(
      maintenance.delete({
        expectedRevision: 1,
        id: itemA,
        idempotencyKey: "delete-practiced",
        now: "2026-08-13T04:00:00.000Z",
        ownerUserId: userA,
        requestHash: "d".repeat(64),
      }),
    ).rejects.toMatchObject({ code: "learning_item_must_be_archived" });
    const removable = "60000000-0000-0000-0000-00000000000d";
    await database.exec(`INSERT INTO learning_items(id,owner_user_id,type,canonical_key,content)
      VALUES('${removable}','${userA}','expression','removable',
      '{"type":"expression","text":"removable","meaningZh":"可删除","usageZh":"测试。"}');
      INSERT INTO schedule_states(learning_item_id,owner_user_id,level)
      VALUES('${removable}','${userA}',-1);
      INSERT INTO source_examples(id,owner_user_id,learning_item_id,source_text,source_type)
      VALUES('80000000-0000-0000-0000-00000000000d','${userA}','${removable}','Example.','manual');`);
    await expect(
      maintenance.previewMerge(userA, itemA, {
        sourceRevision: 1,
        targetItemId: removable,
        targetRevision: 1,
      }),
    ).resolves.toMatchObject({
      allowed: false,
      blockedReason: "source_has_practice_history",
    });
    const command = {
      expectedRevision: 1,
      id: removable,
      idempotencyKey: "delete-new",
      now: "2026-08-13T04:00:00.000Z",
      ownerUserId: userA,
      requestHash: "e".repeat(64),
    };
    const deleted = await maintenance.delete(command);
    expect(deleted).toEqual({ deleted: true, deletionKind: "hard-delete", id: removable });
    await expect(maintenance.delete(command)).resolves.toEqual(deleted);
    await expect(
      maintenance.delete({ ...command, requestHash: "f".repeat(64) }),
    ).rejects.toMatchObject({ code: "idempotency_conflict" });
    const counts = await database.query<{ items: number; schedules: number; sources: number }>(
      `SELECT
        (SELECT count(*)::int FROM learning_items WHERE id=$1) items,
        (SELECT count(*)::int FROM schedule_states WHERE learning_item_id=$1) schedules,
        (SELECT count(*)::int FROM source_examples WHERE learning_item_id=$1) sources`,
      [removable],
    );
    expect(counts.rows[0]).toEqual({ items: 0, schedules: 0, sources: 0 });
  });

  it("erases an archived rated item while preserving its completed practice history", async () => {
    await database.query("UPDATE learning_items SET archived_at=$2::timestamptz WHERE id=$1", [
      itemA,
      "2026-08-13T03:30:00.000Z",
    ]);
    const maintenance = createPostgresLearningLibraryMaintenance(adapter);
    const erased = await maintenance.delete({
      expectedRevision: 1,
      id: itemA,
      idempotencyKey: "erase-practiced",
      now: "2026-08-13T04:00:00.000Z",
      ownerUserId: userA,
      requestHash: "1".repeat(64),
    });
    expect(erased).toEqual({ deleted: true, deletionKind: "erased", id: itemA });

    const state = await database.query<{
      archived_at: Date | null;
      canonical_key: string | null;
      content: unknown;
      deleted_at: Date | null;
      links: number;
      schedules: number;
      sources: number;
      tag_links: number;
      type: string | null;
    }>(
      `SELECT items.type,items.canonical_key,items.content,items.archived_at,items.deleted_at,
        (SELECT count(*)::int FROM schedule_states WHERE learning_item_id=items.id) schedules,
        (SELECT count(*)::int FROM source_examples WHERE learning_item_id=items.id) sources,
        (SELECT count(*)::int FROM learning_item_tags WHERE learning_item_id=items.id) tag_links,
        (SELECT count(*)::int FROM practice_session_items WHERE learning_item_id=items.id) links
        FROM learning_items items WHERE items.id=$1`,
      [itemA],
    );
    expect(state.rows[0]).toMatchObject({
      archived_at: null,
      canonical_key: null,
      content: null,
      links: 1,
      schedules: 0,
      sources: 0,
      tag_links: 0,
      type: null,
    });
    expect(state.rows[0]?.deleted_at?.toISOString()).toBe("2026-08-13T04:00:00.000Z");
    await expect(createPostgresLearningLibrary(adapter).findById(userA, itemA)).resolves.toBeNull();
    const rebuilt = "60000000-0000-0000-0000-00000000000e";
    await database.exec(`INSERT INTO learning_items(id,owner_user_id,type,canonical_key,content)
      VALUES('${rebuilt}','${userA}','expression','to be frank',
      '{"type":"expression","text":"to be frank","meaningZh":"坦率地说","usageZh":"重新开始。"}');
      INSERT INTO schedule_states(learning_item_id,owner_user_id,level)
      VALUES('${rebuilt}','${userA}',-1);`);
    await expect(
      createPostgresLearningLibrary(adapter).findById(userA, rebuilt),
    ).resolves.toMatchObject({
      item: { id: rebuilt },
      recentPractice: null,
      schedule: { level: -1 },
    });
  });

  it("does not erase an archived item while an unfinished session still references it", async () => {
    const unfinished = "90000000-0000-0000-0000-00000000000c";
    await database.exec(`UPDATE learning_items SET archived_at='2026-08-13T03:30:00Z'
      WHERE id='${itemA}';
      INSERT INTO practice_sessions(id,owner_user_id,type,status,prompt)
      VALUES('${unfinished}','${userA}','sentence-creation','active','Write.');
      INSERT INTO practice_session_items(
        session_id,learning_item_id,owner_user_id,position,schedule_before
      ) VALUES('${unfinished}','${itemA}','${userA}',0,
      '{"level":0,"dueAt":"2026-08-13T02:30:00.000Z","consecutiveMastered":0}');`);
    await expect(
      createPostgresLearningLibraryMaintenance(adapter).delete({
        expectedRevision: 1,
        id: itemA,
        idempotencyKey: "erase-unfinished",
        now: "2026-08-13T04:00:00.000Z",
        ownerUserId: userA,
        requestHash: "2".repeat(64),
      }),
    ).rejects.toMatchObject({ code: "learning_item_in_use" });
    await expect(
      createPostgresLearningLibrary(adapter).findById(userA, itemA),
    ).resolves.toMatchObject({ item: { canonicalKey: "to be frank" } });
  });

  it("patches canonical metadata and safely merges a new unpracticed source", async () => {
    const sourceId = "60000000-0000-0000-0000-00000000000c";
    await database.exec(`INSERT INTO learning_items(
      id,owner_user_id,type,canonical_key,content,system_attributes)
      VALUES('${sourceId}','${userA}','expression','frankly speaking',
      '{"type":"expression","text":"frankly speaking","meaningZh":"坦率地说","usageZh":"测试。"}',
      '["formal"]');
      INSERT INTO schedule_states(learning_item_id,owner_user_id,level)
      VALUES('${sourceId}','${userA}',-1);
      INSERT INTO source_examples(id,owner_user_id,learning_item_id,source_text,source_type)
      VALUES('80000000-0000-0000-0000-00000000000c','${userA}','${sourceId}','Frankly speaking.','manual');`);
    const maintenance = createPostgresLearningLibraryMaintenance(adapter, {
      id: () => "70000000-0000-0000-0000-00000000000c",
    });
    const patchCommand = {
      canonicalKey: "frankly",
      expectedRevision: 1,
      id: sourceId,
      idempotencyKey: "patch-new",
      now: "2026-08-13T04:00:00.000Z",
      ownerUserId: userA,
      request: {
        content: {
          meaningZh: "坦率地说",
          text: "Frankly",
          type: "expression" as const,
          usageZh: "用于直接表达意见。",
        },
        expectedRevision: 1,
        systemAttributes: ["informal"],
        tags: ["Speaking"],
      },
      requestHash: "1".repeat(64),
      tags: [{ displayName: "Speaking", normalizedName: "speaking" }],
    };
    const patched = await maintenance.patch(patchCommand);
    expect(patched).toMatchObject({
      item: { canonicalKey: "frankly", revision: 2, systemAttributes: ["informal"] },
    });
    await expect(
      maintenance.patch({
        ...patchCommand,
        canonicalKey: "to be frank",
        expectedRevision: 2,
        idempotencyKey: "patch-duplicate",
        request: {
          ...patchCommand.request,
          content: { ...patchCommand.request.content, text: "to be frank" },
          expectedRevision: 2,
        },
        requestHash: "2".repeat(64),
      }),
    ).rejects.toMatchObject({ code: "exact_duplicate" });
    const preview = await maintenance.previewMerge(userA, sourceId, {
      sourceRevision: 2,
      targetItemId: itemA,
      targetRevision: 1,
    });
    expect(preview).toMatchObject({ allowed: true, scheduleDecision: "keep-target" });
    const mergeCommand = {
      id: sourceId,
      idempotencyKey: "merge-new",
      now: "2026-08-13T04:10:00.000Z",
      ownerUserId: userA,
      requestHash: "3".repeat(64),
      sourceRevision: 2,
      targetItemId: itemA,
      targetRevision: 1,
    };
    const merged = await maintenance.merge(mergeCommand);
    expect(merged).toMatchObject({
      deletedSourceId: sourceId,
      target: {
        item: {
          id: itemA,
          revision: 2,
          systemAttributes: ["informal", "spoken"],
          tags: ["Speaking", "Writing"],
        },
        schedule: { level: 0 },
      },
    });
    expect(merged.target.item.sourceExamples).toEqual(
      expect.arrayContaining([expect.objectContaining({ sourceText: "Frankly speaking." })]),
    );
    await expect(maintenance.merge(mergeCommand)).resolves.toEqual(merged);
  });
});
