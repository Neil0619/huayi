import { apiErrorSchema, idempotencyKeySchema, resourceIdSchema } from "./common-contracts.js";
import {
  learningTaskCommandSchema,
  learningTaskSnapshotSchema,
  learningTaskRoutes,
  type LearningTaskCommand,
  type LearningTaskPayload,
  type LearningTaskSnapshot,
} from "./learning-tasks.js";
import { z } from "zod/v3";

import { LearningTaskError } from "./learning-task-error.js";
import { createLearningTaskSseDecoder } from "./learning-task-sse-decoder.js";
export { LearningTaskError };
export interface LearningTaskTransport {
  request(path: string, init: RequestInit): Promise<Response>;
}
const terminal = (task: LearningTaskSnapshot) =>
  !["queued", "running", "cancelling"].includes(task.state);
async function success(response: Response) {
  if (response.ok) return response;
  const parsed = apiErrorSchema.safeParse(await response.json().catch(() => null));
  throw new LearningTaskError(
    parsed.success
      ? parsed.data.error.code
      : response.status === 401
        ? "authentication_required"
        : "network_error",
  );
}
export function createLearningTaskClient(transport: LearningTaskTransport) {
  const path = (id: string) =>
    `${learningTaskRoutes.submit}/${encodeURIComponent(resourceIdSchema.parse(id))}`;
  const read = async (response: Response) =>
    learningTaskSnapshotSchema.parse(await (await success(response)).json());
  return {
    async submit(command: LearningTaskCommand, key: string, signal?: AbortSignal) {
      return read(
        await transport.request(learningTaskRoutes.submit, {
          method: "POST",
          body: JSON.stringify(learningTaskCommandSchema.parse(command)),
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": idempotencyKeySchema.parse(key),
          },
          ...(signal ? { signal } : {}),
        }),
      );
    },
    async get(id: string) {
      return read(await transport.request(path(id), { method: "GET" }));
    },
    async list() {
      return z
        .array(learningTaskSnapshotSchema)
        .max(100)
        .parse(
          await (
            await success(await transport.request(learningTaskRoutes.list, { method: "GET" }))
          ).json(),
        );
    },
    async cancel(id: string) {
      return read(await transport.request(`${path(id)}/cancel`, { method: "POST" }));
    },
    async *watch(
      id: string,
      signal?: AbortSignal,
      onSnapshot?: (snapshot: LearningTaskSnapshot) => void,
    ): AsyncIterable<LearningTaskPayload> {
      let cursor = 0;
      let retries = 0;
      let lastPayload: LearningTaskPayload | null = null;
      while (!signal?.aborted) {
        let snapshot: LearningTaskSnapshot | null = null;
        try {
          const response = await success(
            await transport.request(`${path(id)}/events?cursor=${cursor}`, {
              method: "GET",
              headers: { Accept: "text/event-stream" },
              ...(signal ? { signal } : {}),
            }),
          );
          if (
            response.headers.get("content-type")?.split(";")[0]?.trim() !== "text/event-stream" ||
            !response.body
          )
            throw new LearningTaskError("invalid_response", id);
          const reader = response.body.getReader();
          const decoder = new TextDecoder("utf-8", { fatal: true });
          const frames = createLearningTaskSseDecoder(id, cursor);
          let bytes = 0;
          const abort = () => {
            void reader.cancel().catch(() => undefined);
          };
          signal?.addEventListener("abort", abort, { once: true });
          try {
            while (!signal?.aborted) {
              const chunk = await reader.read();
              if (chunk.done) {
                frames.push(decoder.decode());
                break;
              }
              bytes += chunk.value.byteLength;
              if (bytes > 4 * 1024 * 1024) throw new LearningTaskError("invalid_response", id);
              for (const frame of frames.push(decoder.decode(chunk.value, { stream: true }))) {
                if (frame.kind === "event") {
                  cursor = frame.event.cursor;
                  lastPayload = frame.event.payload;
                  yield frame.event.payload;
                } else {
                  snapshot = frame.snapshot;
                  onSnapshot?.(snapshot);
                }
                retries = 0;
              }
              if (snapshot && terminal(snapshot) && cursor >= snapshot.cursor) break;
            }
          } finally {
            signal?.removeEventListener("abort", abort);
            await reader.cancel().catch(() => undefined);
            reader.releaseLock();
          }
          if (signal?.aborted) break;
          if (snapshot && terminal(snapshot) && cursor >= snapshot.cursor) {
            if (snapshot.output && JSON.stringify(lastPayload) !== JSON.stringify(snapshot.output))
              yield snapshot.output;
            if (snapshot.state !== "completed")
              throw new LearningTaskError(
                snapshot.error?.code ?? "outcome_unknown",
                snapshot.error?.diagnosticId ?? id,
              );
            return;
          }
          frames.finish();
          if (!snapshot) throw new TypeError("Task subscription interrupted");
        } catch (error) {
          if (signal?.aborted) break;
          if (!(error instanceof TypeError) || retries >= 2) throw error;
          retries += 1;
          await new Promise<void>((resolve) => {
            const timer = setTimeout(done, retries * 250);
            function done() {
              clearTimeout(timer);
              signal?.removeEventListener("abort", done);
              resolve();
            }
            signal?.addEventListener("abort", done, { once: true });
          });
        }
      }
      signal?.throwIfAborted();
    },
  };
}
export type LearningTaskClient = ReturnType<typeof createLearningTaskClient>;
