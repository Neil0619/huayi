import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, expect, it } from "vitest";
import {
  fixture as setupFixture,
  referenceResult,
  requestFor,
  type Crash,
} from "./test-support/practice-reference-fixture.js";
import { practiceOwner, practiceOther } from "./test-support/practice-teaching-fixture.js";

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

it("HTTP durable submission -> paid worker -> hidden GET -> explicit reveal, with no answer/preview leaks", async () => {
  f = await fixture();
  let session = await f.begin();
  session = await f.workspace.draft(practiceOwner, session.id, {
    draft: "Private unfinished draft",
    expectedDraftRevision: 0,
  });
  const schedule = (await f.db.query("SELECT * FROM schedule_states")).rows;
  const command = {
    version: 2,
    kind: "sentence-reference",
    sessionId: session.id,
    input: requestFor(session),
  };
  const submitted = await f.taskApp.request("/v2/learning-tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json", "idempotency-key": randomUUID() },
    body: JSON.stringify(command),
  });
  expect(submitted.status).toBe(202);
  const task = (await submitted.json()) as { id: string; state: string };
  expect(task.state).toBe("queued");
  expect(f.providerCommands).toHaveLength(0);
  expect(await f.worker.runOne()).toMatchObject({ id: task.id, state: "completed" });
  const hidden = await f.referenceApp.request(`/v2/practice/sessions/${session.id}/reference`);
  expect(hidden.headers.get("cache-control")).toContain("no-store");
  expect(await hidden.json()).toMatchObject({
    ready: true,
    reference: null,
    viewedAt: null,
    ordinal: 0,
  });
  const taskRead = await f.tasks.get(practiceOwner, task.id);
  const events = await f.tasks.events(practiceOwner, task.id, 0);
  expect(JSON.stringify([taskRead, events])).not.toContain(referenceResult.sentence);
  expect(events.map((event) => event.payload.type)).toEqual(["practice.updated"]);
  expect(f.providerCommands).toEqual([
    {
      kind: "sentence-reference",
      hasPreview: false,
      input: {
        itemContent: {
          type: "expression",
          text: "at least",
          meaningZh: "至少",
          usageZh: "说明最小数量。",
        },
        mode: "guided",
        prompt: session.prompt,
      },
    },
  ]);
  expect(JSON.stringify(f.providerCommands)).not.toContain("Private unfinished draft");
  const reveal = await f.referenceApp.request(
    `/v2/practice/sessions/${session.id}/reference/reveal`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "idempotency-key": randomUUID() },
      body: JSON.stringify(requestFor(session)),
    },
  );
  expect(reveal.status).toBe(200);
  expect(await reveal.json()).toMatchObject({
    ready: true,
    reference: referenceResult,
    revision: session.revision + 1,
    controlRevision: 1,
  });
  const saved = await f.workspace.get(practiceOwner, session.id);
  expect(saved.workspace?.draft).toBe("Private unfinished draft");
  expect(saved.attempts ?? []).toEqual([]);
  expect((await f.db.query("SELECT * FROM schedule_states")).rows).toEqual(schedule);
  const charges = await f.charges();
  expect(charges.ledger).toEqual([
    expect.objectContaining({
      feature: "practice.sentence-reference",
      outcome: "succeeded",
      cost_micro_usd: 10,
    }),
  ]);
  expect(charges.reservations).toEqual([
    expect.objectContaining({ status: "settled", reserved_micro_usd: 100 }),
  ]);
  expect(await f.quota.summary(practiceOwner)).toMatchObject({
    usedMicroUsd: 10,
    reservedMicroUsd: 0,
    availableMicroUsd: 990,
  });
});

it("same/different submission keys converge while queued and reuse completed result without another reservation", async () => {
  f = await fixture();
  const session = await f.begin();
  const key = randomUUID(),
    input = requestFor(session);
  const command = {
    version: 2 as const,
    kind: "sentence-reference" as const,
    sessionId: session.id,
    input,
  };
  const a = await f.tasks.submit(practiceOwner, key, command);
  expect((await f.tasks.submit(practiceOwner, key, command)).id).toBe(a.id);
  expect((await f.tasks.submit(practiceOwner, randomUUID(), command)).id).toBe(a.id);
  await expect(
    f.tasks.submit(practiceOwner, key, {
      ...command,
      input: { ...input, expectedRevision: input.expectedRevision + 1 },
    }),
  ).rejects.toMatchObject({ code: "idempotency_conflict" });
  expect(await f.worker.runOne()).toMatchObject({ state: "completed" });
  const charges = await f.charges();
  const b = await f.tasks.submit(practiceOwner, randomUUID(), command);
  expect(b.id).not.toBe(a.id);
  expect(await f.worker.runOne()).toMatchObject({ id: b.id, state: "completed" });
  expect(f.providerCommands).toHaveLength(1);
  expect(await f.charges()).toEqual(charges);
});

