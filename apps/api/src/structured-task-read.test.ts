import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createLearningTaskClient,
  createLearningTaskSseDecoder,
  learningTaskEventsReadResponseSchema,
  learningTaskSnapshotReadSchema,
  learningTaskPayloadReadSchema,
  learningTaskRoutes,
  structuredTeachingAccept,
} from "@huayi/cloud-contracts";
import { createPostgresLearningTasks } from "./postgres-learning-tasks.js";
import { createPgliteAnalysisDatabase } from "./test-support/postgres-analysis-database.js";
import { createLearningTaskWorker } from "./learning-task-worker.js";
import { createLearningTaskApp } from "./learning-task-app.js";
import { structuredAnalysisFixture } from "./test-support/structured-analysis-fixture.js";
import { FakeAnalysisQuota } from "./test-support/analysis-fakes.js";
import { CloudFault } from "./cloud-fault.js";
import { errorStatus } from "./cloud-foundation-app.js";

const owner = "00000000-0000-0000-0000-000000000001";
const command = {
  version: 2 as const,
  kind: "analysis" as const,
  input: {
    selectionKind: "sentence" as const,
    source: { type: "manual" as const },
    sourceText: "We can.",
  },
};
let database: PGlite;
beforeAll(async () => {
  database = new PGlite();
  for (const file of ["0001-cloud-v1-foundation.sql", "0024-durable-learning-tasks.sql"])
    await database.exec(await readFile(new URL(`../migrations/${file}`, import.meta.url), "utf8"));
  await database.query(
    "INSERT INTO user_profiles(user_id,owner_user_id,email,status,timezone,daily_goal) VALUES($1,$1,'test@example.test','active','UTC',5)",
    [owner],
  );
});
afterAll(async () => database.close());

describe("structured task persistence and recovery", () => {
  it("retains native output and events, then projects every old HTTP path without cursor gaps", async () => {
    const store = createPostgresLearningTasks(createPgliteAnalysisDatabase(database));
    const task = await store.submit(owner, "native", command);
    const analysis = structuredAnalysisFixture();
    if (analysis.result.type !== "sentence-passage-analysis-v3")
      throw new Error("Expected sentence");
    const sentence = analysis.result.sentences[0];
    if (!sentence) throw new Error("Expected sentence");
    const { analysisUnitId, ordinal, sourceText, sentenceStructure } = sentence;
    const payloads = [
      { type: "analysis.started", requestId: "request-1", unitCount: 1 },
      {
        type: "analysis.structure",
        requestId: "request-1",
        unit: { analysisUnitId, ordinal, sourceText, sentenceStructure },
      },
      { type: "analysis.completed", analysis, quota: new FakeAnalysisQuota().summary() },
    ].map((value) => learningTaskPayloadReadSchema.parse(value));
    let calls = 0;
    const worker = createLearningTaskWorker({
      store,
      execute: async function* () {
        calls += 1;
        yield* payloads;
      },
    });
    expect(await worker.runOne()).toMatchObject({ state: "completed" });
    expect(await worker.runOne()).toEqual({ claimed: false });
    expect((await store.get(owner, task.id))?.output).toEqual(payloads[2]);
    expect((await store.events(owner, task.id, 0)).map((event) => event.payload)).toEqual(payloads);
    const app = createLearningTaskApp({
      store,
      cronSecret: "x".repeat(32),
      runWorker: () => worker.runOne(),
      authenticate: async (context) => ({
        kind: context.req.header("x-test-kind") === "extension" ? "extension" : "web",
        userId: context.req.header("x-test-owner") ?? owner,
      }),
    });
    app.onError((error, context) =>
      context.json(
        { error: "rejected" },
        error instanceof CloudFault ? errorStatus(error.code) : 400,
      ),
    );
    const client = createLearningTaskClient({
      request: async (path, init) => app.request(path, init),
    });
    for (const old of [
      await client.get(task.id),
      await client.cancel(task.id),
      await client.submit(command, "native"),
      ...(await client.list()),
    ])
      expect(old.output).toMatchObject({
        type: "analysis.completed",
        analysis: { result: { type: "sentence-passage-analysis-v2" } },
      });
    expect((await client.get(task.id)).id).toBe(task.id);
    const watched = [];
    for await (const payload of client.watch(task.id)) watched.push(payload);
    expect(watched.map((payload) => payload.type)).toEqual([
      "analysis.started",
      "analysis.preview",
      "analysis.completed",
    ]);
    const detail = learningTaskRoutes.detail.replace(":id", task.id);
    const native = learningTaskSnapshotReadSchema.parse(
      await (
        await app.request(detail, { headers: { Accept: structuredTeachingAccept.json } })
      ).json(),
    );
    expect(native.output).toEqual(payloads[2]);
    const page = learningTaskEventsReadResponseSchema.parse(
      await (
        await app.request(`${detail}/events?cursor=1`, {
          headers: { Accept: structuredTeachingAccept.json },
        })
      ).json(),
    );
    expect(page.events.map((event) => [event.cursor, event.payload.type])).toEqual([
      [2, "analysis.structure"],
      [3, "analysis.completed"],
    ]);
    const response = await app.request(`${detail}/events?cursor=1`, {
      headers: { Accept: "text/event-stream" },
    });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("vary")).toContain("Accept");
    const decoder = createLearningTaskSseDecoder(task.id, 1);
    expect(decoder.push(await response.text())).toHaveLength(3);
    decoder.finish();
    expect(decoder.cursor).toBe(3);
    for (const headers of [
      { "x-test-owner": "00000000-0000-0000-0000-000000000002" },
      { "x-test-kind": "extension" },
    ])
      expect((await app.request(detail, { headers })).status).toBe(404);
    const accepted = await app.request(learningTaskRoutes.submit, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": "unsupported" },
      body: JSON.stringify({
        ...command,
        input: { ...command.input, outputContract: "structured-teaching-v1" },
      }),
    });
    expect(accepted.status).toBe(202);
    expect(calls).toBe(1);
  });
});
