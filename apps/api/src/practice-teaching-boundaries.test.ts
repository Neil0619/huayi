import { afterEach, beforeEach, expect, it } from "vitest";
import { createPostgresLearningItemDelete } from "./postgres-learning-item-delete.js";
import {
  createPracticeTeachingFixture,
  practiceItemId,
  practiceOwner,
  practiceVersions,
} from "./test-support/practice-teaching-fixture.js";

let fixture: Awaited<ReturnType<typeof createPracticeTeachingFixture>>;
beforeEach(async () => {
  fixture = await createPracticeTeachingFixture();
});
afterEach(async () => fixture?.db.close());

it("does not replace a newer draft and requires resume before rewriting a paused session", async () => {
  const completed = await fixture.complete(await fixture.begin());
  await fixture.workspace.draft(practiceOwner, completed.id, {
    draft: "A newer draft.",
    expectedDraftRevision: 0,
  });
  await expect(
    fixture.teaching.act(
      practiceOwner,
      completed.id,
      { action: "rewrite", ...practiceVersions(completed) },
      "stale",
    ),
  ).rejects.toMatchObject({ code: "revision_conflict" });
  const paused = await fixture.workspace.control(
    practiceOwner,
    completed.id,
    { action: "pause", expectedRevision: completed.revision },
    "pause",
  );
  await expect(
    fixture.teaching.act(
      practiceOwner,
      completed.id,
      { action: "rewrite", ...practiceVersions(paused) },
      "paused",
    ),
  ).rejects.toMatchObject({ code: "revision_conflict" });
  expect((await fixture.workspace.get(practiceOwner, completed.id)).workspace?.draft).toBe(
    "A newer draft.",
  );
  const other = await fixture.workspace.start(
    practiceOwner,
    { itemId: practiceItemId, mode: "free" },
    "other",
  );
  await expect(
    fixture.workspace.control(
      practiceOwner,
      completed.id,
      { action: "resume", ...practiceVersions(paused) },
      "busy",
    ),
  ).rejects.toMatchObject({ code: "generation_busy" });
  expect(other.id).not.toBe(completed.id);
});

it("closes on-demand hints after switching to free and keeps the earlier view fact", async () => {
  const session = await fixture.begin();
  const hint = await fixture.teaching.act(
    practiceOwner,
    session.id,
    {
      action: "reveal-hint",
      expectedRevision: session.revision,
      expectedControlRevision: 0,
      ordinal: 0,
    },
    "hint",
  );
  const free = await fixture.workspace.control(
    practiceOwner,
    session.id,
    { action: "free", ...practiceVersions(hint.session) },
    "free",
  );
  await expect(
    fixture.teaching.act(
      practiceOwner,
      session.id,
      {
        action: "reveal-hint",
        expectedRevision: free.revision,
        expectedControlRevision: free.workspace?.controlRevision,
        ordinal: 0,
      },
      "free-hint",
    ),
  ).rejects.toMatchObject({ code: "revision_conflict" });
  expect((await fixture.teaching.get(practiceOwner, session.id)).teaching?.round.hintViewedAt).toBe(
    hint.teaching?.round.hintViewedAt,
  );
});

it("keeps the free fallback prompt on the captured target when the library item changes", async () => {
  const session = await fixture.begin();
  await fixture.db.query(
    "UPDATE learning_items SET canonical_key='as a result',content=$2::jsonb WHERE id=$1",
    [
      practiceItemId,
      JSON.stringify({
        type: "expression",
        text: "as a result",
        meaningZh: "因此",
        usageZh: "说明结果。",
      }),
    ],
  );
  const free = await fixture.workspace.control(
    practiceOwner,
    session.id,
    { action: "free", ...practiceVersions(session) },
    "pinned-free",
  );
  expect(free.prompt).toContain("at least（至少）");
  expect(free.prompt).not.toContain("as a result");
  expect((await fixture.teaching.get(practiceOwner, session.id)).teaching?.target).toMatchObject({
    content: { text: "at least" },
  });
});

it("resets only the new round's hint and refuses new-key action input under an old key", async () => {
  const session = await fixture.begin();
  const hintInput = {
    action: "reveal-hint",
    expectedRevision: session.revision,
    expectedControlRevision: 0,
    ordinal: 0,
  };
  const hint = await fixture.teaching.act(practiceOwner, session.id, hintInput, "hint");
  const completed = await fixture.complete(hint.session);
  await expect(
    fixture.teaching.act(
      practiceOwner,
      session.id,
      { action: "rewrite", ...practiceVersions(completed) },
      "hint",
    ),
  ).rejects.toMatchObject({ code: "idempotency_conflict" });
  const next = await fixture.teaching.act(
    practiceOwner,
    session.id,
    { action: "rewrite", ...practiceVersions(completed) },
    "rewrite",
  );
  expect(next.teaching?.round.hintViewedAt).toBeNull();
  expect(next.teaching?.attempts[0]?.hintViewedAt).toBe(hint.teaching?.round.hintViewedAt);
  const replay = await fixture.teaching.act(practiceOwner, session.id, hintInput, "hint");
  expect(replay).toEqual(next);
});

it("erases the target copy, advances its revision and keeps old hint-key replay free of target text", async () => {
  const session = await fixture.begin();
  const input = {
    action: "reveal-hint",
    expectedRevision: session.revision,
    expectedControlRevision: 0,
    ordinal: 0,
  };
  const hint = await fixture.teaching.act(practiceOwner, session.id, input, "hint");
  const completed = await fixture.complete(hint.session);
  const rated = await fixture.repository.rate({
    ownerUserId: practiceOwner,
    sessionId: session.id,
    idempotencyKey: "rate",
    requestHash: "b".repeat(64),
    now: new Date().toISOString(),
    input: {
      expectedRevision: completed.revision,
      ratings: [{ itemId: practiceItemId, rating: "mastered" }],
    },
  });
  await fixture.db.query("UPDATE learning_items SET archived_at=now() WHERE id=$1", [
    practiceItemId,
  ]);
  await expect(
    fixture.teaching.act(
      practiceOwner,
      session.id,
      { action: "rewrite", ...practiceVersions(rated) },
      "archived",
    ),
  ).rejects.toMatchObject({ code: "learning_item_archived" });
  const now = new Date().toISOString();
  await createPostgresLearningItemDelete(fixture.database)({
    ownerUserId: practiceOwner,
    id: practiceItemId,
    expectedRevision: 1,
    idempotencyKey: "erase",
    requestHash: "c".repeat(64),
    now,
  });
  const erased = await fixture.teaching.get(practiceOwner, session.id);
  expect(erased.session.revision).toBeGreaterThan(rated.revision);
  expect(erased.teaching?.target).toMatchObject({
    state: "deleted",
    itemId: practiceItemId,
    deletedAt: now,
  });
  expect(erased.teaching?.target).not.toHaveProperty("content");
  expect(erased.session.attempts).toEqual(rated.attempts);
  expect(await fixture.teaching.act(practiceOwner, session.id, input, "hint")).toEqual(erased);
  expect(
    (
      await fixture.db.query(
        "SELECT response FROM idempotency_records WHERE operation='practice.teaching' AND key='hint'",
      )
    ).rows,
  ).toEqual([{ response: { sessionId: session.id } }]);
});
