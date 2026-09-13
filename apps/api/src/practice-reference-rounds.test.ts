import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, expect, it } from "vitest";
import {
  fixture as setupFixture,
  referenceResult,
  requestFor,
} from "./test-support/practice-reference-fixture.js";
import {
  practiceOwner,
  practiceItemId,
  practiceVersions,
} from "./test-support/practice-teaching-fixture.js";
import { createPostgresLearningItemDelete } from "./postgres-learning-item-delete.js";

import { createPracticeTeachingFixture } from "./test-support/practice-teaching-fixture.js";
let base: Awaited<ReturnType<typeof createPracticeTeachingFixture>>;
beforeEach(async () => {
  base = await createPracticeTeachingFixture();
});
const fixture = (options?: Parameters<typeof setupFixture>[0]) => setupFixture(options, base);

let f: Awaited<ReturnType<typeof fixture>> | undefined;
afterEach(async () => {
  await base.db.close();
  f = undefined;
});

it("reveal fences a stale answer and old reveal cannot mark the rewritten round viewed", async () => {
  f = await fixture();
  const session = await f.begin();
  await f.reference.generate(practiceOwner, session.id, requestFor(session), randomUUID());
  const input = requestFor(session),
    key = randomUUID();
  const viewed = await f.reference.reveal(practiceOwner, session.id, input, key);
  await expect(f.submit(session)).rejects.toMatchObject({ code: "revision_conflict" });
  let saved = await f.workspace.get(practiceOwner, session.id);
  saved = await f.complete(saved);
  const next = await f.teaching.act(
    practiceOwner,
    session.id,
    { action: "rewrite", ...practiceVersions(saved) },
    randomUUID(),
  );
  expect(next.teaching?.attempts[0]?.hintViewedAt).toBe(viewed.viewedAt);
  expect(await f.reference.get(practiceOwner, session.id)).toMatchObject({
    ready: true,
    reference: null,
    viewedAt: null,
    ordinal: 1,
  });
  await expect(
    f.reference.reveal(practiceOwner, session.id, input, randomUUID()),
  ).rejects.toMatchObject({ code: "revision_conflict" });
  expect(await f.reference.reveal(practiceOwner, session.id, input, key)).toMatchObject({
    reference: null,
    viewedAt: null,
    ordinal: 1,
  });
  const calls = f.providerCommands.length;
  await f.reference.generate(practiceOwner, session.id, requestFor(next.session, 1), randomUUID());
  expect(f.providerCommands).toHaveLength(calls);
  const nextView = await f.reference.reveal(
    practiceOwner,
    session.id,
    requestFor(next.session, 1),
    randomUUID(),
  );
  expect(nextView.reference).toEqual(referenceResult);
});

it("an answer saved before reveal does not acquire a late hint-view fact", async () => {
  f = await fixture();
  const session = await f.begin();
  await f.reference.generate(practiceOwner, session.id, requestFor(session), randomUUID());
  await f.submit(session);
  await expect(
    f.reference.reveal(practiceOwner, session.id, requestFor(session), randomUUID()),
  ).rejects.toMatchObject({ code: "revision_conflict" });
  const detail = await f.teaching.get(practiceOwner, session.id);
  expect(detail.teaching?.round.hintViewedAt).toBeNull();
  expect(detail.teaching?.attempts[0]?.hintViewedAt).toBeNull();
});

