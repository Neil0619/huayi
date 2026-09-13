import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  learningTaskRoutes,
  structuredTeachingAccept,
  learningTaskSnapshotReadSchema,
} from "@huayi/cloud-contracts";
import { createPostgresLearningTasks } from "./postgres-learning-tasks.js";
import { createLearningTaskApp } from "./learning-task-app.js";
import { createLearningTaskWorker } from "./learning-task-worker.js";
import { createLearningTaskExecutor } from "./learning-task-executor.js";
import { createCurrentDatabaseFixture } from "./test-support/current-database-fixture.js";
import { createPgliteAnalysisDatabase } from "./test-support/postgres-analysis-database.js";
import { analysisModuleFixture } from "./test-support/analysis-module-fixture.js";
import { structuredAnalysisFixture } from "./test-support/structured-analysis-fixture.js";
import { CloudFault } from "./cloud-fault.js";
import { errorStatus } from "./cloud-foundation-app.js";

const owner = "10000000-0000-4000-8000-000000000001";
let database: PGlite;
beforeAll(async () => {
  database = await createCurrentDatabaseFixture();
  await database.query(
    "INSERT INTO user_profiles(user_id,owner_user_id,email,status,timezone,daily_goal) VALUES($1,$1,'test@example.test','active','UTC',5)",
    [owner],
  );
});
afterAll(async () => database.close());

function executor(analysis: ReturnType<typeof analysisModuleFixture>["module"]) {
  const unexpected = async () => {
    throw new Error("Unexpected task operation");
  };
  return createLearningTaskExecutor({
    analysis,
    query: { prepare: unexpected },
    practice: { startSentence: unexpected, submitAttempt: unexpected, retryFeedback: unexpected },
    dialogue: {
      startDialogue: unexpected,
      submitTurn: unexpected,
      finish: unexpected,
      retryAssistant: unexpected,
    },
    maintenance: { suggestions: unexpected },
  });
}

describe("native generation persisted task ingress", () => {
  it("keeps explicit generation after enqueue/restart and replays the saved result under either read profile", async () => {
    const store = createPostgresLearningTasks(createPgliteAnalysisDatabase(database));
    const fixture = analysisModuleFixture(structuredAnalysisFixture());
    const worker = createLearningTaskWorker({ store, execute: executor(fixture.module) });
    const app = createLearningTaskApp({
      store,
      cronSecret: "x".repeat(32),
      runWorker: () => worker.runOne(),
      authenticate: async () => ({ kind: "web", userId: owner }),
    });
    app.onError((error, c) =>
      c.json({ error: "rejected" }, error instanceof CloudFault ? errorStatus(error.code) : 400),
    );
    const command = {
      version: 2,
      kind: "analysis",
      input: {
        outputContract: "structured-teaching-v1",
        sourceText: "  We can.\r\n",
        source: { type: "manual" },
        selectionKind: "sentence",
      },
    };
    const submitted = await app.request(learningTaskRoutes.submit, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": "native-task",
        Accept: "application/json",
      },
      body: JSON.stringify(command),
    });
    expect(submitted.status).toBe(202);
    const task = learningTaskSnapshotReadSchema.parse(await submitted.json());
    const rows = await database.query<{ command: unknown }>(
      "SELECT command FROM learning_tasks WHERE id=$1",
      [task.id],
    );
    expect(rows.rows[0]?.command).toMatchObject({
      ...command,
      _generation: {
        identity: {
          provider: "deepseek",
          model: "deepseek-flash",
          outputContract: "structured-teaching-v1",
          schemaVersion: 3,
        },
        inputHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
        configurationDigest: expect.stringMatching(/^[a-f0-9]{64}$/u),
        executionDigest: expect.stringMatching(/^[a-f0-9]{64}$/u),
      },
    });
    // A fresh repository reconstructs the command from the durable row at claim time.
    const reloaded = createPostgresLearningTasks(createPgliteAnalysisDatabase(database));
    const workerAfterRestart = createLearningTaskWorker({
      store: reloaded,
      execute: executor(fixture.module),
    });
    expect(await workerAfterRestart.runOne()).toMatchObject({ state: "completed" });
    expect(fixture.model.requests).toHaveLength(1);
    expect(fixture.model.requests[0]?.input).toEqual(command.input);
    const detail = learningTaskRoutes.detail.replace(":id", task.id);
    for (const [accept, type] of [
      [structuredTeachingAccept.json, "sentence-passage-analysis-v3"],
      ["application/json", "sentence-passage-analysis-v2"],
    ]) {
      const response = await app.request(detail, {
        headers: { Accept: accept ?? "application/json" },
      });
      const read = learningTaskSnapshotReadSchema.parse(await response.json());
      expect(read.output).toMatchObject({ analysis: { result: { type } } });
    }
    const { outputContract, ...oldInput } = command.input;
    void outputContract;
    const conflicting = await app.request(learningTaskRoutes.submit, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": "native-task",
        Accept: structuredTeachingAccept.json,
      },
      body: JSON.stringify({ ...command, input: oldInput }),
    });
    expect(conflicting.status).toBe(409);
    expect((await reloaded.events(owner, task.id, 0)).map((event) => event.cursor)).toEqual([
      1, 2, 3, 4,
    ]);
    expect(await workerAfterRestart.runOne()).toEqual({ claimed: false });
    expect(fixture.model.requests).toHaveLength(1);
  });

  it.each(["missing", "model", "promptVersion", "schemaVersion", "inputHash", "executionDigest"])(
    "terminalizes a native task with %s configuration before any reservation or dispatch",
    async (corruption) => {
      const store = createPostgresLearningTasks(createPgliteAnalysisDatabase(database));
      const fixture = analysisModuleFixture(structuredAnalysisFixture());
      const task = await store.submit(owner, `identity-${corruption}`, {
        version: 2,
        kind: "analysis",
        input: {
          outputContract: "structured-teaching-v1",
          sourceText: "We can.",
          source: { type: "manual" },
          selectionKind: "sentence",
        },
      });
      if (corruption === "missing")
        await database.query(
          "UPDATE learning_tasks SET command=command-'_generation' WHERE id=$1",
          [task.id],
        );
      else {
        const path = [
          "_generation",
          ...(["model", "promptVersion", "schemaVersion"].includes(corruption) ? ["identity"] : []),
          corruption,
        ];
        await database.query(
          "UPDATE learning_tasks SET command=jsonb_set(command,$2::text[],$3::jsonb) WHERE id=$1",
          [
            task.id,
            path,
            JSON.stringify(corruption === "schemaVersion" ? 99 : "offline-previous-configuration"),
          ],
        );
      }
      const worker = createLearningTaskWorker({ store, execute: executor(fixture.module) });
      expect(await worker.runOne()).toMatchObject({ state: "failed" });
      expect((await store.get(owner, task.id))?.error).toMatchObject({ code: "model_unavailable" });
      expect(fixture.model.requests).toEqual([]);
      expect(fixture.quota.operations).toEqual([]);
      expect(await worker.runOne()).toEqual({ claimed: false });
    },
  );
});
