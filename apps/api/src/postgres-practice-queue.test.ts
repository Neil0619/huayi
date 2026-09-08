import { readFile } from "node:fs/promises";

import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AnalysisDatabase, AnalysisQuery } from "./analysis-database.js";
import { createPostgresPracticeRepository } from "./postgres-practice-repository.js";

const migrationUrl = new URL("../migrations/0001-cloud-v1-foundation.sql", import.meta.url);
const userA = "00000000-0000-0000-0000-00000000000a";
const userB = "00000000-0000-0000-0000-00000000000b";
const dueItem = "60000000-0000-0000-0000-00000000000a";
const newItem = "60000000-0000-0000-0000-00000000000b";
const tomorrowItem = "60000000-0000-0000-0000-00000000000c";

function query(executor: {
  query<Row>(text: string, parameters?: unknown[]): Promise<{ rows: Row[] }>;
}): AnalysisQuery {
  return {
    rows: async <Row>(text: string, parameters = []) =>
      (await executor.query<Row>(text, [...parameters])).rows,
  };
}

describe("Postgres practice queue", () => {
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
      VALUES('${userA}','${userA}','a@example.test','active','Asia/Shanghai',2),
        ('${userB}','${userB}','b@example.test','disabled','UTC',5);
      INSERT INTO learning_items(id,owner_user_id,type,canonical_key,content,created_at)
      VALUES('${dueItem}','${userA}','expression','to be frank',
        '{"type":"expression","text":"to be frank","meaningZh":"坦率地说","usageZh":"表达意见。"}',
        '2026-08-01T00:00:00Z'),
        ('${newItem}','${userA}','expression','as a result',
        '{"type":"expression","text":"as a result","meaningZh":"因此","usageZh":"说明结果。"}',
        '2026-08-02T00:00:00Z'),
        ('${tomorrowItem}','${userA}','expression','not due',
        '{"type":"expression","text":"not due","meaningZh":"未到期","usageZh":"测试。"}',
        '2026-08-03T00:00:00Z');
      INSERT INTO schedule_states(learning_item_id,owner_user_id,level,due_at)
      VALUES('${dueItem}','${userA}',0,'2026-08-13T15:00:00Z'),
        ('${newItem}','${userA}',-1,NULL),
        ('${tomorrowItem}','${userA}',0,'2026-08-13T16:01:00Z');`);
  });
  afterEach(async () => database.close());

  it.each(["Asia/Shanghai", "UTC", "America/Los_Angeles", "Asia/Tokyo"])(
    "uses Beijing midnight and due-first order with a legacy %s profile",
    async (timezone) => {
      await database.query("UPDATE user_profiles SET timezone=$2 WHERE user_id=$1", [
        userA,
        timezone,
      ]);
      const repository = createPostgresPracticeRepository(adapter);
      await expect(repository.dailyQueue(userA, "2026-08-13T15:59:59.000Z")).resolves.toMatchObject(
        {
          currentItems: [],
          currentSession: null,
          date: "2026-08-13",
          dailyGoal: 2,
          items: [{ item: { id: dueItem } }, { item: { id: newItem } }],
          timezone: "Asia/Shanghai",
        },
      );
      await expect(repository.dailyQueue(userA, "2026-08-13T16:00:00.000Z")).resolves.toMatchObject(
        {
          date: "2026-08-14",
          items: [{ item: { id: dueItem } }, { item: { id: tomorrowItem } }],
        },
      );
      await expect(repository.dailyQueue(userB, "2026-08-13T15:59:59.000Z")).rejects.toMatchObject({
        code: "forbidden",
      });
    },
  );

  it("counts self-ratings on the Beijing day even when an old profile stores UTC", async () => {
    for (const file of ["0024-durable-learning-tasks.sql", "0025-practice-workspace.sql"]) {
      await database.exec(
        await readFile(new URL(`../migrations/${file}`, import.meta.url), "utf8"),
      );
    }
    await database.query("UPDATE user_profiles SET timezone='UTC' WHERE user_id=$1", [userA]);
    const completed = [
      { item: dueItem, id: "90000000-0000-0000-0000-000000000001", at: "2026-08-13T15:59:59Z" },
      { item: newItem, id: "90000000-0000-0000-0000-000000000002", at: "2026-08-13T16:00:00Z" },
      {
        item: tomorrowItem,
        id: "90000000-0000-0000-0000-000000000003",
        at: "2026-08-13T16:00:01Z",
      },
    ];
    for (const entry of completed) {
      await database.query(
        "INSERT INTO practice_sessions(id,owner_user_id,type,status,completed_at) VALUES($1,$2,'sentence-creation','completed',$3)",
        [entry.id, userA, entry.at],
      );
      await database.query(
        "INSERT INTO practice_session_items(session_id,learning_item_id,owner_user_id,position,rating,schedule_before,rated_at) VALUES($1,$2,$3,0,'mastered','{}',$4)",
        [entry.id, entry.item, userA, entry.at],
      );
    }
    const repository = createPostgresPracticeRepository(adapter);
    await expect(repository.dailyQueue(userA, "2026-08-13T15:59:59Z")).resolves.toMatchObject({
      completedToday: 1,
      date: "2026-08-13",
      timezone: "Asia/Shanghai",
    });
    await expect(repository.dailyQueue(userA, "2026-08-13T16:00:01Z")).resolves.toMatchObject({
      completedToday: 2,
      date: "2026-08-14",
      timezone: "Asia/Shanghai",
    });
  });
});
