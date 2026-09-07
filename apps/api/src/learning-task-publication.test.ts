import {
  contractFixtures,
  createLearningTaskClient,
  type LearningTaskEvent,
  type LearningTaskPayload,
  type LearningTaskSnapshot,
} from "@huayi/cloud-contracts";
import { expect, it, vi } from "vitest";

import { createLearningTaskApp } from "./learning-task-app.js";
import type { LearningTaskLease, LearningTaskStore } from "./learning-task-store.js";
import { createLearningTaskWorker } from "./learning-task-worker.js";

it("publishes an unfinished provider delta through the worker and SSE within 250ms of scheduler time", async () => {
  vi.useFakeTimers();
  let release: () => void = () => undefined;
  const providerEnd = new Promise<void>((resolve) => {
    release = resolve;
  });
  const job: LearningTaskLease = {
    id: "task-1",
    ownerUserId: "owner-1",
    leaseToken: "lease-1",
    createdAt: new Date().toISOString(),
    command: {
      version: 2,
      kind: "instant-query",
      input: {
        action: "explain",
        selectionKind: "sentence",
        sourceText: "This works.",
        sourceType: "web-selection",
      },
    },
  };
  const snapshot: LearningTaskSnapshot = {
    version: 2,
    id: job.id,
    kind: "instant-query",
    subjectId: null,
    state: "running",
    cursor: 0,
    createdAt: job.createdAt,
    updatedAt: job.createdAt,
    error: null,
    output: null,
    timings: {},
  };
  const events: LearningTaskEvent[] = [];
  const store: LearningTaskStore = {
    submit: async () => snapshot,
    get: async () => ({ ...snapshot }),
    list: async () => [snapshot],
    events: async (_owner, _id, cursor) => events.filter((event) => event.cursor > cursor),
    cancel: async () => null,
    claim: async () => job,
    touch: async () => "running",
    append: async (_lease, payloads) => {
      for (const payload of payloads)
        events.push({ version: 2, taskId: job.id, cursor: ++snapshot.cursor, payload });
    },
    finish: vi.fn(async (_lease, state, output, error) => {
      Object.assign(snapshot, { state, output, error });
    }),
  };
  const preview: LearningTaskPayload = {
    type: "query.preview-v2",
    version: 2,
    generationId: "generation-1",
    update: {
      type: "delta",
      requestId: "request-1",
      section: "main-structure",
      sequence: 0,
      text: "主语与谓语",
    },
  };
  const worker = createLearningTaskWorker({
    store,
    execute: async function* () {
      yield preview;
      await providerEnd;
      yield {
        type: "query.completed",
        generationId: "generation-1",
        quota: contractFixtures.completedEvent.quota,
        result: {
          type: "explain-sentence",
          selectionKind: "sentence",
          requestId: "request-1",
          sourceText: "This works.",
          mainStructure: "主语与谓语",
          contextRole: "说明",
          keyExpressions: [{ text: "works", meaningZh: "有效" }],
          translationZh: "这有效。",
        },
      };
    },
  });
  const app = createLearningTaskApp({
    store,
    authenticate: async () => ({ kind: "web", userId: job.ownerUserId }),
    cronSecret: "x".repeat(32),
    runWorker: () => worker.runOne(),
  });
  const client = createLearningTaskClient({
    request: async (path, init) => app.request(path, init),
  });
  const delivered: LearningTaskPayload[] = [];
  const startedAt = performance.now();
  const running = worker.runOne();
  const watching = (async () => {
    for await (const event of client.watch(job.id)) {
      delivered.push(event);
      if (event.type === "query.preview-v2") break;
    }
  })();
  try {
    await vi.advanceTimersByTimeAsync(249);
    expect([...delivered]).toContainEqual(preview);
    expect(performance.now() - startedAt).toBeLessThan(250);
    expect(store.finish).not.toHaveBeenCalled();
  } finally {
    release();
    try {
      await running;
      await vi.advanceTimersByTimeAsync(100);
      await watching;
    } finally {
      vi.useRealTimers();
    }
  }
  expect(snapshot.state).toBe("completed");
  expect(store.finish).toHaveBeenCalledTimes(1);
});
