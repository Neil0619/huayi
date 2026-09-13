import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, expect, it } from "vitest";
import { fixture as setupFixture, requestFor } from "./test-support/practice-reference-fixture.js";
import { practiceOwner, practiceVersions } from "./test-support/practice-teaching-fixture.js";
import { createPostgresPracticeReference } from "./postgres-practice-reference.js";

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

it.each(["claimed", "reserved"] as const)(
  "free-mode switch after interrupted %s reference cannot strand an open generation",
  async (stage) => {
    f = await fixture();
    const session = await f.begin();
    const task = await f.tasks.submit(practiceOwner, randomUUID(), {
      version: 2,
      kind: "sentence-reference",
      sessionId: session.id,
      input: requestFor(session),
    });
    const job = await f.tasks.claim();
    expect(job?.id).toBe(task.id);
    const claim = await createPostgresPracticeReference(f.database).claim(
      practiceOwner,
      session.id,
      requestFor(session),
      task.id,
    );
    if (claim.state !== "claimed") throw new Error("Missing real reference claim");
    if (stage === "reserved") {
      expect(
        await f.generationRepository.acquire({
          ownerUserId: practiceOwner,
          kind: "sentence-reference",
          generationId: claim.generationId,
          leaseToken: claim.leaseToken,
          input: claim.input,
        }),
      ).toMatchObject({ kind: "acquired" });
    }
    const free = await f.workspace.control(
      practiceOwner,
      session.id,
      {
        action: "free",
        ...practiceVersions(session),
      },
      randomUUID(),
    );
    expect(
      (
        await f.db.query("SELECT state FROM practice_generation_tasks WHERE id=$1", [
          claim.generationId,
        ])
      ).rows,
    ).toEqual([{ state: "failed" }]);
    expect(
      (
        await f.db.query("SELECT current_generation_id FROM practice_sessions WHERE id=$1", [
          session.id,
        ])
      ).rows,
    ).toEqual([{ current_generation_id: null }]);
    expect(
      (
        await f.db.query("SELECT status FROM quota_reservations WHERE request_id=$1", [
          claim.generationId,
        ])
      ).rows,
    ).toEqual(stage === "reserved" ? [{ status: "released" }] : []);
    // No provider was dispatched. Simulate expiry after the worker process disappeared.
    await f.db.query(
      "UPDATE learning_tasks SET lease_expires_at=now()-interval '1 minute' WHERE id=$1",
      [task.id],
    );
    await f.db.query(
      "UPDATE practice_generation_tasks SET lease_expires_at=now()-interval '1 minute' WHERE id=$1",
      [claim.generationId],
    );
    await f.db.query(
      "UPDATE quota_reservations SET expires_at=now()-interval '1 minute' WHERE request_id=$1",
      [claim.generationId],
    );
    expect(await f.worker.runOne()).toEqual({ claimed: false });
    expect(await f.tasks.get(practiceOwner, task.id)).toMatchObject({ state: "cancelled" });
    expect(f.providerCommands).toHaveLength(0);
    expect((await f.charges()).ledger).toEqual([]);
    await expect(f.submit(free)).resolves.toMatchObject({ claimed: true });
  },
);

it("ready result after free-mode switch is settled and discarded without restoring an old reference", async () => {
  f = await fixture({ crash: "ready-return" });
  const session = await f.begin();
  const task = await f.tasks.submit(practiceOwner, randomUUID(), {
    version: 2,
    kind: "sentence-reference",
    sessionId: session.id,
    input: requestFor(session),
  });
  expect(await f.worker.runOne()).toMatchObject({ id: task.id, state: "unknown" });
  const free = await f.workspace.control(
    practiceOwner,
    session.id,
    { action: "free", ...practiceVersions(session) },
    randomUUID(),
  );
  const charges = await f.charges();
  await f.recover();
  await f.reconcile();
  expect(await f.tasks.get(practiceOwner, task.id)).toMatchObject({ state: "completed" });
  expect(await f.reference.get(practiceOwner, session.id)).toMatchObject({
    ready: false,
    reference: null,
    viewedAt: null,
  });
  expect((await f.db.query("SELECT state,output FROM practice_generation_tasks")).rows).toEqual([
    { state: "applied", output: null },
  ]);
  expect(await f.charges()).toEqual(charges);
  await expect(f.submit(free)).resolves.toMatchObject({ claimed: true });
});
