import { readFile } from "node:fs/promises";

import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AnalysisDatabase, AnalysisQuery } from "./analysis-database.js";
import { createPostgresDialoguePracticeRepository } from "./postgres-dialogue-practice-repository.js";
import { createPostgresPracticeRepository } from "./postgres-practice-repository.js";

const migrationUrl = new URL("../migrations/0001-cloud-v1-foundation.sql", import.meta.url);
const ownerUserId = "00000000-0000-0000-0000-00000000000a";
const activeItemId = "60000000-0000-0000-0000-00000000000a";
const archivedItemId = "60000000-0000-0000-0000-00000000000b";

function query(executor: {
  query<Row>(text: string, parameters?: unknown[]): Promise<{ rows: Row[] }>;
}): AnalysisQuery {
  return {
    rows: async <Row>(text: string, parameters = []) =>
      (await executor.query<Row>(text, [...parameters])).rows,
  };
}

function sentenceCommand(itemId: string) {
  return {
    generationLeaseExpiresAt: "2026-08-14T03:02:00.000Z",
    generationLeaseToken: "sentence-lease",
    generationId: "91000000-0000-0000-0000-000000000001",
    idempotencyKey: `sentence-${itemId}`,
    itemId,
    now: "2026-08-14T03:00:00.000Z",
    ownerUserId,
    requestHash: "a".repeat(64),
    sessionId: "90000000-0000-0000-0000-000000000001",
  };
}

describe("Postgres practice archive boundaries", () => {
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
      ) VALUES('${ownerUserId}','${ownerUserId}','user@example.test','active','UTC',5);
      INSERT INTO learning_items(
        id,owner_user_id,type,canonical_key,content,archived_at,created_at
      ) VALUES(
        '${activeItemId}','${ownerUserId}','expression','to be frank',
        '{"type":"expression","text":"to be frank","meaningZh":"坦率地说","usageZh":"表达意见。"}',
        NULL,'2026-08-01T00:00:00Z'
      ),(
        '${archivedItemId}','${ownerUserId}','expression','as a result',
        '{"type":"expression","text":"as a result","meaningZh":"因此","usageZh":"说明结果。"}',
        '2026-08-14T02:00:00Z','2026-08-02T00:00:00Z'
      );
      INSERT INTO schedule_states(learning_item_id,owner_user_id,level,due_at)
      VALUES('${activeItemId}','${ownerUserId}',-1,NULL),
        ('${archivedItemId}','${ownerUserId}',-1,NULL);`);
  });

  afterEach(async () => database.close());

  it("excludes archived items from the daily queue", async () => {
    const repository = createPostgresPracticeRepository(adapter);

    await expect(
      repository.dailyQueue(ownerUserId, "2026-08-14T03:00:00.000Z"),
    ).resolves.toMatchObject({
      items: [{ item: { id: activeItemId } }],
    });
  });

  it("rejects an archived item when a new sentence session is reserved", async () => {
    const repository = createPostgresPracticeRepository(adapter);

    await expect(repository.beginSentence(sentenceCommand(archivedItemId))).rejects.toMatchObject({
      code: "learning_item_archived",
    });
  });

  it("rejects an archived item when a new dialogue session is reserved", async () => {
    const repository = createPostgresDialoguePracticeRepository(adapter);

    await expect(
      repository.reserveStart({
        generationLeaseExpiresAt: "2026-08-14T03:02:00.000Z",
        generationLeaseToken: "dialogue-lease",
        generationId: "91000000-0000-0000-0000-000000000002",
        idempotencyKey: "dialogue-archived",
        itemIds: [activeItemId, archivedItemId],
        now: "2026-08-14T03:00:00.000Z",
        ownerUserId,
        requestHash: "b".repeat(64),
        sessionId: "90000000-0000-0000-0000-000000000002",
      }),
    ).rejects.toMatchObject({ code: "learning_item_archived" });
  });

  it("keeps archived items readable in an already-started session", async () => {
    const repository = createPostgresPracticeRepository(adapter);
    await repository.beginSentence(sentenceCommand(activeItemId));
    await database.query("UPDATE learning_items SET archived_at=now() WHERE id=$1", [activeItemId]);

    await expect(
      repository.dailyQueue(ownerUserId, "2026-08-14T03:01:00.000Z"),
    ).resolves.toMatchObject({
      currentItems: [{ item: { id: activeItemId } }],
      currentSession: { id: "90000000-0000-0000-0000-000000000001" },
      items: [],
    });
  });
});
