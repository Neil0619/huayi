import { afterEach, beforeEach, expect, it } from "vitest";
import { createPostgresPracticeHistory } from "./postgres-practice-history.js";
import {
  createPracticeTeachingFixture,
  practiceContent,
  practiceItemId,
  practiceOther,
  practiceOwner,
  practiceVersions,
} from "./test-support/practice-teaching-fixture.js";

let fixture: Awaited<ReturnType<typeof createPracticeTeachingFixture>>;
beforeEach(async () => {
  fixture = await createPracticeTeachingFixture();
});
afterEach(async () => fixture?.db.close());

it("pins only the target content and leaves the strict legacy session unchanged", async () => {
  const session = await fixture.begin();
  await fixture.db.query(
    "UPDATE learning_items SET content=jsonb_set(content,'{text}','\"changed later\"') WHERE id=$1",
    [practiceItemId],
  );
  const detail = await fixture.teaching.get(practiceOwner, session.id);
  expect(detail.session).toEqual(session);
  expect(detail.teaching).toMatchObject({
    contract: "practice-teaching-v1",
    hintPolicy: "on-demand",
    target: { state: "available", content: practiceContent },
    round: { ordinal: 0, parentAttemptId: null, hintViewedAt: null },
    attempts: [],
  });
  expect(Object.keys(detail.session).sort()).toEqual(
    [
      "createdAt",
      "id",
      "items",
      "prompt",
      "revision",
      "status",
      "turns",
      "type",
      "updatedAt",
      "workspace",
    ].sort(),
  );
  await expect(fixture.teaching.get(practiceOther, session.id)).rejects.toMatchObject({
    code: "not_found",
  });
});

it("protects teaching drafts from unversioned or stale controls and preserves old controls", async () => {
  const session = await fixture.begin();
  await fixture.workspace.draft(practiceOwner, session.id, {
    draft: "newest",
    expectedDraftRevision: 0,
  });
  for (const input of [{}, { expectedDraftRevision: 0 }]) {
    await expect(
      fixture.workspace.control(
        practiceOwner,
        session.id,
        { action: "pause", expectedRevision: session.revision, draft: "stale", ...input },
        crypto.randomUUID(),
      ),
    ).rejects.toMatchObject({ code: "revision_conflict" });
  }
  const paused = await fixture.workspace.control(
    practiceOwner,
    session.id,
    { action: "pause", expectedRevision: session.revision },
    "preserve",
  );
  expect(paused.workspace).toMatchObject({ draft: "newest", draftRevision: 1, phase: "paused" });
  const legacy = await fixture.workspace.start(
    practiceOwner,
    { itemId: practiceItemId, mode: "free" },
    "legacy",
  );
  expect((await fixture.teaching.get(practiceOwner, legacy.id)).teaching).toBeNull();
  const controlled = await fixture.workspace.control(
    practiceOwner,
    legacy.id,
    { action: "pause", expectedRevision: legacy.revision, draft: "old client" },
    "old-control",
  );
  expect(controlled.workspace?.draft).toBe("old client");
});

it("records a hint once, rejects the queued old revision before any generation, and freezes the answer fact", async () => {
  const session = await fixture.begin();
  const hint = {
    action: "reveal-hint",
    expectedRevision: session.revision,
    expectedControlRevision: 0,
    ordinal: 0,
  };
  const first = await fixture.teaching.act(practiceOwner, session.id, hint, "view");
  const repeat = await fixture.teaching.act(practiceOwner, session.id, hint, "view");
  expect(repeat).toEqual(first);
  expect(first.teaching?.round.hintViewedAt).toEqual(expect.any(String));
  expect(first.session.workspace?.draftRevision).toBe(0);
  await expect(fixture.submit(session)).rejects.toMatchObject({ code: "revision_conflict" });
  expect((await fixture.db.query("SELECT id FROM practice_generation_tasks")).rows).toEqual([]);
  const submitted = await fixture.submit(first.session);
  const detail = await fixture.teaching.get(practiceOwner, session.id);
  expect(detail.teaching?.attempts[0]?.hintViewedAt).toBe(first.teaching?.round.hintViewedAt);
  await expect(
    fixture.teaching.act(
      practiceOwner,
      session.id,
      { ...hint, expectedRevision: submitted.session.revision, expectedControlRevision: 1 },
      "late",
    ),
  ).rejects.toMatchObject({ code: "revision_conflict" });
});

