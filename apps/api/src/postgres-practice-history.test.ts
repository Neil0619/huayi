import { readFile } from "node:fs/promises";

import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AnalysisDatabase, AnalysisQuery } from "./analysis-database.js";
import { createPostgresPracticeHistory } from "./postgres-practice-history.js";

const migrationUrl = new URL("../migrations/0001-cloud-v1-foundation.sql", import.meta.url);
const userA = "00000000-0000-0000-0000-00000000000a";
const userB = "00000000-0000-0000-0000-00000000000b";
const itemA = "60000000-0000-0000-0000-00000000000a";
const sessionA = "90000000-0000-0000-0000-00000000000a";
const activeA = "90000000-0000-0000-0000-00000000000b";

function query(executor: {
  query<Row>(text: string, parameters?: unknown[]): Promise<{ rows: Row[] }>;
}): AnalysisQuery {
  return {
    rows: async <Row>(text: string, parameters = []) =>
      (await executor.query<Row>(text, [...parameters])).rows,
  };
}

describe("Postgres practice history", () => {
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
      INSERT INTO learning_items(id,owner_user_id,type,canonical_key,content)
      VALUES('${itemA}','${userA}','expression','to be frank',
      '{"type":"expression","text":"to be frank","meaningZh":"坦率地说","usageZh":"表达意见。"}');
      INSERT INTO schedule_states(learning_item_id,owner_user_id,level,due_at,last_rating)
      VALUES('${itemA}','${userA}',1,'2026-08-20T00:00:00Z','mastered');
      INSERT INTO source_examples(id,owner_user_id,learning_item_id,source_text,source_type)
      VALUES('80000000-0000-0000-0000-00000000000a','${userA}','${itemA}','Example.','manual');
      INSERT INTO practice_sessions(
        id,owner_user_id,type,status,prompt,final_feedback,completed_at,revision,created_at,updated_at
      ) VALUES('${sessionA}','${userA}','sentence-creation','completed','Write.','Good.',
        '2026-08-13T05:05:00Z',3,'2026-08-13T05:00:00Z','2026-08-13T05:06:00Z'),
        ('${activeA}','${userA}','sentence-creation','active','Write.',NULL,NULL,1,
        '2026-08-13T06:00:00Z','2026-08-13T06:00:00Z');
      INSERT INTO practice_session_items(
        session_id,learning_item_id,owner_user_id,position,rating,schedule_before,schedule_after
      ) VALUES('${sessionA}','${itemA}','${userA}',0,'mastered',
        '{"level":0,"dueAt":"2026-08-14T00:00:00Z","consecutiveMastered":0}',
        '{"level":1,"dueAt":"2026-08-20T00:00:00Z","consecutiveMastered":1,"lastRating":"mastered"}'),
        ('${activeA}','${itemA}','${userA}',0,NULL,
        '{"level":1,"dueAt":"2026-08-20T00:00:00Z","consecutiveMastered":1,"lastRating":"mastered"}',NULL);
      INSERT INTO practice_attempts(id,session_id,owner_user_id,answer,feedback,submitted_at)
      VALUES('91000000-0000-0000-0000-00000000000a','${sessionA}','${userA}',
        'To be frank, I disagree.','Good.','2026-08-13T05:04:00Z');`);
  });
  afterEach(async () => database.close());

  it("lists incomplete before completed and returns strict owner detail", async () => {
    const history = createPostgresPracticeHistory(adapter);
    const page = await history.list(userA, { limit: 20 });
    expect(page.items.map(({ id }) => id)).toEqual([activeA, sessionA]);
    await expect(history.findById(userA, sessionA)).resolves.toMatchObject({
      completedAt: "2026-08-13T05:05:00.000Z",
      session: { attempts: [{ answer: "To be frank, I disagree." }], status: "completed" },
    });
    await expect(history.findById(userB, sessionA)).resolves.toBeNull();
  });

  it("refuses active deletion and replays completed deletion without changing learning data", async () => {
    const history = createPostgresPracticeHistory(adapter);
    await expect(
      history.delete({
        expectedRevision: 1,
        idempotencyKey: "delete-active",
        now: "2026-08-13T07:00:00.000Z",
        ownerUserId: userA,
        requestHash: "a".repeat(64),
        sessionId: activeA,
      }),
    ).rejects.toMatchObject({ code: "practice_session_in_use" });
    const unrated = "90000000-0000-0000-0000-00000000000c";
    await database.exec(`INSERT INTO practice_sessions(
      id,owner_user_id,type,status,prompt,final_feedback,completed_at,revision
    ) VALUES('${unrated}','${userA}','sentence-creation','completed','Write.','Good.',
      '2026-08-13T06:30:00Z',2);
      INSERT INTO practice_session_items(
        session_id,learning_item_id,owner_user_id,position,rating,schedule_before,schedule_after
      ) VALUES('${unrated}','${itemA}','${userA}',0,NULL,
      '{"level":1,"dueAt":"2026-08-20T00:00:00Z","consecutiveMastered":1,"lastRating":"mastered"}',NULL);`);
    await expect(
      history.delete({
        expectedRevision: 2,
        idempotencyKey: "delete-unrated",
        now: "2026-08-13T07:00:00.000Z",
        ownerUserId: userA,
        requestHash: "9".repeat(64),
        sessionId: unrated,
      }),
    ).resolves.toEqual({ deleted: true, id: unrated });
    const command = {
      expectedRevision: 3,
      idempotencyKey: "delete-completed",
      now: "2026-08-13T07:00:00.000Z",
      ownerUserId: userA,
      requestHash: "b".repeat(64),
      sessionId: sessionA,
    };
    const deleted = await history.delete(command);
    await expect(history.delete(command)).resolves.toEqual(deleted);
    await expect(history.delete({ ...command, requestHash: "c".repeat(64) })).rejects.toMatchObject(
      {
        code: "idempotency_conflict",
      },
    );
    const rows = await database.query<{
      attempts: number;
      examples: number;
      level: number;
      sessions: number;
    }>(
      `SELECT
        (SELECT count(*)::int FROM practice_sessions WHERE id=$1) sessions,
        (SELECT count(*)::int FROM practice_attempts WHERE session_id=$1) attempts,
        (SELECT count(*)::int FROM source_examples WHERE learning_item_id=$2) examples,
        (SELECT level FROM schedule_states WHERE learning_item_id=$2) level`,
      [sessionA, itemA],
    );
    expect(rows.rows[0]).toEqual({ attempts: 0, examples: 1, level: 1, sessions: 0 });
  });

  it("marks erased items in history and removes an unreferenced tombstone with a failed session", async () => {
    const tombstone = "60000000-0000-0000-0000-00000000000c";
    const failed = "90000000-0000-0000-0000-00000000000c";
    await database.exec(`INSERT INTO learning_items(
      id,owner_user_id,type,canonical_key,content,system_attributes,deleted_at,created_at,updated_at
    ) VALUES('${tombstone}','${userA}',NULL,NULL,NULL,'[]','2026-08-14T05:00:00Z',
      '2026-08-13T05:00:00Z','2026-08-14T05:00:00Z');
    INSERT INTO practice_sessions(id,owner_user_id,type,status,prompt,revision,created_at,updated_at)
    VALUES('${failed}','${userA}','sentence-creation','failed','Write.',2,
      '2026-08-13T05:00:00Z','2026-08-13T05:01:00Z');
    INSERT INTO practice_session_items(
      session_id,learning_item_id,owner_user_id,position,schedule_before
    ) VALUES('${failed}','${tombstone}','${userA}',0,
      '{"level":-1,"dueAt":null,"consecutiveMastered":0}');`);

    const history = createPostgresPracticeHistory(adapter);
    await expect(history.findById(userA, failed)).resolves.toMatchObject({
      session: {
        items: [{ itemId: tombstone, learningItemDeletedAt: "2026-08-14T05:00:00.000Z" }],
      },
    });
    const page = await history.list(userA, { limit: 20 });
    expect(page.items.find(({ id }) => id === failed)).toMatchObject({
      items: [{ itemId: tombstone, learningItemDeletedAt: "2026-08-14T05:00:00.000Z" }],
    });
    await expect(
      history.delete({
        expectedRevision: 2,
        idempotencyKey: "delete-failed",
        now: "2026-08-14T06:00:00.000Z",
        ownerUserId: userA,
        requestHash: "d".repeat(64),
        sessionId: failed,
      }),
    ).resolves.toEqual({ deleted: true, id: failed });
    await expect(
      database.query("SELECT 1 FROM learning_items WHERE id=$1", [tombstone]),
    ).resolves.toMatchObject({ rows: [] });
  });
});
