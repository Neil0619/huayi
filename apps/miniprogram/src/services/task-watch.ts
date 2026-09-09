import {
  learningTaskEventsResponseSchema,
  type LearningTaskFrame,
  type LearningTaskEvent,
  type LearningTaskSnapshot,
} from "@huayi/cloud-contracts";
import { MiniError } from "./errors";
import type { createTaskLifecycle } from "./task-lifecycle";

export interface TaskObserver {
  onEvent(event: LearningTaskEvent): void;
  onSnapshot(snapshot: LearningTaskSnapshot): void;
  onError(error: unknown): void;
}
export function createTaskWatcher(ports: {
  lifecycle: ReturnType<typeof createTaskLifecycle>;
  stream(
    id: string,
    cursor: number,
    onFrame: (frame: LearningTaskFrame) => void,
    onDone: (error?: unknown) => void,
  ): { abort(): void };
  read(id: string, cursor: number): Promise<unknown>;
  delay(callback: () => void, ms: number): () => void;
}) {
  return (id: string, observer: TaskObserver) => {
    let stopped = false;
    let generation = 0;
    let cursor = 0;
    let fallback = false;
    let terminal = false;
    let failures = 0;
    let abort: () => void = () => undefined;
    let cancelTimer: () => void = () => undefined;
    const alive = (value: number) => !stopped && generation === value && ports.lifecycle.visible();
    const apply = (frame: LearningTaskFrame) => {
      if (frame.kind === "event") {
        if (frame.event.taskId !== id || frame.event.cursor > cursor + 1)
          throw new MiniError("invalid_response");
        if (frame.event.cursor > cursor) {
          cursor = frame.event.cursor;
          observer.onEvent(frame.event);
        }
      } else {
        if (frame.snapshot.id !== id || frame.snapshot.cursor < cursor)
          throw new MiniError("invalid_response");
        terminal =
          !["queued", "running", "cancelling"].includes(frame.snapshot.state) &&
          cursor >= frame.snapshot.cursor;
        observer.onSnapshot(frame.snapshot);
      }
    };
    const pause = () => {
      generation++;
      cancelTimer();
      abort();
      abort = () => undefined;
    };
    const start = () => {
      if (stopped || terminal || !ports.lifecycle.visible()) return;
      pause();
      const current = generation;
      const next = (error?: unknown) => {
        if (!alive(current) || terminal) return;
        if (error) {
          fallback = true;
          failures++;
          observer.onError(error);
        } else failures = 0;
        cancelTimer = ports.delay(start, Math.min(15_000, 1000 * 2 ** Math.min(failures, 4)));
      };
      if (fallback) {
        void ports
          .read(id, cursor)
          .then((value) => {
            if (!alive(current)) return;
            const result = learningTaskEventsResponseSchema.parse(value);
            for (const event of result.events) apply({ kind: "event", event });
            // Retained terminal output also recovers tasks whose old events were pruned.
            if (
              !result.events.length &&
              !["queued", "running", "cancelling"].includes(result.snapshot.state)
            )
              cursor = result.snapshot.cursor;
            apply({ kind: "snapshot", snapshot: result.snapshot });
            next();
          })
          .catch((error) => next(error));
      } else {
        const subscription = ports.stream(
          id,
          cursor,
          (frame) => {
            if (alive(current)) apply(frame);
          },
          next,
        );
        abort = () => subscription.abort();
      }
    };
    const unsubscribe = ports.lifecycle.subscribe((visible) => {
      if (visible) start();
      else pause();
    });
    start();
    return () => {
      stopped = true;
      pause();
      unsubscribe();
    };
  };
}
