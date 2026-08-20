import { readFile } from "node:fs/promises";

import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AnalysisDatabase, AnalysisQuery } from "./analysis-database.js";
import { createPostgresAnalysisQuota } from "./postgres-analysis-quota.js";
import { createPostgresLearningLibraryMaintenance } from "./postgres-learning-library-maintenance.js";
import { createPostgresPracticeGenerationRepository } from "./postgres-practice-generation.js";
import { createPostgresPracticeRepository } from "./postgres-practice-repository.js";

const migrationUrl = new URL("../migrations/0001-cloud-v1-foundation.sql", import.meta.url);
const userA = "00000000-0000-0000-0000-00000000000a";
const dueItem = "60000000-0000-0000-0000-00000000000a";
const newItem = "60000000-0000-0000-0000-00000000000b";
const sessionId = "90000000-0000-0000-0000-00000000000a";
const attemptId = "91000000-0000-0000-0000-00000000000a";

function query(executor: {
  query<Row>(text: string, parameters?: unknown[]): Promise<{ rows: Row[] }>;
}): AnalysisQuery {
  return {
    rows: async <Row>(text: string, parameters = []) =>
      (await executor.query<Row>(text, [...parameters])).rows,
  };
}

describe("Postgres sentence practice", () => {
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
      VALUES('${userA}','${userA}','a@example.test','active','Asia/Shanghai',2);
      INSERT INTO learning_items(id,owner_user_id,type,canonical_key,content,created_at)
      VALUES('${dueItem}','${userA}','expression','to be frank',
        '{"type":"expression","text":"to be frank","meaningZh":"坦率地说","usageZh":"表达意见。"}',
        '2026-08-01T00:00:00Z'),
        ('${newItem}','${userA}','expression','as a result',
        '{"type":"expression","text":"as a result","meaningZh":"因此","usageZh":"说明结果。"}',
        '2026-08-02T00:00:00Z');
      INSERT INTO schedule_states(learning_item_id,owner_user_id,level,due_at)
      VALUES('${dueItem}','${userA}',0,'2026-08-13T15:00:00Z'),
        ('${newItem}','${userA}',-1,NULL);
      INSERT INTO source_examples(id,owner_user_id,learning_item_id,source_text,source_type)
      VALUES('80000000-0000-0000-0000-00000000000a','${userA}','${dueItem}',
        'To be frank, I disagree.','manual');`);
  });
  afterEach(async () => database.close());

  it("persists attempt before feedback, counts awaiting feedback as active, and rates once", async () => {
    const repository = createPostgresPracticeRepository(adapter);
    const startCommand = {
      generationLeaseExpiresAt: "2026-08-13T03:02:00.000Z",
      generationLeaseToken: "prompt-lease",
      generationId: "91000000-0000-0000-0000-000000000001",
      idempotencyKey: "start-1",
      itemId: dueItem,
      now: "2026-08-13T03:00:00.000Z",
      ownerUserId: userA,
      requestHash: "a".repeat(64),
      sessionId,
    };
    const promptClaim = await repository.beginSentence(startCommand);
    expect(promptClaim).toMatchObject({
      claimed: true,
      session: {
        pendingGeneration: "sentence-prompt",
        revision: 1,
        status: "awaiting-feedback",
      },
    });
    const durablePromptClaim = await database.query<{
      current_generation_id: string | null;
      state: string;
    }>(
      `SELECT sessions.current_generation_id::text,tasks.state
        FROM practice_sessions sessions JOIN practice_generation_tasks tasks
        ON tasks.id=sessions.current_generation_id WHERE sessions.id=$1`,
      [sessionId],
    );
    expect(durablePromptClaim.rows[0]).toEqual({
      current_generation_id: startCommand.generationId,
      state: "claimed",
    });
    const priceVersionId = "92000000-0000-0000-0000-000000000001";
    await database.exec(`INSERT INTO model_price_versions(
      id,provider,model,input_micro_usd_per_million,cached_input_micro_usd_per_million,
      output_micro_usd_per_million,effective_from
    ) VALUES('${priceVersionId}','deepseek','practice-fixed',100,100,100,now());
    INSERT INTO quota_grants(
      id,user_id,owner_user_id,period_start,period_end,limit_micro_usd,source
    ) VALUES('93000000-0000-0000-0000-000000000001','${userA}','${userA}',
      date_trunc('month',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC',
      (date_trunc('month',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')+interval '1 month',
      1000,'default');`);
    let generatedId = 0;
    const nextId = () => {
      generatedId += 1;
      return `94000000-0000-0000-0000-${String(generatedId).padStart(12, "0")}`;
    };
    let generationNow = new Date("2026-08-13T03:01:00.000Z");
    const generation = createPostgresPracticeGenerationRepository({
      database: adapter,
      ledgerId: nextId,
      now: () => generationNow,
      priceVersionId,
      quota: createPostgresAnalysisQuota({
        database: adapter,
        expiresAt: () => new Date(Date.now() + 120_000),
        id: nextId,
        now: () => new Date("2026-08-13T03:00:00.000Z"),
        priceVersionId,
      }),
      reservedMicroUsd: 100,
    });
    const generationCommand = {
      generationId: startCommand.generationId,
      input: { itemContent: "to be frank" },
      kind: "sentence-prompt" as const,
      leaseToken: startCommand.generationLeaseToken,
      ownerUserId: userA,
    };
    const acquired = await generation.acquire(generationCommand);
    expect(acquired).toMatchObject({ kind: "acquired" });
    if (acquired.kind !== "acquired") throw new Error("Generation reservation missing.");
    await expect(
      generation.markDispatched({ ...generationCommand, reservationId: acquired.reservationId }),
    ).resolves.toBe(true);
    await generation.complete({
      ...generationCommand,
      billedCalls: [
        {
          costMicroUsd: 10,
          usage: { cachedInputTokens: 0, inputTokens: 10, outputTokens: 5 },
        },
      ],
      output: { kind: "sentence-prompt", prompt: "请写一句用于坦率表达意见的话。" },
      reservationId: acquired.reservationId,
    });
    const readyReplayCommand = {
      ...startCommand,
      generationId: "91000000-0000-0000-0000-000000000099",
      generationLeaseToken: "unused-ready-replay-token",
      idempotencyKey: "start-ready-replay",
      now: "2026-08-13T03:01:00.000Z",
    };
    const readyReplay = await repository.beginSentence(readyReplayCommand);
    expect(readyReplay).toMatchObject({
      claimed: true,
      generationId: startCommand.generationId,
      leaseToken: startCommand.generationLeaseToken,
    });
    if (!readyReplay.claimed) throw new Error("Ready generation was not replayed.");
    const started = await repository.completeSentencePrompt({
      ...readyReplayCommand,
      generationLeaseToken: readyReplay.leaseToken,
      prompt: "请写一句用于坦率表达意见的话。",
    });
    expect(started).toMatchObject({ revision: 2, status: "active" });
    const appliedPrompt = await database.query<{
      current_generation_id: string | null;
      state: string;
    }>(
      `SELECT sessions.current_generation_id::text,tasks.state
        FROM practice_sessions sessions JOIN practice_generation_tasks tasks
        ON tasks.session_id=sessions.id WHERE sessions.id=$1`,
      [sessionId],
    );
    expect(appliedPrompt.rows[0]).toEqual({ current_generation_id: null, state: "applied" });
    const ledger = await database.query<{ feature: string; status: string }>(
      `SELECT ledger.feature,reservations.status FROM usage_ledger ledger
        JOIN quota_reservations reservations ON reservations.request_id=ledger.request_id
        WHERE ledger.request_id=$1`,
      [startCommand.generationId],
    );
    expect(ledger.rows[0]).toEqual({
      feature: "practice.sentence-prompt",
      status: "settled",
    });
    const attemptCommand = {
      answer: "To be frank, I disagree.",
      attemptId,
      expectedRevision: 2,
      feedbackLeaseExpiresAt: "2026-08-13T03:07:00.000Z",
      feedbackLeaseToken: "initial-lease",
      generationId: "97000000-0000-0000-0000-000000000001",
      idempotencyKey: "attempt-1",
      now: "2026-08-13T03:05:00.000Z",
      ownerUserId: userA,
      requestHash: "b".repeat(64),
      sessionId,
    };
    const pending = await repository.recordAttempt(attemptCommand);
    expect(pending).toMatchObject({
      claimed: true,
      session: { revision: 3, status: "awaiting-feedback" },
    });
    await expect(repository.recordAttempt(attemptCommand)).resolves.toMatchObject({
      claimed: false,
    });
    const stored = await database.query<{ answer: string; feedback: string | null }>(
      "SELECT answer,feedback FROM practice_attempts WHERE id=$1",
      [attemptId],
    );
    expect(stored.rows[0]).toEqual({ answer: "To be frank, I disagree.", feedback: null });
    const retryBase = {
      attemptId,
      expectedRevision: 3,
      feedbackLeaseExpiresAt: "2026-08-13T03:08:00.000Z",
      feedbackLeaseToken: "retry-lease",
      generationId: "97000000-0000-0000-0000-000000000002",
      idempotencyKey: "retry-1",
      now: "2026-08-13T03:05:30.000Z",
      ownerUserId: userA,
      requestHash: "9".repeat(64),
      sessionId,
    };
    await expect(repository.beginFeedbackRetry(retryBase)).resolves.toMatchObject({
      claimed: false,
    });
    const takeover = await repository.beginFeedbackRetry({
      ...retryBase,
      now: "2026-08-13T03:07:01.000Z",
    });
    expect(takeover).toMatchObject({
      claimed: true,
      generationId: attemptCommand.generationId,
      leaseToken: "retry-lease",
    });
    await repository.releaseFeedbackLease({
      attemptId,
      feedbackLeaseToken: "initial-lease",
      now: "2026-08-13T03:07:02.000Z",
      ownerUserId: userA,
      sessionId,
    });
    const lease = await database.query<{ feedback_lease_token: string | null }>(
      "SELECT feedback_lease_token FROM practice_attempts WHERE id=$1",
      [attemptId],
    );
    expect(lease.rows[0]?.feedback_lease_token).toBe("retry-lease");

    generationNow = new Date("2026-08-13T03:07:01.000Z");
    const feedbackGenerationCommand = {
      generationId: attemptCommand.generationId,
      input: {
        answer: attemptCommand.answer,
        itemContent: "to be frank",
        prompt: "请写一句用于坦率表达意见的话。",
      },
      kind: "sentence-feedback" as const,
      leaseToken: "retry-lease",
      ownerUserId: userA,
    };
    const feedbackAcquired = await generation.acquire(feedbackGenerationCommand);
    if (feedbackAcquired.kind !== "acquired") throw new Error("Feedback reservation missing.");
    await expect(
      generation.markDispatched({
        ...feedbackGenerationCommand,
        reservationId: feedbackAcquired.reservationId,
      }),
    ).resolves.toBe(true);
    await generation.complete({
      ...feedbackGenerationCommand,
      billedCalls: [
        {
          costMicroUsd: 12,
          usage: { cachedInputTokens: 0, inputTokens: 12, outputTokens: 6 },
        },
      ],
      output: { feedback: "准确、自然；建议保持简洁。", kind: "sentence-feedback" },
      reservationId: feedbackAcquired.reservationId,
    });
    await expect(
      repository.beginSentence({
        generationLeaseExpiresAt: "2026-08-13T03:09:00.000Z",
        generationLeaseToken: "other-prompt-lease",
        generationId: "91000000-0000-0000-0000-000000000002",
        idempotencyKey: "start-2",
        itemId: newItem,
        now: "2026-08-13T03:07:02.000Z",
        ownerUserId: userA,
        requestHash: "c".repeat(64),
        sessionId: "90000000-0000-0000-0000-00000000000b",
      }),
    ).rejects.toMatchObject({ code: "generation_busy" });

    await expect(
      repository.completeFeedback({
        attemptId,
        feedback: "旧 worker 不应覆盖。",
        feedbackLeaseToken: "initial-lease",
        generationId: attemptCommand.generationId,
        idempotencyKey: "attempt-1",
        now: "2026-08-13T03:07:02.000Z",
        operation: "practice.attempt",
        ownerUserId: userA,
        requestHash: "b".repeat(64),
        sessionId,
      }),
    ).rejects.toMatchObject({ code: "revision_conflict" });
    const completed = await repository.completeFeedback({
      attemptId,
      feedback: "准确、自然；建议保持简洁。",
      feedbackLeaseToken: "retry-lease",
      generationId: attemptCommand.generationId,
      idempotencyKey: "retry-1",
      now: "2026-08-13T03:07:03.000Z",
      operation: "practice.feedback-retry",
      ownerUserId: userA,
      requestHash: "9".repeat(64),
      sessionId,
    });
    expect(completed).toMatchObject({
      finalFeedback: expect.any(String),
      revision: 4,
      status: "completed",
    });
    const sentenceCompletion = await database.query<{ completed_at: Date | null }>(
      "SELECT completed_at FROM practice_sessions WHERE id=$1",
      [sessionId],
    );
    expect(sentenceCompletion.rows[0]?.completed_at?.toISOString()).toBe(
      "2026-08-13T03:07:03.000Z",
    );
    await expect(repository.dailyQueue(userA, "2026-08-13T03:07:04.000Z")).resolves.toMatchObject({
      currentItems: [{ item: { id: dueItem } }],
      currentSession: { id: sessionId, status: "completed" },
    });

    const ratingCommand = {
      expectedRevision: 4,
      idempotencyKey: "rate-1",
      input: {
        expectedRevision: 4,
        ratings: [{ itemId: dueItem, rating: "mastered" as const }],
      },
      now: "2026-08-13T03:07:00.000Z",
      ownerUserId: userA,
      requestHash: "d".repeat(64),
      sessionId,
    };
    const rated = await repository.rate(ratingCommand);
    expect(rated).toMatchObject({
      items: [{ rating: "mastered", scheduleAfter: { level: 1 } }],
      revision: 5,
    });
    const completionAfterRating = await database.query<{ completed_at: Date | null }>(
      "SELECT completed_at FROM practice_sessions WHERE id=$1",
      [sessionId],
    );
    expect(completionAfterRating.rows[0]?.completed_at?.toISOString()).toBe(
      "2026-08-13T03:07:03.000Z",
    );
    await expect(
      repository.rate({ ...ratingCommand, idempotencyKey: "rate-2", requestHash: "e".repeat(64) }),
    ).resolves.toMatchObject({ revision: 5 });
    await expect(
      repository.rate({
        ...ratingCommand,
        idempotencyKey: "rate-3",
        input: {
          expectedRevision: 5,
          ratings: [{ itemId: dueItem, rating: "forgot" }],
        },
        requestHash: "f".repeat(64),
      }),
    ).rejects.toMatchObject({ code: "idempotency_conflict" });

    await database.exec(
      `UPDATE learning_items SET archived_at='2026-08-13T03:08Z' WHERE id='${dueItem}'`,
    );
    await createPostgresLearningLibraryMaintenance(adapter).delete({
      expectedRevision: 1,
      id: dueItem,
      idempotencyKey: "erase-after-practice",
      now: "2026-08-13T03:08:01.000Z",
      ownerUserId: userA,
      requestHash: "1".repeat(64),
    });
    await expect(repository.beginSentence(startCommand)).resolves.toMatchObject({
      claimed: false,
      session: { id: sessionId },
    });
  });
});
