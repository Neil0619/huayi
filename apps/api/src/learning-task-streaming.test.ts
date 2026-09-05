import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { beforeAll, afterAll, expect, it, vi } from "vitest";
import {
  createLearningTaskClient,
  type ExtensionQueryEvent,
  type QuotaSummary,
} from "@huayi/cloud-contracts";
import { createLearningTaskApp } from "./learning-task-app.js";
import { createLearningTaskWorker } from "./learning-task-worker.js";
import { createPostgresLearningTasks } from "./postgres-learning-tasks.js";
import { createPgliteAnalysisDatabase } from "./test-support/postgres-analysis-database.js";
import { createExtensionQueryModule } from "./extension-query-module.js";
import { createDeepSeekExtensionQueryModel } from "./deepseek-extension-query-model.js";
import type { LearningTaskExecutor } from "./learning-task-executor.js";

const owner = "00000000-0000-0000-0000-000000000001";
const quota: QuotaSummary = {
  availableMicroUsd: 900,
  limitMicroUsd: 1000,
  percentUsed: 10,
  periodEnd: "2026-10-01T00:00:00.000Z",
  periodStart: "2026-09-01T00:00:00.000Z",
  reservedMicroUsd: 0,
  usedMicroUsd: 100,
  warning: "available",
};
const input = {
  action: "explain" as const,
  selectionKind: "sentence" as const,
  sourceText: "This works.",
  sourceType: "web-selection" as const,
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

it("delivers readable provider text before completion and recovers after the page leaves without a second call", async () => {
  const store = createPostgresLearningTasks(createPgliteAnalysisDatabase(database));
  let provider: ReadableStreamDefaultController<Uint8Array> | undefined;
  const fetch = vi.fn(
    async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            provider = controller;
          },
        }),
        { headers: { "Content-Type": "text/event-stream" } },
      ),
  );
  const complete = vi.fn(
    async (command: {
      result: Extract<ExtensionQueryEvent, { type: "query.completed" }>["result"];
    }) => ({
      type: "query.completed" as const,
      generationId: "generation-1",
      quota,
      result: command.result,
    }),
  );
  const query = createExtensionQueryModule({
    ids: () => "generation-1",
    now: () => new Date(),
    reservedCostMicroUsd: () => 100,
    model: createDeepSeekExtensionQueryModel({
      apiKey: "offline-fixture",
      fetch,
      prices: {
        inputMicroUsdPerMillionTokens: 2,
        cachedInputMicroUsdPerMillionTokens: 1,
        outputMicroUsdPerMillionTokens: 3,
      },
    }),
    quota: { reserve: async () => ({ id: "reservation-1" }), summary: () => quota },
    store: {
      begin: async () => ({ kind: "acquired", id: "generation-1", leaseToken: "lease-1" }),
      attachReservation: async () => undefined,
      markDispatched: async () => undefined,
      complete,
      fail: vi.fn(),
      find: async () => null,
      abandon: vi.fn(),
      terminalizeWithoutReservation: vi.fn(),
    },
  });
  const execute: LearningTaskExecutor = async function* (job, execution) {
    yield* await query.prepare({ input, idempotencyKey: job.id, userId: owner, execution });
  };
  const worker = createLearningTaskWorker({ store, execute });
  const app = createLearningTaskApp({
    store,
    authenticate: async () => ({ kind: "web", userId: owner }),
    cronSecret: "x".repeat(32),
    runWorker: () => worker.runOne(),
  });
  const client = createLearningTaskClient({
    request: async (path, init) => app.request(path, init),
  });
  const task = await client.submit({ version: 2, kind: "instant-query", input }, "streaming-test");
  const running = worker.runOne();
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
  const chunk = (content: string, extra: Record<string, unknown> = {}) =>
    `data: ${JSON.stringify({ id: "provider-1", model: "deepseek-v4-flash", choices: [{ index: 0, delta: { content }, finish_reason: null }], ...extra })}\r\n\r\n`;
  const bytes = new TextEncoder().encode(chunk('{"mainStructure":"主语与谓语'));
  const firstContentAt = performance.now();
  for (const byte of bytes) provider?.enqueue(new Uint8Array([byte]));
  let previewSeen = false;
  for await (const event of client.watch(task.id)) {
    if (event.type === "query.preview-v2" && event.update.type === "delta") {
      expect(event.update.text).toContain("主");
      previewSeen = true;
      break;
    }
  }
  expect(previewSeen).toBe(true);
  expect(performance.now() - firstContentAt).toBeLessThan(250);
  expect(complete).not.toHaveBeenCalled();
  expect((await client.get(task.id)).state).toBe("running");
  provider?.enqueue(
    new TextEncoder().encode(
      chunk(
        '","contextRole":"说明","keyExpressions":[{"text":"works","meaningZh":"有效"}],"translationZh":"这有效。","selectionKind":"sentence","type":"explain-sentence"}',
      ) +
        chunk("", {
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
          usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
        }) +
        "data: [DONE]\r\n\r\n",
    ),
  );
  provider?.close();
  await running;
  const restored = [];
  for await (const event of client.watch(task.id)) restored.push(event);
  expect(restored.at(-1)?.type).toBe("query.completed");
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(complete).toHaveBeenCalledTimes(1);
  expect(
    (await client.submit({ version: 2, kind: "instant-query", input }, "streaming-test")).id,
  ).toBe(task.id);
});

it("confirms running cancellation only after the worker stops and fences repeated worker delivery", async () => {
  const store = createPostgresLearningTasks(createPgliteAnalysisDatabase(database));
  const task = await store.submit(owner, "cancel-streaming", {
    version: 2,
    kind: "instant-query",
    input,
  });
  let called = 0;
  const worker = createLearningTaskWorker({
    store,
    pollMs: 10,
    execute: async function* (_job, execution) {
      await execution.beforeDispatch?.();
      called += 1;
      yield { type: "query.started", generationId: "generation-2" };
      await new Promise<void>((resolve) =>
        execution.signal?.addEventListener("abort", () => resolve(), { once: true }),
      );
      execution.signal?.throwIfAborted();
    },
  });
  const pending = worker.runOne();
  await vi.waitFor(() => expect(called).toBe(1));
  expect((await store.cancel(owner, task.id))?.state).toBe("cancelling");
  expect(await worker.runOne()).toEqual({ claimed: false });
  await pending;
  expect((await store.get(owner, task.id))?.state).toBe("cancelled");
  expect(called).toBe(1);
});
