import { apiErrorSchema, idempotencyKeySchema, resourceIdSchema } from "./common-contracts.js";
import {
  learningTaskCommandSchema,
  learningTaskEventSchema,
  learningTaskSnapshotSchema,
  learningTaskRoutes,
  type LearningTaskCommand,
  type LearningTaskPayload,
  type LearningTaskSnapshot,
} from "./learning-tasks.js";
import { z } from "zod/v3";

export class LearningTaskError extends Error {
  constructor(
    readonly code: string,
    readonly diagnosticId?: string,
  ) {
    super(`Learning task failed: ${code}.`);
  }
}
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
          let buffer = "";
          let bytes = 0;
          const abort = () => {
            void reader.cancel().catch(() => undefined);
          };
          signal?.addEventListener("abort", abort, { once: true });
          try {
            while (!signal?.aborted) {
              const chunk = await reader.read();
              if (chunk.done) {
                buffer += decoder.decode();
                break;
              }
              bytes += chunk.value.byteLength;
              if (bytes > 4 * 1024 * 1024) throw new LearningTaskError("invalid_response", id);
              buffer += decoder.decode(chunk.value, { stream: true });
              let boundary = buffer.search(/\r?\n\r?\n/u);
              while (boundary >= 0) {
                const frame = buffer.slice(0, boundary).replaceAll("\r\n", "\n");
                buffer = buffer.slice(
                  boundary + (buffer.slice(boundary).match(/^\r?\n\r?\n/u)?.[0].length ?? 2),
                );
                const fields = new Map<string, string>();
                for (const line of frame.split("\n")) {
                  if (line.startsWith(":")) continue;
                  const colon = line.indexOf(":");
                  const key = line.slice(0, colon);
                  if (colon < 0 || fields.has(key) || !["event", "data", "id"].includes(key))
                    throw new LearningTaskError("invalid_response", id);
                  fields.set(key, line.slice(colon + 1).replace(/^ /u, ""));
                }
                if (fields.get("event") === "learning-task") {
                  const event = learningTaskEventSchema.parse(
                    JSON.parse(fields.get("data") ?? "") as unknown,
                  );
                  if (
                    event.taskId !== id ||
                    String(event.cursor) !== fields.get("id") ||
                    event.cursor > cursor + 1
                  )
                    throw new LearningTaskError("invalid_response", id);
                  if (event.cursor > cursor) {
                    cursor = event.cursor;
                    lastPayload = event.payload;
                    yield event.payload;
                  }
                  retries = 0;
                } else if (fields.get("event") === "task-status") {
                  snapshot = learningTaskSnapshotSchema.parse(
                    JSON.parse(fields.get("data") ?? "") as unknown,
                  );
                  if (snapshot.id !== id || snapshot.cursor < cursor)
                    throw new LearningTaskError("invalid_response", id);
                  onSnapshot?.(snapshot);
                  retries = 0;
                } else if (fields.size > 0) throw new LearningTaskError("invalid_response", id);
                boundary = buffer.search(/\r?\n\r?\n/u);
              }
              if (buffer.length > 2 * 1024 * 1024)
                throw new LearningTaskError("invalid_response", id);
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
          if (buffer !== "" || !snapshot) throw new TypeError("Task subscription interrupted");
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
