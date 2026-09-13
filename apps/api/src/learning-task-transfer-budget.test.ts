import {
  createLearningTaskClient,
  learningTaskEventsReadResponseSchema,
  learningTaskPayloadReadSchema,
  type LearningTaskEventRead,
  type LearningTaskSnapshotRead,
} from "@huayi/cloud-contracts";
import { expect, it, vi } from "vitest";
import { createLearningTaskApp } from "./learning-task-app.js";
import type { LearningTaskStore } from "./learning-task-store.js";
import { structuredAnalysisAtCharacterLimit } from "./test-support/structured-analysis-fixture.js";
import { FakeAnalysisQuota } from "./test-support/analysis-fakes.js";

it("resumes complete SSE connections within the old client's byte limit without dropping a cursor", async () => {
  const output = learningTaskPayloadReadSchema.parse({
    type: "analysis.completed",
    analysis: structuredAnalysisAtCharacterLimit(),
    quota: new FakeAnalysisQuota().summary(),
  });
  const snapshot: LearningTaskSnapshotRead = {
    version: 2,
    id: "task-1",
    kind: "analysis",
    subjectId: null,
    state: "completed",
    cursor: 8193,
    createdAt: "2026-08-13T00:00:00Z",
    updatedAt: "2026-08-13T00:00:01Z",
    error: null,
    timings: {},
    output,
  };
  const events: LearningTaskEventRead[] = Array.from({ length: snapshot.cursor }, (_, index) => ({
    version: 2,
    taskId: snapshot.id,
    cursor: index + 1,
    payload:
      index === snapshot.cursor - 1
        ? output
        : {
            type: "analysis.preview",
            requestId: "request-1",
            section: "overall",
            text: String(index + 1),
          },
  }));
  const store: LearningTaskStore = {
    get: async () => snapshot,
    events: async (_owner, _id, cursor) => events.slice(cursor, cursor + 128),
    submit: vi.fn(),
    list: vi.fn(),
    cancel: vi.fn(),
    claim: vi.fn(),
    touch: vi.fn(),
    append: vi.fn(),
    finish: vi.fn(),
  };
  // Validate the seeded adapter page independently of the streaming diagnostic wrapper.
  learningTaskEventsReadResponseSchema.parse({ snapshot, events: events.slice(0, 128) });
  const worker = vi.fn();
  const app = createLearningTaskApp({
    store,
    authenticate: async () => ({ kind: "web", userId: "owner" }),
    cronSecret: "x".repeat(32),
    runWorker: worker,
  });
  const connections: { bytes: number; path: string }[] = [];
  const client = createLearningTaskClient({
    request: async (path, init) => {
      const response = await app.request(path, init);
      const bytes = await response.arrayBuffer();
      connections.push({ bytes: bytes.byteLength, path });
      return new Response(bytes, { status: response.status, headers: response.headers });
    },
  });
  const delivered = [];
  for await (const event of client.watch(snapshot.id)) delivered.push(event);
  expect(delivered).toHaveLength(snapshot.cursor);
  expect(
    delivered
      .slice(0, -1)
      .map((event) => (event.type === "analysis.preview" ? event.text : "wrong-event")),
  ).toEqual(Array.from({ length: 8192 }, (_, i) => String(i + 1)));
  expect(delivered.at(-1)).toMatchObject({
    type: "analysis.completed",
    analysis: { result: { type: "sentence-passage-analysis-v2" } },
  });
  expect(connections.length).toBeGreaterThan(1);
  expect(connections.every(({ bytes }) => bytes <= 3 * 1024 * 1024)).toBe(true);
  expect(connections.slice(1).every(({ path }) => /cursor=[1-9]\d*/u.test(path))).toBe(true);
  expect(worker).not.toHaveBeenCalled();
  expect(store.submit).not.toHaveBeenCalled();
}, 20_000);