it("submitting first prevents a late hint from changing that answer", async () => {
  const session = await fixture.begin();
  const claim = await fixture.submit(session);
  await expect(
    fixture.teaching.act(
      practiceOwner,
      session.id,
      {
        action: "reveal-hint",
        expectedRevision: claim.session.revision,
        expectedControlRevision: 0,
        ordinal: 0,
      },
      "late",
    ),
  ).rejects.toMatchObject({ code: "revision_conflict" });
  expect(
    (await fixture.teaching.get(practiceOwner, session.id)).teaching?.attempts[0]?.hintViewedAt,
  ).toBeNull();
});

it("keeps all five answers in ordinal order, carries parent identity, and rejects a sixth", async () => {
  let session = await fixture.begin();
  const ids: string[] = [];
  for (let index = 0; index < 5; index++) {
    const id = `70000000-0000-0000-0000-00000000000${5 - index}`;
    ids.push(id);
    session = await fixture.complete(session, id);
    const detail = await fixture.teaching.get(practiceOwner, session.id);
    expect(detail.teaching?.attempts[index]).toMatchObject({
      attemptId: id,
      ordinal: index,
      parentAttemptId: ids[index - 1] ?? null,
      hintViewedAt: null,
    });
    const request = { action: "rewrite", ...practiceVersions(session) };
    if (index === 4) {
      await expect(
        fixture.teaching.act(practiceOwner, session.id, request, "sixth"),
      ).rejects.toMatchObject({ code: "revision_conflict" });
    } else {
      const next = await fixture.teaching.act(
        practiceOwner,
        session.id,
        request,
        `rewrite-${index}`,
      );
      expect(next.session).toMatchObject({
        status: "active",
        workspace: { draft: "I need at least two days.", phase: "active" },
      });
      expect(next.session.finalFeedback).toBeUndefined();
      expect(
        await fixture.teaching.act(practiceOwner, session.id, request, `rewrite-${index}`),
      ).toEqual(next);
      await expect(
        fixture.teaching.act(practiceOwner, session.id, request, `different-${index}`),
      ).rejects.toMatchObject({ code: "revision_conflict" });
      const history = createPostgresPracticeHistory(fixture.database);
      expect((await history.list(practiceOwner, { limit: 20 })).items[0]?.completedAt).toBeNull();
      session = next.session;
    }
  }
  await fixture.db.query("UPDATE practice_attempts SET submitted_at='2026-09-13T00:00:00Z'");
  expect(
    (await fixture.workspace.get(practiceOwner, session.id)).attempts?.map((attempt) => attempt.id),
  ).toEqual(ids);
  expect((await fixture.db.query("SELECT id FROM practice_generation_tasks")).rows).toHaveLength(5);
});

it("keeps the first rating and its original day after a rewrite", async () => {
  const completed = await fixture.complete(await fixture.begin());
  const command = {
    ownerUserId: practiceOwner,
    sessionId: completed.id,
    idempotencyKey: "rating",
    requestHash: "b".repeat(64),
    now: new Date().toISOString(),
    input: {
      expectedRevision: completed.revision,
      ratings: [{ itemId: practiceItemId, rating: "mastered" }],
    },
  };
  const rated = await fixture.repository.rate(command);
  const before = (
    await fixture.db.query("SELECT rating,rated_at,schedule_after FROM practice_session_items")
  ).rows;
  const next = await fixture.teaching.act(
    practiceOwner,
    rated.id,
    { action: "rewrite", ...practiceVersions(rated) },
    "rated-rewrite",
  );
  expect(next.session.items).toEqual(rated.items);
  const second = await fixture.complete(next.session);
  await fixture.repository.rate({
    ...command,
    idempotencyKey: "same-rating",
    input: { ...command.input, expectedRevision: second.revision },
  });
  expect(
    (await fixture.db.query("SELECT rating,rated_at,schedule_after FROM practice_session_items"))
      .rows,
  ).toEqual(before);
  expect((await fixture.repository.dailyQueue(practiceOwner, command.now)).completedToday).toBe(1);
  expect((await fixture.workspace.list(practiceOwner)).map((session) => session.id)).toContain(
    rated.id,
  );
});
