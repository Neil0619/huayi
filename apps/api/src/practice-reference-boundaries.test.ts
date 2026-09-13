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
import { createPostgresPracticeReference } from "./postgres-practice-reference.js";
import {
  dailyPracticeQueueItemSchema,
  practiceReferenceResultSchema,
} from "@huayi/cloud-contracts";

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

it("valid large learning content must remain eligible for reference generation", async () => {
  f = await fixture();
  const content = dailyPracticeQueueItemSchema.shape.item.shape.content.parse({
    type: "expression",
    text: "at least",
    meaningZh: "义".repeat(4000),
    usageZh: "用".repeat(4000),
  });
  await f.db.query("UPDATE learning_items SET content=$2::jsonb WHERE id=$1", [
    practiceItemId,
    JSON.stringify(content),
  ]);
  const session = await f.begin();
  const task = await f.tasks.submit(practiceOwner, randomUUID(), {
    version: 2,
    kind: "sentence-reference",
    sessionId: session.id,
    input: requestFor(session),
  });
  const result = await f.worker.runOne();
  expect(result).toMatchObject({ id: task.id, state: "completed" });
  expect(f.providerCommands).toHaveLength(1);
});

it("valid input plus valid large result must not strand an already-paid ready reference", async () => {
  const result = practiceReferenceResultSchema.parse({
    ...referenceResult,
    translationZh: "译".repeat(1000),
    usageNoteZh: "用".repeat(500),
  });
  f = await fixture({ output: { kind: "sentence-reference", ...result } });
  const content = dailyPracticeQueueItemSchema.shape.item.shape.content.parse({
    type: "expression",
    text: "at least",
    meaningZh: "义".repeat(2200),
    usageZh: "用".repeat(2200),
  });
  await f.db.query("UPDATE learning_items SET content=$2::jsonb WHERE id=$1", [
    practiceItemId,
    JSON.stringify(content),
  ]);
  const session = await f.begin();
  const task = await f.tasks.submit(practiceOwner, randomUUID(), {
    version: 2,
    kind: "sentence-reference",
    sessionId: session.id,
    input: requestFor(session),
  });
  const run = await f.worker.runOne();
  expect(f.providerCommands).toHaveLength(1);
  expect((await f.charges()).ledger).toHaveLength(1);
  await f.recover();
  await f.reconcile();
  expect({
    run,
    saved: await f.tasks.get(practiceOwner, task.id),
    generation: (await f.db.query("SELECT state FROM practice_generation_tasks")).rows,
  }).toMatchObject({
    run: { state: "completed" },
    saved: { state: "completed" },
    generation: [{ state: "applied" }],
  });
});

it("a live reference claim prevents feedback insertion with a stable generation_busy failure", async () => {
  f = await fixture();
  const session = await f.begin();
  const claim = await createPostgresPracticeReference(f.database).claim(
    practiceOwner,
    session.id,
    requestFor(session),
    randomUUID(),
  );
  expect(claim.state).toBe("claimed");
  await expect(f.submit(session)).rejects.toMatchObject({ code: "generation_busy" });
  expect((await f.db.query("SELECT id FROM practice_attempts")).rows).toEqual([]);
  expect((await f.db.query("SELECT kind FROM practice_generation_tasks")).rows).toEqual([
    { kind: "sentence-reference" },
  ]);
});

it("a queued reference cancelled by free mode never spends or reveals the old prompt", async () => {
  f = await fixture();
  const session = await f.begin();
  const task = await f.tasks.submit(practiceOwner, randomUUID(), {
    version: 2,
    kind: "sentence-reference",
    sessionId: session.id,
    input: requestFor(session),
  });
  await f.workspace.control(
    practiceOwner,
    session.id,
    { action: "free", ...practiceVersions(session) },
    randomUUID(),
  );
  expect(await f.worker.runOne()).toEqual({ claimed: false });
  expect(await f.tasks.get(practiceOwner, task.id)).toMatchObject({ state: "cancelled" });
  expect(f.providerCommands).toHaveLength(0);
  expect(await f.charges()).toEqual({ ledger: [], reservations: [] });
});

it("free session generates from its actual saved free prompt", async () => {
  f = await fixture();
  const session = await f.begin(false);
  await f.reference.generate(practiceOwner, session.id, requestFor(session), randomUUID());
  expect(f.providerCommands).toEqual([
    expect.objectContaining({
      input: expect.objectContaining({ mode: "free", prompt: session.prompt }),
    }),
  ]);
  const revealed = await f.reference.reveal(
    practiceOwner,
    session.id,
    requestFor(session),
    randomUUID(),
  );
  expect(revealed.reference).toEqual(referenceResult);
  expect((await f.teaching.get(practiceOwner, session.id)).teaching?.round.hintViewedAt).toBeNull();
});

it.each([false, true])(
  "legacy target edited=$0 uses only a proven unchanged snapshot and keeps teaching null",
  async (edited) => {
    f = await fixture();
    const session = await f.begin();
    await f.db.query("UPDATE practice_sessions SET teaching_state=NULL WHERE id=$1", [session.id]);
    await f.db.query("UPDATE learning_items SET updated_at=$2::timestamptz WHERE id=$1", [
      practiceItemId,
      new Date(Date.parse(session.createdAt) + (edited ? 10000 : -10000)).toISOString(),
    ]);
    if (edited) {
      expect(await f.reference.get(practiceOwner, session.id)).toMatchObject({
        availability: "target-unavailable",
      });
      await expect(
        f.reference.generate(practiceOwner, session.id, requestFor(session), randomUUID()),
      ).rejects.toMatchObject({ code: "revision_conflict" });
      expect(f.providerCommands).toHaveLength(0);
    } else {
      await f.reference.generate(practiceOwner, session.id, requestFor(session), randomUUID());
      expect(
        await f.reference.reveal(practiceOwner, session.id, requestFor(session), randomUUID()),
      ).toMatchObject({ reference: referenceResult });
      expect((await f.teaching.get(practiceOwner, session.id)).teaching).toBeNull();
    }
  },
);

it("saved provider failure retry with the same key preserves its error and never redispatches", async () => {
  f = await fixture({
    output: { kind: "sentence-reference", ...referenceResult, sentence: "at least" },
  });
  const session = await f.begin(),
    key = randomUUID(),
    input = requestFor(session);
  await expect(f.reference.generate(practiceOwner, session.id, input, key)).rejects.toMatchObject({
    code: "model_output_invalid",
  });
  await expect(f.reference.generate(practiceOwner, session.id, input, key)).rejects.toMatchObject({
    code: "model_output_invalid",
  });
  expect(f.providerCommands).toHaveLength(1);
});
