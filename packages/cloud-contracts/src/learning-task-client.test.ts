import { expect, it, vi } from "vitest";
import { createLearningTaskClient } from "./learning-task-client.js";
import type { LearningTaskPayload, LearningTaskSnapshot } from "./learning-tasks.js";
const snapshot: LearningTaskSnapshot = {
  version: 2,
  id: "task-1",
  kind: "instant-query",
  subjectId: null,
  state: "running",
  cursor: 1,
  createdAt: "2026-09-05T00:00:00.000Z",
  updatedAt: "2026-09-05T00:00:00.000Z",
  error: null,
  output: null,
  timings: {},
};
const payload: LearningTaskPayload = {
  type: "query.preview-v2",
  version: 2,
  generationId: "generation-1",
  update: {
    type: "delta",
    requestId: "generation-1",
    sequence: 0,
    section: "translation",
    text: "你好😀",
  },
};
const event = (cursor = 1, taskId = snapshot.id) =>
  `event: learning-task\r\nid: ${cursor}\r\ndata: ${JSON.stringify({ version: 2, taskId, cursor, payload })}\r\n\r\n`;
const status = (value: Partial<LearningTaskSnapshot> = {}) =>
  `event: task-status\r\ndata: ${JSON.stringify({ ...snapshot, ...value })}\r\n\r\n`;
const response = (wire: string) =>
  new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const byte of new TextEncoder().encode(wire)) controller.enqueue(Uint8Array.of(byte));
        controller.close();
      },
    }),
    { headers: { "content-type": "text/event-stream" } },
  );
async function collect(client: ReturnType<typeof createLearningTaskClient>, signal?: AbortSignal) {
  const values = [];
  for await (const value of client.watch(snapshot.id, signal)) values.push(value);
  return values;
}
it("handles fragmented Unicode and replayed cursors once across reconnect without POST", async () => {
  const request = vi
    .fn<(path: string, init: RequestInit) => Promise<Response>>()
    .mockResolvedValueOnce(response(event() + status()))
    .mockResolvedValueOnce(
      response(event() + event(2) + status({ cursor: 2, state: "completed" })),
    );
  const values = await collect(createLearningTaskClient({ request }));
  expect(values).toEqual([payload, payload]);
  expect(request).toHaveBeenCalledTimes(2);
  expect(request.mock.calls[1]?.[0]).toContain("cursor=1");
  expect(request.mock.calls.every((call) => call[1].method === "GET")).toBe(true);
});
it.each([event(2), event(1, "another-task"), "event: learning-task\ndata: {}\n\n"])(
  "rejects an out of order, cross-task, or malformed event",
  async (wire) => {
    await expect(
      collect(createLearningTaskClient({ request: async () => response(wire) })),
    ).rejects.toThrow();
  },
);
it("reconnects a truncated connection using its durable cursor", async () => {
  const request = vi
    .fn<(path: string, init: RequestInit) => Promise<Response>>()
    .mockResolvedValueOnce(response(event() + "event: task-status\ndata: {"))
    .mockResolvedValueOnce(response(status({ state: "completed" })));
  expect(await collect(createLearningTaskClient({ request }))).toEqual([payload]);
  expect(request.mock.calls[1]?.[0]).toContain("cursor=1");
});
it("aborts subscriptions without cancelling server tasks", async () => {
  const controller = new AbortController();
  const request = vi.fn<(path: string, init: RequestInit) => Promise<Response>>(async () =>
    response(event() + status()),
  );
  const client = createLearningTaskClient({ request });
  const pending = (async () => {
    for await (const value of client.watch(snapshot.id, controller.signal)) {
      expect(value).toEqual(payload);
      controller.abort();
    }
  })();
  await expect(pending).rejects.toThrow();
  expect(request).toHaveBeenCalledTimes(1);
  expect(request.mock.calls[0]?.[0]).not.toContain("cancel");
});