it("owner scope blocks foreign reference reads, reveals, durable execution and receipts", async () => {
  f = await fixture();
  const session = await f.begin();
  await expect(f.reference.get(practiceOther, session.id)).rejects.toMatchObject({
    code: "not_found",
  });
  await expect(
    f.reference.reveal(practiceOther, session.id, requestFor(session), randomUUID()),
  ).rejects.toMatchObject({ code: "not_found" });
  const foreign = await f.tasks.submit(practiceOther, randomUUID(), {
    version: 2,
    kind: "sentence-reference",
    sessionId: session.id,
    input: requestFor(session),
  });
  expect(await f.worker.runOne()).toMatchObject({ id: foreign.id, state: "failed" });
  expect(await f.tasks.get(practiceOther, foreign.id)).toMatchObject({
    error: { code: "not_found" },
  });
  expect(await f.tasks.get(practiceOwner, foreign.id)).toBeNull();
  expect(f.providerCommands).toHaveLength(0);
  expect(await f.charges()).toEqual({ ledger: [], reservations: [] });
});

it.each([
  { killed: true, error: "model_unavailable" },
  { quota: 50, error: "quota_exhausted" },
])("quota/kill switch fails before provider ($error)", async (options) => {
  f = await fixture(options);
  const session = await f.begin();
  const task = await f.tasks.submit(practiceOwner, randomUUID(), {
    version: 2,
    kind: "sentence-reference",
    sessionId: session.id,
    input: requestFor(session),
  });
  expect(await f.worker.runOne()).toMatchObject({ id: task.id, state: "failed" });
  expect(await f.tasks.get(practiceOwner, task.id)).toMatchObject({
    error: { code: options.error },
  });
  expect(f.providerCommands).toHaveLength(0);
  expect(await f.charges()).toEqual({ ledger: [], reservations: [] });
  expect(await f.reference.get(practiceOwner, session.id)).toMatchObject({
    ready: false,
    reference: null,
  });
});

it.each(["ready-return", "apply-before", "apply-return"] as Crash[])(
  "actual SQL recovery after %s preserves the paid output and never redispatches",
  async (crash) => {
    f = await fixture({ crash });
    const session = await f.begin();
    const task = await f.tasks.submit(practiceOwner, randomUUID(), {
      version: 2,
      kind: "sentence-reference",
      sessionId: session.id,
      input: requestFor(session),
    });
    expect(await f.worker.runOne()).toMatchObject({ id: task.id, state: "unknown" });
    expect((await f.db.query("SELECT state FROM practice_generation_tasks")).rows).toEqual([
      { state: crash === "apply-return" ? "applied" : "ready" },
    ]);
    const charges = await f.charges();
    expect(charges.ledger).toHaveLength(1);
    f.disarm();
    await f.recover();
    await f.reconcile();
    await f.recover();
    await f.reconcile();
    expect(await f.worker.runOne()).toEqual({ claimed: false });
    expect(await f.tasks.get(practiceOwner, task.id)).toMatchObject({
      state: "completed",
      output: { type: "practice.updated", session: { id: session.id } },
    });
    expect(await f.reference.get(practiceOwner, session.id)).toMatchObject({
      ready: true,
      reference: null,
      viewedAt: null,
    });
    expect(
      await f.reference.reveal(practiceOwner, session.id, requestFor(session), randomUUID()),
    ).toMatchObject({ reference: referenceResult });
    expect(await f.charges()).toEqual(charges);
    expect(f.providerCommands).toHaveLength(1);
    expect((await f.db.query("SELECT state,output FROM practice_generation_tasks")).rows).toEqual([
      { state: "applied", output: null },
    ]);
  },
);
