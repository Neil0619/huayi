import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { beforeEach, afterEach, expect, it } from "vitest";
import { createPracticeWorkspace } from "./practice-workspace.js";
import { createPgliteAnalysisDatabase } from "./test-support/postgres-analysis-database.js";
import { createPostgresPracticeRepository } from "./postgres-practice-repository.js";
import { createPostgresPracticeHistory } from "./postgres-practice-history.js";
const owner = "00000000-0000-0000-0000-000000000001";
const other = "00000000-0000-0000-0000-000000000002";
const itemId = "60000000-0000-0000-0000-000000000001";
let db: PGlite;
let workspace: ReturnType<typeof createPracticeWorkspace>;
beforeEach(async () => {
  db = new PGlite();
  for (const file of [
    "0001-cloud-v1-foundation.sql",
    "0024-durable-learning-tasks.sql",
    "0025-practice-workspace.sql",
  ])
    await db.exec(await readFile(new URL(`../migrations/${file}`, import.meta.url), "utf8"));
  expect(
    await readFile(
      new URL(
        "../../../supabase/migrations/20260905020000_practice_workspace.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  ).toBe(
    await readFile(new URL("../migrations/0025-practice-workspace.sql", import.meta.url), "utf8"),
  );
  await db.query(
    "INSERT INTO user_profiles(user_id,owner_user_id,email,status,timezone,daily_goal) VALUES($1,$1,'a@example.test','active','UTC',5),($2,$2,'b@example.test','active','UTC',5)",
    [owner, other],
  );
  await db.query(
    `INSERT INTO learning_items(id,owner_user_id,type,canonical_key,content) VALUES($1,$2,'expression','at least','{"type":"expression","text":"at least","meaningZh":"至少","usageZh":"说明最小数量。"}');`,
    [itemId, owner],
  );
  await db.query(
    "INSERT INTO schedule_states(learning_item_id,owner_user_id,level,due_at) VALUES($1,$2,-1,NULL)",
    [itemId, owner],
  );
  workspace = createPracticeWorkspace(createPgliteAnalysisDatabase(db));
});
afterEach(async () => db.close());
it("counts the original self-rating day once even after navigation and repeated rating", async () => {
  const first = await workspace.start(owner, { itemId, mode: "free" }, "rating-day");
  await db.query(
    "UPDATE practice_sessions SET status='completed',final_feedback='表达准确。',completed_at=now() WHERE id=$1",
    [first.id],
  );
  const repository = createPostgresPracticeRepository(createPgliteAnalysisDatabase(db));
  const command = {
    ownerUserId: owner,
    sessionId: first.id,
    idempotencyKey: "rate-once",
    requestHash: "e".repeat(64),
    now: new Date().toISOString(),
    input: { expectedRevision: first.revision, ratings: [{ itemId, rating: "mastered" }] },
  };
  const rated = await repository.rate(command);
  const stamp = (
    await db.query("SELECT rated_at FROM practice_session_items WHERE session_id=$1", [first.id])
  ).rows;
  await db.query("UPDATE practice_sessions SET updated_at=now()+interval '2 days' WHERE id=$1", [
    first.id,
  ]);
  await db.query(
    "UPDATE practice_session_items SET rated_at=now()+interval '2 days' WHERE session_id=$1",
    [first.id],
  );
  const replay = await repository.rate({ ...command, idempotencyKey: "rate-again" });
  expect(replay.items[0]?.scheduleAfter).toEqual(rated.items[0]?.scheduleAfter);
  expect(
    (await db.query("SELECT rated_at FROM practice_session_items WHERE session_id=$1", [first.id]))
      .rows,
  ).toEqual(stamp);
  expect((await repository.dailyQueue(owner, command.now)).completedToday).toBe(1);
});
it("creates free practice without a generation, preserves a paused draft, and releases occupancy", async () => {
  const first = await workspace.start(owner, { itemId, mode: "free" }, "free-one");
  expect(first.prompt).toContain("at least（至少）");
  expect((await db.query("SELECT * FROM practice_generation_tasks")).rows).toHaveLength(0);
  const draft = await workspace.draft(owner, first.id, {
    draft: "I need at least two hours.",
    expectedDraftRevision: 0,
  });
  await expect(
    workspace.draft(other, first.id, { draft: "wrong", expectedDraftRevision: 1 }),
  ).rejects.toThrow();
  const paused = await workspace.control(
    owner,
    first.id,
    { action: "pause", expectedRevision: draft.revision },
    "pause",
  );
  expect(paused.workspace).toMatchObject({ draft: "I need at least two hours.", phase: "paused" });
  const history = createPostgresPracticeHistory(createPgliteAnalysisDatabase(db));
  expect((await history.list(owner, { limit: 20 })).items[0]?.workspacePhase).toBe("paused");
  const next = await workspace.start(owner, { itemId, mode: "guided" }, "next");
  await expect(
    workspace.control(
      owner,
      first.id,
      { action: "resume", expectedRevision: paused.revision },
      "resume-busy",
    ),
  ).rejects.toMatchObject({ code: "generation_busy" });
  await workspace.control(
    owner,
    next.id,
    { action: "skip", expectedRevision: next.revision },
    "skip",
  );
  const resumed = await workspace.control(
    owner,
    first.id,
    { action: "resume", expectedRevision: paused.revision },
    "resume",
  );
  expect(resumed.workspace?.draft).toBe("I need at least two hours.");
  await workspace.control(
    owner,
    first.id,
    { action: "end", expectedRevision: resumed.revision },
    "end",
  );
  expect((await db.query("SELECT level,due_at FROM schedule_states")).rows).toEqual([
    { level: -1, due_at: null },
  ]);
});
it("switches a failed prompt to free mode without losing text or accepting a late draft write", async () => {
  const first = await workspace.start(owner, { itemId, mode: "guided" }, "guided");
  expect(first.pendingGeneration).toBe("sentence-prompt");
  const free = await workspace.control(
    owner,
    first.id,
    { action: "free", expectedRevision: first.revision, draft: "At least I tried." },
    "switch",
  );
  expect(free).toMatchObject({
    status: "active",
    workspace: { mode: "free", draft: "At least I tried.", draftRevision: 1 },
  });
  expect(free.pendingGeneration).toBeUndefined();
  await expect(
    workspace.draft(owner, first.id, { draft: "stale", expectedDraftRevision: 0 }),
  ).rejects.toMatchObject({ code: "revision_conflict" });
  const repository = createPostgresPracticeRepository(createPgliteAnalysisDatabase(db));
  const replay = await repository.completeSentencePrompt({
    ownerUserId: owner,
    sessionId: first.id,
    idempotencyKey: "late",
    requestHash: "a".repeat(64),
    now: new Date().toISOString(),
    generationId: crypto.randomUUID(),
    generationLeaseToken: "old-lease",
    prompt: "迟到的题目",
  });
  expect(replay.prompt).toBe(free.prompt);
  expect(replay.workspace?.draft).toBe("At least I tried.");
  expect((await repository.dailyQueue(owner, new Date().toISOString())).currentSession?.id).toBe(
    first.id,
  );
});
it("binds queued generation to the paused workspace instead of creating a new session", async () => {
  const first = await workspace.start(owner, { itemId, mode: "guided" }, "queued-prompt");
  const paused = await workspace.control(
    owner,
    first.id,
    { action: "pause", expectedRevision: first.revision, draft: "At least it is saved." },
    "pause-prompt",
  );
  const repository = createPostgresPracticeRepository(createPgliteAnalysisDatabase(db));
  const generationId = crypto.randomUUID();
  const now = new Date().toISOString();
  const claim = await repository.beginSentence({
    ownerUserId: owner,
    sessionId: crypto.randomUUID(),
    targetSessionId: first.id,
    itemId,
    idempotencyKey: "worker-prompt",
    requestHash: "b".repeat(64),
    now,
    generationId,
    generationLeaseToken: "paused-lease",
    generationLeaseExpiresAt: new Date(Date.now() + 120000).toISOString(),
  });
  expect(claim.claimed).toBe(true);
  expect(claim.session.id).toBe(first.id);
  expect(claim.session.workspace).toEqual(paused.workspace);
  expect((await db.query("SELECT id FROM practice_sessions")).rows).toHaveLength(1);
});
it("keeps an already queued answer valid while pause releases the workspace", async () => {
  const first = await workspace.start(owner, { itemId, mode: "free" }, "queued-answer");
  const paused = await workspace.control(
    owner,
    first.id,
    { action: "pause", expectedRevision: first.revision, expectedControlRevision: 0 },
    "pause-answer",
  );
  expect(paused.revision).toBe(first.revision);
  await expect(
    workspace.control(
      owner,
      first.id,
      { action: "resume", expectedRevision: first.revision, expectedControlRevision: 0 },
      "stale-resume",
    ),
  ).rejects.toMatchObject({ code: "revision_conflict" });
  const repository = createPostgresPracticeRepository(createPgliteAnalysisDatabase(db));
  const claim = await repository.recordAttempt({
    ownerUserId: owner,
    sessionId: first.id,
    expectedRevision: first.revision,
    answer: "I need at least two hours.",
    attemptId: crypto.randomUUID(),
    idempotencyKey: "worker-answer",
    requestHash: "d".repeat(64),
    now: new Date().toISOString(),
    generationId: crypto.randomUUID(),
    feedbackLeaseToken: "queued-feedback",
    feedbackLeaseExpiresAt: new Date(Date.now() + 120000).toISOString(),
  });
  expect(claim.claimed).toBe(true);
  expect(claim.session.workspace?.phase).toBe("paused");
  expect(claim.session.attempts?.[0]?.answer).toBe("I need at least two hours.");
  expect((await workspace.start(owner, { itemId, mode: "free" }, "other-answer")).id).not.toBe(
    first.id,
  );
});
it("applies an already saved paid prompt after worker failure without another generation", async () => {
  const { createPostgresLearningTasks } = await import("./postgres-learning-tasks.js");
  const { createPracticeTaskRecovery } = await import("./practice-task-recovery.js");
  const adapter = createPgliteAnalysisDatabase(db);
  const first = await workspace.start(owner, { itemId, mode: "guided" }, "recover-workspace");
  const tasks = createPostgresLearningTasks(adapter);
  const job = await tasks.submit(owner, "recover-job", {
    version: 2,
    kind: "sentence-start",
    sessionId: first.id,
    input: { itemId },
  });
  const lease = await tasks.claim();
  if (!lease) throw new Error("Missing worker lease");
  const repository = createPostgresPracticeRepository(adapter);
  const generationId = crypto.randomUUID();
  const now = new Date().toISOString();
  const reservationId = crypto.randomUUID();
  await repository.beginSentence({
    ownerUserId: owner,
    sessionId: first.id,
    targetSessionId: first.id,
    itemId,
    idempotencyKey: job.id,
    requestHash: "c".repeat(64),
    now,
    generationId,
    generationLeaseToken: "saved-lease",
    generationLeaseExpiresAt: new Date(Date.now() + 120000).toISOString(),
  });
  await db.query(
    `INSERT INTO quota_reservations(id,user_id,owner_user_id,request_id,period_start,reserved_micro_usd,status,expires_at) VALUES($1,$2,$2,$3,date_trunc('month',now()),100,'settled',now()+interval '1 minute')`,
    [reservationId, owner, generationId],
  );
  await db.query(
    `UPDATE practice_generation_tasks SET state='ready',reservation_id=$2,output='{"kind":"sentence-prompt","prompt":"已保存的中文场景"}'::jsonb WHERE id=$1`,
    [generationId, reservationId],
  );
  await tasks.touch(lease, true);
  await db.query(
    "UPDATE learning_tasks SET lease_expires_at=now()-interval '1 second' WHERE id=$1",
    [job.id],
  );
  expect(await tasks.claim()).toBeNull();
  expect((await tasks.get(owner, job.id))?.state).toBe("unknown");
  const recovery = createPracticeTaskRecovery(adapter);
  await recovery();
  await recovery();
  expect(await tasks.claim()).toBeNull();
  expect((await tasks.get(owner, job.id))?.state).toBe("completed");
  expect((await workspace.get(owner, first.id)).prompt).toBe("已保存的中文场景");
  expect((await db.query("SELECT state FROM practice_generation_tasks")).rows).toEqual([
    { state: "applied" },
  ]);
  expect((await db.query("SELECT id FROM quota_reservations")).rows).toHaveLength(1);
});
