import { readFile } from "node:fs/promises";

import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AnalysisDatabase, AnalysisQuery } from "./analysis-database.js";
import { createPostgresAnalysisQuota } from "./postgres-analysis-quota.js";
import { createPostgresDialoguePracticeRepository } from "./postgres-dialogue-practice-repository.js";
import { createPostgresPracticeGenerationRepository } from "./postgres-practice-generation.js";
import { createPostgresPracticeRepository } from "./postgres-practice-repository.js";

const migrationUrl = new URL("../migrations/0001-cloud-v1-foundation.sql", import.meta.url);
const userId = "00000000-0000-0000-0000-00000000000a";
const itemOne = "60000000-0000-0000-0000-00000000000a";
const itemTwo = "60000000-0000-0000-0000-00000000000b";
const sessionId = "90000000-0000-0000-0000-00000000000a";

function query(executor: {
  query<Row>(text: string, parameters?: unknown[]): Promise<{ rows: Row[] }>;
}): AnalysisQuery {
  return {
    rows: async <Row>(text: string, parameters = []) =>
      (await executor.query<Row>(text, [...parameters])).rows,
  };
}

describe("Postgres constrained dialogue practice", () => {
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
      VALUES('${userId}','${userId}','user@example.test','active','UTC',5);
      INSERT INTO learning_items(id,owner_user_id,type,canonical_key,content)
      VALUES('${itemOne}','${userId}','expression','to be frank',
        '{"type":"expression","text":"to be frank","meaningZh":"坦率地说","usageZh":"表达意见。"}'),
        ('${itemTwo}','${userId}','expression','as a result',
        '{"type":"expression","text":"as a result","meaningZh":"因此","usageZh":"说明结果。"}');
      INSERT INTO schedule_states(learning_item_id,owner_user_id,level,due_at)
      VALUES('${itemOne}','${userId}',-1,NULL),('${itemTwo}','${userId}',-1,NULL);`);
  });
  afterEach(async () => database.close());

  it("persists turns before generation and fences assistant and final feedback leases", async () => {
    const repository = createPostgresDialoguePracticeRepository(adapter);
    const startGenerationId = "91000000-0000-0000-0000-000000000001";
    const assistantGenerationId = "91000000-0000-0000-0000-000000000002";
    const finishGenerationId = "91000000-0000-0000-0000-000000000003";
    const priceVersionId = "93000000-0000-0000-0000-000000000001";
    await database.exec(`INSERT INTO model_price_versions(
      id,provider,model,input_micro_usd_per_million,cached_input_micro_usd_per_million,
      output_micro_usd_per_million,effective_from
    ) VALUES('${priceVersionId}','deepseek','practice-fixed',100,100,100,now());
    INSERT INTO quota_grants(
      id,user_id,owner_user_id,period_start,period_end,limit_micro_usd,source
    ) VALUES('93000000-0000-0000-0000-000000000002','${userId}','${userId}',
      date_trunc('month',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC',
      (date_trunc('month',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')+interval '1 month',
      10000,'default');`);
    let generatedId = 10;
    const nextId = () => {
      generatedId += 1;
      return `94000000-0000-0000-0000-${String(generatedId).padStart(12, "0")}`;
    };
    let generationNow = new Date("2026-08-13T03:00:00.000Z");
    const generation = createPostgresPracticeGenerationRepository({
      database: adapter,
      ledgerId: nextId,
      now: () => generationNow,
      priceVersionId,
      quota: createPostgresAnalysisQuota({
        database: adapter,
        expiresAt: () => new Date(generationNow.getTime() + 120_000),
        id: nextId,
        now: () => generationNow,
        priceVersionId,
      }),
      reservedMicroUsd: 100,
    });
    const makeReady = async (
      command: Parameters<typeof generation.acquire>[0],
      output: Parameters<typeof generation.complete>[0]["output"],
      now: string,
    ) => {
      generationNow = new Date(now);
      const acquired = await generation.acquire(command);
      if (acquired.kind !== "acquired") throw new Error("Practice reservation missing.");
      await expect(
        generation.markDispatched({ ...command, reservationId: acquired.reservationId }),
      ).resolves.toBe(true);
      await generation.complete({
        ...command,
        billedCalls: [
          {
            costMicroUsd: 10,
            usage: { cachedInputTokens: 0, inputTokens: 10, outputTokens: 5 },
          },
        ],
        output,
        reservationId: acquired.reservationId,
      });
    };
    const reserved = await repository.reserveStart({
      generationLeaseExpiresAt: "2026-08-13T03:02:00.000Z",
      generationLeaseToken: "start-lease",
      generationId: startGenerationId,
      idempotencyKey: "dialogue-start",
      itemIds: [itemOne, itemTwo],
      now: "2026-08-13T03:00:00.000Z",
      ownerUserId: userId,
      requestHash: "a".repeat(64),
      sessionId,
    });
    expect(reserved).toMatchObject({
      claimed: true,
      generationId: startGenerationId,
      leaseToken: "start-lease",
      session: { id: sessionId, pendingGeneration: "dialogue-start" },
    });
    const practice = createPostgresPracticeRepository(adapter);
    await expect(practice.dailyQueue(userId, "2026-08-13T03:00:30.000Z")).resolves.toMatchObject({
      currentItems: [{ item: { id: itemOne } }, { item: { id: itemTwo } }],
      currentSession: { pendingGeneration: "dialogue-start", status: "awaiting-feedback" },
    });
    await expect(
      repository.reserveStart({
        generationLeaseExpiresAt: "2026-08-13T03:03:00.000Z",
        generationLeaseToken: "second-start-lease",
        generationId: "91000000-0000-0000-0000-000000000004",
        idempotencyKey: "dialogue-start-second",
        itemIds: [itemOne, itemTwo],
        now: "2026-08-13T03:01:00.000Z",
        ownerUserId: userId,
        requestHash: "f".repeat(64),
        sessionId: "90000000-0000-0000-0000-00000000000b",
      }),
    ).resolves.toMatchObject({ claimed: false, session: { id: sessionId } });
    await expect(
      repository.reserveStart({
        generationLeaseExpiresAt: "2026-08-13T03:05:00.000Z",
        generationLeaseToken: "recovered-start-lease",
        generationId: "91000000-0000-0000-0000-000000000005",
        idempotencyKey: "dialogue-start-recovered",
        itemIds: [itemOne, itemTwo],
        now: "2026-08-13T03:02:01.000Z",
        ownerUserId: userId,
        requestHash: "0".repeat(64),
        sessionId: "90000000-0000-0000-0000-00000000000c",
      }),
    ).resolves.toMatchObject({
      claimed: true,
      generationId: startGenerationId,
      leaseToken: "recovered-start-lease",
      session: { id: sessionId },
    });
    const startOutput = {
      kind: "dialogue-start" as const,
      opener: "Which plan do you prefer?",
      plan: {
        endConditionZh: "达成下一步。",
        roleZh: "你是项目成员，对方是同事。",
        taskZh: "讨论两个计划。",
      },
      prompt: "完成一次受约束对话。",
    };
    await makeReady(
      {
        generationId: startGenerationId,
        input: { items: [itemOne, itemTwo] },
        kind: "dialogue-start",
        leaseToken: "recovered-start-lease",
        ownerUserId: userId,
      },
      startOutput,
      "2026-08-13T03:02:01.000Z",
    );
    const started = await repository.completeStart({
      generationId: startGenerationId,
      generationLeaseToken: "recovered-start-lease",
      idempotencyKey: "dialogue-start-recovered",
      now: "2026-08-13T03:02:02.000Z",
      opener: startOutput.opener,
      openerTurnId: "92000000-0000-0000-0000-000000000000",
      ownerUserId: userId,
      plan: startOutput.plan,
      prompt: startOutput.prompt,
      requestHash: "0".repeat(64),
      sessionId,
    });
    expect(started).toMatchObject({
      items: [{ itemId: itemOne }, { itemId: itemTwo }],
      revision: 1,
    });

    const pending = await repository.recordUserTurn({
      content: "To be frank, I prefer plan B.",
      expectedRevision: 1,
      generationLeaseExpiresAt: "2026-08-13T03:04:00.000Z",
      generationLeaseToken: "turn-lease",
      generationId: assistantGenerationId,
      idempotencyKey: "turn-one",
      now: "2026-08-13T03:02:00.000Z",
      ownerUserId: userId,
      requestHash: "b".repeat(64),
      sessionId,
      turnId: "92000000-0000-0000-0000-000000000001",
    });
    expect(pending).toMatchObject({
      claimed: true,
      session: { pendingGeneration: "assistant-turn", revision: 2 },
    });
    await expect(
      repository.beginAssistantRetry({
        expectedRevision: 2,
        generationLeaseExpiresAt: "2026-08-13T03:05:00.000Z",
        generationLeaseToken: "retry-lease",
        generationId: "91000000-0000-0000-0000-000000000006",
        idempotencyKey: "retry-one",
        now: "2026-08-13T03:03:00.000Z",
        ownerUserId: userId,
        requestHash: "c".repeat(64),
        sessionId,
      }),
    ).resolves.toMatchObject({ claimed: false });
    const takeover = await repository.beginAssistantRetry({
      expectedRevision: 2,
      generationLeaseExpiresAt: "2026-08-13T03:07:00.000Z",
      generationLeaseToken: "retry-lease",
      generationId: "91000000-0000-0000-0000-000000000006",
      idempotencyKey: "retry-one",
      now: "2026-08-13T03:04:01.000Z",
      ownerUserId: userId,
      requestHash: "c".repeat(64),
      sessionId,
    });
    expect(takeover).toMatchObject({ claimed: true, generationId: assistantGenerationId });
    await makeReady(
      {
        generationId: assistantGenerationId,
        input: { sessionId },
        kind: "dialogue-assistant",
        leaseToken: "retry-lease",
        ownerUserId: userId,
      },
      { assistantTurn: "What result would that have?", kind: "dialogue-assistant" },
      "2026-08-13T03:04:01.000Z",
    );
    await expect(
      repository.completeAssistant({
        assistantTurn: "A stale answer.",
        generationId: assistantGenerationId,
        generationLeaseToken: "turn-lease",
        idempotencyKey: "turn-one",
        now: "2026-08-13T03:04:02.000Z",
        operation: "practice.dialogue-turn",
        ownerUserId: userId,
        requestHash: "b".repeat(64),
        sessionId,
        turnId: "92000000-0000-0000-0000-000000000002",
      }),
    ).rejects.toMatchObject({ code: "revision_conflict" });
    const continued = await repository.completeAssistant({
      assistantTurn: "What result would that have?",
      generationId: assistantGenerationId,
      generationLeaseToken: "retry-lease",
      idempotencyKey: "retry-one",
      now: "2026-08-13T03:04:03.000Z",
      operation: "practice.dialogue-assistant-retry",
      ownerUserId: userId,
      requestHash: "c".repeat(64),
      sessionId,
      turnId: "92000000-0000-0000-0000-000000000003",
    });
    expect(continued).toMatchObject({ revision: 3, status: "active" });

    await database.exec(`INSERT INTO practice_turns(id,session_id,owner_user_id,ordinal,role,content)
      VALUES('92000000-0000-0000-0000-000000000004','${sessionId}','${userId}',3,'user','First.'),
      ('92000000-0000-0000-0000-000000000005','${sessionId}','${userId}',4,'assistant','Continue.'),
      ('92000000-0000-0000-0000-000000000006','${sessionId}','${userId}',5,'user','Second.'),
      ('92000000-0000-0000-0000-000000000007','${sessionId}','${userId}',6,'assistant','Done.');`);
    const finishing = await repository.beginFinish({
      expectedRevision: 3,
      generationLeaseExpiresAt: "2026-08-13T03:10:00.000Z",
      generationLeaseToken: "finish-lease",
      generationId: finishGenerationId,
      idempotencyKey: "finish-one",
      now: "2026-08-13T03:08:00.000Z",
      ownerUserId: userId,
      requestHash: "d".repeat(64),
      sessionId,
    });
    expect(finishing).toMatchObject({
      claimed: true,
      generationId: finishGenerationId,
      session: { pendingGeneration: "final-feedback", revision: 4 },
    });
    const finalOutput = {
      itemFeedbacks: [
        { feedback: "使用准确。", itemAlias: "item-1" as const },
        { feedback: "衔接自然。", itemAlias: "item-2" as const },
      ],
      kind: "dialogue-final-feedback" as const,
      summary: "整体表达清晰。",
    };
    await makeReady(
      {
        generationId: finishGenerationId,
        input: { sessionId },
        kind: "dialogue-final-feedback",
        leaseToken: "finish-lease",
        ownerUserId: userId,
      },
      finalOutput,
      "2026-08-13T03:08:00.000Z",
    );
    const completed = await repository.completeFinish({
      finalFeedback: finalOutput.summary,
      generationId: finishGenerationId,
      generationLeaseToken: "finish-lease",
      idempotencyKey: "finish-one",
      itemFeedbacks: [
        { feedback: "使用准确。", itemId: itemOne },
        { feedback: "衔接自然。", itemId: itemTwo },
      ],
      now: "2026-08-13T03:08:01.000Z",
      ownerUserId: userId,
      requestHash: "d".repeat(64),
      sessionId,
    });
    expect(completed).toMatchObject({
      itemFeedbacks: [{ itemId: itemOne }, { itemId: itemTwo }],
      revision: 5,
      status: "completed",
    });
    const dialogueCompletion = await database.query<{ completed_at: Date | null }>(
      "SELECT completed_at FROM practice_sessions WHERE id=$1",
      [sessionId],
    );
    expect(dialogueCompletion.rows[0]?.completed_at?.toISOString()).toBe(
      "2026-08-13T03:08:01.000Z",
    );
    const rated = await practice.rate({
      expectedRevision: 5,
      idempotencyKey: "dialogue-rate",
      input: {
        expectedRevision: 5,
        ratings: [
          { itemId: itemOne, rating: "mastered" },
          { itemId: itemTwo, rating: "effortful" },
        ],
      },
      now: "2026-08-13T03:09:00.000Z",
      ownerUserId: userId,
      requestHash: "e".repeat(64),
      sessionId,
    });
    expect(rated).toMatchObject({
      items: [
        { itemId: itemOne, rating: "mastered", scheduleAfter: { level: 0 } },
        { itemId: itemTwo, rating: "effortful", scheduleAfter: { level: 0 } },
      ],
      revision: 6,
    });
    const schedules = await database.query<{ last_rating: string; learning_item_id: string }>(
      "SELECT learning_item_id::text,last_rating FROM schedule_states ORDER BY learning_item_id",
    );
    expect(schedules.rows).toEqual([
      { last_rating: "mastered", learning_item_id: itemOne },
      { last_rating: "effortful", learning_item_id: itemTwo },
    ]);
  });
});
