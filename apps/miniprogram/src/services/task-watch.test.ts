import { expect, it, vi } from "vitest";
import { createTaskWatcher } from "./task-watch";
import { createTaskLifecycle } from "./task-lifecycle";
import type { LearningTaskFrame } from "@huayi/cloud-contracts";
it("falls back to JSON after a stream failure and never resubmits paid work", async () => {
  const lifecycle = createTaskLifecycle();
  let done: (error?: unknown) => void = () => undefined;
  let timer: () => void = () => undefined;
  const snapshot = {
    version: 2,
    id: "task",
    kind: "capture-analysis",
    subjectId: "capture",
    state: "completed",
    cursor: 0,
    createdAt: "2026-09-09T00:00:00Z",
    updatedAt: "2026-09-09T00:00:00Z",
    timings: {},
    error: null,
    output: null,
  };
  const read = vi.fn(async () => ({ snapshot, events: [] }));
  const onSnapshot = vi.fn();
  const stop = createTaskWatcher({
    lifecycle,
    stream: (_id, _cursor, _frame, onDone) => {
      done = onDone;
      return { abort: vi.fn() };
    },
    read,
    delay: (callback) => {
      timer = callback;
      return () => undefined;
    },
  })("task", { onEvent: vi.fn(), onSnapshot, onError: vi.fn() });
  done(new Error("chunked request unavailable"));
  timer();
  await vi.waitFor(() => expect(read).toHaveBeenCalledWith("task", 0));
  await vi.waitFor(() => expect(onSnapshot).toHaveBeenCalledWith(snapshot));
  stop();
});
it("aborts only subscriptions on background, resumes at the same cursor and ignores late callbacks", () => {
  const lifecycle = createTaskLifecycle();
  const abort = vi.fn();
  const callbacks: ((frame: LearningTaskFrame) => void)[] = [];
  const stream = vi.fn(
    (_id: string, _cursor: number, frame: (frame: LearningTaskFrame) => void) => {
      callbacks.push(frame);
      return { abort };
    },
  );
  const onEvent = vi.fn();
  const stop = createTaskWatcher({
    lifecycle,
    stream,
    read: vi.fn(),
    delay: () => () => undefined,
  })("task", { onEvent, onSnapshot: vi.fn(), onError: vi.fn() });
  const event = {
    version: 2 as const,
    taskId: "task",
    cursor: 1,
    payload: {
      type: "practice.preview" as const,
      section: "feedback" as const,
      text: "你好",
      sequence: 1,
    },
  };
  callbacks[0]?.({ kind: "event", event });
  lifecycle.hide();
  callbacks[0]?.({ kind: "event", event: { ...event, cursor: 2 } });
  expect(onEvent).toHaveBeenCalledTimes(1);
  expect(abort).toHaveBeenCalledOnce();
  lifecycle.show();
  expect(stream.mock.calls[1]?.slice(0, 2)).toEqual(["task", 1]);
  stop();
  expect(abort).toHaveBeenCalledTimes(2);
});
