import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createPgliteAnalysisDatabase } from "./test-support/postgres-analysis-database.js";
import { createPostgresLearningTasks } from "./postgres-learning-tasks.js";
import type { LearningTaskCommand } from "@huayi/cloud-contracts";

const owner = "00000000-0000-0000-0000-00000000000a";
const other = "00000000-0000-0000-0000-00000000000b";
let database: PGlite;
let store: ReturnType<typeof createPostgresLearningTasks>;
const command: LearningTaskCommand = {
  version: 2,
  kind: "analysis",
  input: { selectionKind: "sentence", source: { type: "manual" }, sourceText: "This works." },
};
beforeAll(async () => {
  database = new PGlite();
  await database.exec(
    await readFile(new URL("../migrations/0001-cloud-v1-foundation.sql", import.meta.url), "utf8"),
  );
  const migration = await readFile(
    new URL("../migrations/0024-durable-learning-tasks.sql", import.meta.url),
    "utf8",
  );
  expect(
    await readFile(
      new URL(
        "../../../supabase/migrations/20260905010000_durable_learning_tasks.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  ).toBe(migration);
  await database.exec(migration);
  await database.query(
    "INSERT INTO user_profiles(user_id,owner_user_id,email,status,timezone,daily_goal) VALUES($1,$1,'a@example.test','active','UTC',5),($2,$2,'b@example.test','active','UTC',5)",
    [owner, other],
  );
  store = createPostgresLearningTasks(createPgliteAnalysisDatabase(database));
});
afterAll(async () => database?.close());

it("durably deduplicates submission, separates owners, prioritizes interactive jobs, and fences duplicate deliveries", async () => {
  const deep = await store.submit(owner, "deep-one", command);
  expect((await store.submit(owner, "deep-one", command)).id).toBe(deep.id);
  expect((await store.submit(owner, "same-input-new-click", command)).id).toBe(deep.id);
  await expect(
    store.submit(owner, "deep-one", {
      ...command,
      input: { ...command.input, sourceText: "Changed." },
    }),
  ).rejects.toMatchObject({ code: "idempotency_conflict" });
  expect(await store.get(other, deep.id)).toBeNull();
  expect(await store.cancel(other, deep.id)).toBeNull();
  const instant = await store.submit(owner, "instant-one", {
    version: 2,
    kind: "instant-query",
    input: {
      action: "translate",
      selectionKind: "sentence",
      sourceText: "This works.",
      sourceType: "web-selection",
    },
  });
  const first = await store.claim();
  expect(first?.id).toBe(instant.id);
  expect(await store.claim()).toBeNull();
  if (!first) throw new Error("missing lease");
  expect(await store.touch(first, true)).toBe("running");
  await store.finish(first, "completed", null, null);
  await expect(store.finish(first, "completed", null, null)).rejects.toThrow("task lease lost");
  expect((await store.cancel(owner, deep.id))?.state).toBe("cancelled");
  expect((await store.submit(owner, "same-input-new-click", command)).id).toBe(deep.id);
  expect(await store.claim()).toBeNull();
});

it("cancels queued work immediately and never redispatches a crashed provider call", async () => {
  const job = await store.submit(other, "crash", command);
  const lease = await store.claim();
  expect(lease?.id).toBe(job.id);
  if (!lease) throw new Error("missing lease");
  await store.touch(lease, true);
  await database.query(
    "UPDATE learning_tasks SET lease_expires_at=now()-interval '1 second' WHERE id=$1",
    [job.id],
  );
  expect(await store.claim()).toBeNull();
  expect((await store.get(other, job.id))?.state).toBe("unknown");
  expect(await store.touch(lease, true)).toBe("lost");
});

it("stores cursor ordered events under the lease and rejects business role mutation", async () => {
  const task = await store.submit(owner, "events", command);
  const lease = await store.claim();
  if (!lease) throw new Error("missing lease");
  const payload = {
    type: "analysis.started" as const,
    requestId: crypto.randomUUID(),
    unitCount: 1,
  };
  await store.append(lease, [payload], { "provider-first-token": 25 });
  expect(await store.events(other, task.id, 0)).toEqual([]);
  expect(await store.events(owner, task.id, 0)).toEqual([
    { version: 2, taskId: task.id, cursor: 1, payload },
  ]);
  expect(await store.events(owner, task.id, 1)).toEqual([]);
  await expect(
    database.transaction(async (tx) => {
      await tx.exec("SET LOCAL ROLE huayi_business");
      await tx.exec("UPDATE learning_tasks SET state='completed'");
    }),
  ).rejects.toThrow(/permission denied/);
  expect((await store.cancel(owner, task.id))?.state).toBe("cancelling");
  expect(await store.touch(lease, true)).toBe("cancelling");
  await store.finish(lease, "cancelled", null, { code: "cancelled", diagnosticId: task.id });
});

it("retains a text-free idempotency tombstone after a query result expires", async () => {
  const input: LearningTaskCommand = {
    version: 2,
    kind: "instant-query",
    input: {
      action: "translate",
      selectionKind: "sentence",
      sourceText: "This result expires.",
      sourceType: "web-selection",
    },
  };
  const task = await store.submit(owner, "expiring-query", input);
  const lease = await store.claim();
  if (!lease) throw new Error("Missing lease");
  await store.finish(lease, "completed", null, null);
  await database.query(
    "UPDATE learning_tasks SET updated_at=now()-interval '31 minutes' WHERE id=$1",
    [task.id],
  );
  expect(await store.claim()).toBeNull();
  expect(await store.get(owner, task.id)).toBeNull();
  await expect(store.submit(owner, "expiring-query", input)).rejects.toMatchObject({
    code: "not_found",
  });
  expect(await store.claim()).toBeNull();
});

it("redacts an unknown query within the existing one-hour text retention boundary", async () => {
  const task = await store.submit(owner, "unknown-query-retention", {
    version: 2,
    kind: "instant-query",
    input: {
      action: "translate",
      selectionKind: "sentence",
      sourceText: "Private original text.",
      sourceType: "web-selection",
    },
  });
  const lease = await store.claim();
  if (!lease) throw new Error("Missing lease");
  await store.touch(lease, true);
  await store.append(
    lease,
    [
      {
        type: "analysis.preview",
        requestId: task.id,
        section: "overall",
        text: "Private preview.",
      },
    ],
    {},
  );
  await database.query(
    "UPDATE learning_tasks SET created_at=now()-interval '61 minutes',lease_expires_at=now()-interval '1 second' WHERE id=$1",
    [task.id],
  );
  expect(await store.claim()).toBeNull();
  expect((await store.get(owner, task.id))?.state).toBe("unknown");
  expect(await store.events(owner, task.id, 0)).toEqual([]);
  expect(
    (await database.query("SELECT command,output FROM learning_tasks WHERE id=$1", [task.id])).rows,
  ).toEqual([{ command: { version: 2, kind: "instant-query" }, output: null }]);
});