it.each(["prompt", "free"])(
  "changing %s erases the reference identity and permits only a fresh reference",
  async (change) => {
    f = await fixture();
    let session = await f.begin();
    await f.reference.generate(practiceOwner, session.id, requestFor(session), randomUUID());
    await f.reference.reveal(practiceOwner, session.id, requestFor(session), randomUUID());
    session = await f.workspace.get(practiceOwner, session.id);
    if (change === "free")
      session = await f.workspace.control(
        practiceOwner,
        session.id,
        { action: "free", ...practiceVersions(session) },
        randomUUID(),
      );
    else {
      await f.db.query(
        "UPDATE practice_sessions SET prompt='向经理说明完成这项工作至少需要两周。',revision=revision+1 WHERE id=$1",
        [session.id],
      );
      session = await f.workspace.get(practiceOwner, session.id);
    }
    expect(
      (await f.db.query("SELECT reference_state FROM practice_sessions WHERE id=$1", [session.id]))
        .rows,
    ).toEqual([{ reference_state: null }]);
    expect(await f.reference.get(practiceOwner, session.id)).toMatchObject({
      ready: false,
      reference: null,
      viewedAt: null,
    });
    await f.reference.generate(practiceOwner, session.id, requestFor(session), randomUUID());
    expect(f.providerCommands).toHaveLength(2);
  },
);

it("learning-item erasure removes reference/target copies and old reveal replay cannot resurrect them", async () => {
  f = await fixture();
  let session = await f.begin();
  const input = requestFor(session),
    key = randomUUID();
  await f.reference.generate(practiceOwner, session.id, input, randomUUID());
  await f.reference.reveal(practiceOwner, session.id, input, key);
  session = await f.complete(await f.workspace.get(practiceOwner, session.id));
  await f.repository.rate({
    ownerUserId: practiceOwner,
    sessionId: session.id,
    idempotencyKey: randomUUID(),
    requestHash: "b".repeat(64),
    now: new Date().toISOString(),
    input: {
      expectedRevision: session.revision,
      ratings: [{ itemId: practiceItemId, rating: "mastered" }],
    },
  });
  await f.db.query("UPDATE learning_items SET archived_at=now() WHERE id=$1", [practiceItemId]);
  await createPostgresLearningItemDelete(f.database)({
    ownerUserId: practiceOwner,
    id: practiceItemId,
    expectedRevision: 1,
    idempotencyKey: randomUUID(),
    requestHash: "c".repeat(64),
    now: new Date().toISOString(),
  });
  expect(
    (await f.db.query("SELECT reference_state FROM practice_sessions WHERE id=$1", [session.id]))
      .rows,
  ).toEqual([{ reference_state: null }]);
  expect(await f.reference.get(practiceOwner, session.id)).toMatchObject({
    ready: false,
    reference: null,
    availability: "target-unavailable",
  });
  expect(await f.reference.reveal(practiceOwner, session.id, input, key)).toMatchObject({
    ready: false,
    reference: null,
    availability: "target-unavailable",
  });
  await expect(
    f.reference.generate(practiceOwner, session.id, input, randomUUID()),
  ).rejects.toMatchObject({ code: "not_found" });
  expect(
    JSON.stringify(
      (
        await f.db.query(
          "SELECT response FROM idempotency_records WHERE operation LIKE 'practice.reference%'",
        )
      ).rows,
    ),
  ).not.toContain(referenceResult.sentence);
  expect(
    JSON.stringify((await f.db.query("SELECT output FROM practice_generation_tasks")).rows),
  ).not.toContain(referenceResult.sentence);
});

it("billed invalid target-only output fails validation and settles once", async () => {
  f = await fixture({
    output: { kind: "sentence-reference", ...referenceResult, sentence: "at least" },
  });
  const session = await f.begin();
  const task = await f.tasks.submit(practiceOwner, randomUUID(), {
    version: 2,
    kind: "sentence-reference",
    sessionId: session.id,
    input: requestFor(session),
  });
  expect(await f.worker.runOne()).toMatchObject({ state: "failed" });
  expect(await f.tasks.get(practiceOwner, task.id)).toMatchObject({
    error: { code: "model_output_invalid" },
  });
  expect(await f.reference.get(practiceOwner, session.id)).toMatchObject({
    ready: false,
    reference: null,
  });
  const charges = await f.charges();
  expect(charges.ledger).toEqual([
    expect.objectContaining({ outcome: "failed", cost_micro_usd: 10 }),
  ]);
  expect(charges.reservations).toEqual([expect.objectContaining({ status: "settled" })]);
});
