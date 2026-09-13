import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { formatPracticeTeachingFeedback } from "@huayi/cloud-contracts";
import { createPostgresLearningItemDelete } from "./postgres-learning-item-delete.js";
import {
  createPracticeTeachingFixture,
  practiceOwner,
  practiceItemId,
  practiceVersions,
} from "./test-support/practice-teaching-fixture.js";

const teachingFeedback = {
  assessment: "ready" as const,
  mainPointZh: "表达准确。",
  exampleSentence: "I need at least two days.",
  usageNoteZh: "至少表示数量下限。",
};
const output = {
  kind: "sentence-feedback",
  teachingFeedback,
  feedback: formatPracticeTeachingFeedback(teachingFeedback),
};
describe("attempt-bound feedback persistence", () => {
  let f: Awaited<ReturnType<typeof createPracticeTeachingFixture>>;
  beforeEach(async () => {
    f = await createPracticeTeachingFixture();
  });
  afterEach(async () => {
    await f.db.close();
  });
  async function ready() {
    const session = await f.begin();
    const key = randomUUID();
    const claim = await f.submit(session, key);
    if (!claim.claimed) throw new Error("Attempt not claimed");
    const attemptId = claim.session.attempts?.[0]?.id;
    if (!attemptId) throw new Error("Missing attempt");
    const reservationId = randomUUID();
    await f.db.query(
      "INSERT INTO quota_reservations(id,user_id,owner_user_id,request_id,period_start,reserved_micro_usd,status,expires_at) VALUES($1,$2,$2,$3,date_trunc('month',now()),100,'settled',now()+interval '1 day')",
      [reservationId, practiceOwner, claim.generationId],
    );
    await f.db.query(
      "UPDATE practice_generation_tasks SET state='ready',output=$2::jsonb,reservation_id=$3 WHERE id=$1",
      [claim.generationId, JSON.stringify(output), reservationId],
    );
    const command = {
      ownerUserId: practiceOwner,
      sessionId: session.id,
      attemptId,
      generationId: claim.generationId,
      feedbackLeaseToken: claim.leaseToken,
      idempotencyKey: key,
      requestHash: "a".repeat(64),
      operation: "practice.attempt" as const,
      now: new Date().toISOString(),
      feedback: output.feedback,
      teachingFeedback,
    };
    return { session, claim, command };
  }
  it("pins the captured target and exact attempt instead of later live content", async () => {
    const session = await f.begin();
    await f.db.query(
      "UPDATE learning_items SET content=jsonb_set(content,'{text}','\"as a result\"'),canonical_key='as a result' WHERE id=$1",
      [practiceItemId],
    );
    const claim = await f.submit(session);
    expect(claim).toMatchObject({
      attemptId: claim.session.attempts?.[0]?.id,
      ordinal: 0,
      teachingContract: "practice-teaching-v1",
      itemContent: { text: "at least" },
    });
  });
  it("uses the captured target and hidden-hint policy for the guided prompt", async () => {
    const session = await f.workspace.start(
      practiceOwner,
      {
        itemId: practiceItemId,
        mode: "guided",
        teachingContract: "practice-teaching-v1",
        hintPolicy: "on-demand",
      },
      randomUUID(),
    );
    await f.db.query(
      "UPDATE learning_items SET content=jsonb_set(content,'{text}','\"as a result\"'),canonical_key='as a result' WHERE id=$1",
      [practiceItemId],
    );
    const claim = await f.repository.beginSentence({
      ownerUserId: practiceOwner,
      sessionId: randomUUID(),
      targetSessionId: session.id,
      itemId: practiceItemId,
      generationId: randomUUID(),
      generationLeaseToken: randomUUID(),
      generationLeaseExpiresAt: new Date(Date.now() + 120_000).toISOString(),
      now: new Date().toISOString(),
      idempotencyKey: randomUUID(),
      requestHash: "b".repeat(64),
    });
    expect(claim).toMatchObject({
      claimed: true,
      promptInput: {
        itemContent: { text: "at least" },
        teachingContract: "practice-teaching-v1",
        hintPolicy: "on-demand",
      },
    });
  });
  it("atomically saves structure, completion time and the old string", async () => {
    const { session, command } = await ready();
    await f.repository.completeFeedback(command);
    const detail = await f.teaching.get(practiceOwner, session.id);
    expect(detail.teaching?.attempts[0]).toMatchObject({
      feedback: teachingFeedback,
      feedbackCompletedAt: command.now,
    });
    expect(detail.session.finalFeedback).toBe(output.feedback);
  });
  it("rejects the same display text carrying a different full structure", async () => {
    const { command } = await ready();
    const different = {
      ...teachingFeedback,
      assessment: "needs-revision" as const,
      answerExcerpt: "I need",
    };
    await expect(
      f.repository.completeFeedback({ ...command, teachingFeedback: different }),
    ).rejects.toMatchObject({ code: "revision_conflict" });
  });
  it("keeps the original pending key attached to its ready generation", async () => {
    const { session, command, claim } = await ready();
    const replay = await f.submit(session, command.idempotencyKey);
    expect(replay).toMatchObject({
      claimed: true,
      generationId: claim.generationId,
      attemptId: command.attemptId,
    });
    expect(
      (await f.db.query("SELECT id FROM practice_attempts WHERE session_id=$1", [session.id])).rows,
    ).toHaveLength(1);
  });
  it("persists a pending retry receipt at claim time", async () => {
    const { session, command, claim } = await ready();
    const retryKey = randomUUID();
    await f.repository.beginFeedbackRetry({
      ownerUserId: practiceOwner,
      sessionId: session.id,
      attemptId: command.attemptId,
      expectedRevision: claim.session.revision,
      generationId: randomUUID(),
      feedbackLeaseToken: randomUUID(),
      feedbackLeaseExpiresAt: new Date(Date.now() + 120_000).toISOString(),
      now: new Date().toISOString(),
      requestHash: "b".repeat(64),
      idempotencyKey: retryKey,
    });
    const saved = await f.db.query<{ response: unknown }>(
      "SELECT response FROM idempotency_records WHERE key=$1 AND operation='practice.feedback-retry'",
      [retryKey],
    );
    expect(saved.rows[0]?.response).toMatchObject({
      state: "pending",
      sessionId: session.id,
      attemptId: command.attemptId,
      generationId: claim.generationId,
    });
  });
  it("replays an applied old round without replacing the current round", async () => {
    const { session, command } = await ready();
    const completed = await f.repository.completeFeedback(command);
    const reopened = await f.teaching.act(
      practiceOwner,
      session.id,
      { action: "rewrite", ...practiceVersions(completed) },
      randomUUID(),
    );
    const replay = await f.repository.completeFeedback(command);
    expect(replay).toEqual(reopened.session);
    expect((await f.teaching.get(practiceOwner, session.id)).session).toEqual(reopened.session);
    await expect(
      f.repository.completeFeedback({ ...command, generationId: randomUUID() }),
    ).rejects.toMatchObject({ code: "revision_conflict" });
  });
  it("retains the deletion guard and replays completed feedback after actual target erasure", async () => {
    const { session, command } = await ready();
    const erase = {
      ownerUserId: practiceOwner,
      id: practiceItemId,
      expectedRevision: 1,
      idempotencyKey: randomUUID(),
      requestHash: "e".repeat(64),
      now: new Date().toISOString(),
    };
    await expect(createPostgresLearningItemDelete(f.database)(erase)).rejects.toMatchObject({
      code: "learning_item_in_use",
    });
    const completed = await f.repository.completeFeedback(command);
    await f.repository.rate({
      ownerUserId: practiceOwner,
      sessionId: session.id,
      idempotencyKey: randomUUID(),
      requestHash: "d".repeat(64),
      now: new Date().toISOString(),
      input: {
        expectedRevision: completed.revision,
        ratings: [{ itemId: practiceItemId, rating: "mastered" }],
      },
    });
    await f.db.query("UPDATE learning_items SET archived_at=now() WHERE id=$1", [practiceItemId]);
    await createPostgresLearningItemDelete(f.database)(erase);
    const replay = await f.submit(session, command.idempotencyKey);
    expect(replay).toMatchObject({ claimed: false, session: { status: "completed" } });
    expect(replay).not.toHaveProperty("itemContent");
    const detail = await f.teaching.get(practiceOwner, session.id);
    expect(detail.teaching?.target).toMatchObject({ state: "deleted" });
    expect(detail.teaching?.target).not.toHaveProperty("content");
    expect(detail.teaching?.attempts[0]?.feedback).toEqual(teachingFeedback);
    expect(await f.repository.completeFeedback(command)).toEqual(detail.session);
  });
  it("rejects a replay key used on another session even when the request body is identical", async () => {
    const { session, command } = await ready();
    await expect(
      f.submit({ ...session, id: randomUUID() }, command.idempotencyKey),
    ).rejects.toMatchObject({ code: "idempotency_conflict" });
  });
});
