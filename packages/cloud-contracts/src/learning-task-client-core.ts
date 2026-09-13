import { apiErrorSchema, idempotencyKeySchema, resourceIdSchema } from "./common-contracts.js";
import { learningTaskRoutes } from "./learning-tasks.js";
import { z } from "zod/v3";
import { LearningTaskError } from "./learning-task-error.js";
import {
  createTaskSseDecoder,
  type TaskSnapshot,
  type TaskWireSchemas,
} from "./learning-task-sse-decoder.js";
export interface LearningTaskTransport {
  request(path: string, init: RequestInit): Promise<Response>;
}

export interface TaskClientProtocol<Command, Payload> extends TaskWireSchemas<Payload> {
  command: z.ZodType<Command, z.ZodTypeDef, unknown>;
  jsonAccept?: string;
  eventStreamAccept: string;
}
const terminal = (task: { state: string }) =>
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
export function createTaskClient<Command, Payload>(
  transport: LearningTaskTransport,
  protocol: TaskClientProtocol<Command, Payload>,
) {
  const path = (id: string) =>
    `${learningTaskRoutes.submit}/${encodeURIComponent(resourceIdSchema.parse(id))}`;
  const read = async (response: Response, expectedId?: string) => {
    const snapshot = protocol.snapshot.parse(await (await success(response)).json());
    if (expectedId !== undefined && snapshot.id !== resourceIdSchema.parse(expectedId))
      throw new LearningTaskError("invalid_response", expectedId);
    return snapshot;
  };
  const jsonHeaders = protocol.jsonAccept ? { headers: { Accept: protocol.jsonAccept } } : {};
  return {
    async submit(command: Command, key: string, signal?: AbortSignal) {
      return read(
        await transport.request(learningTaskRoutes.submit, {
          method: "POST",
          body: JSON.stringify(protocol.command.parse(command)),
          headers: {
            ...(protocol.jsonAccept ? { Accept: protocol.jsonAccept } : {}),
            "Content-Type": "application/json",
            "Idempotency-Key": idempotencyKeySchema.parse(key),
          },
          ...(signal ? { signal } : {}),
        }),
      );
    },
    async get(id: string) {
      return read(await transport.request(path(id), { method: "GET", ...jsonHeaders }), id);
    },
    async list() {
      return z
        .array(protocol.snapshot)
        .max(100)
        .parse(
          await (
            await success(
              await transport.request(learningTaskRoutes.list, { method: "GET", ...jsonHeaders }),
            )
          ).json(),
        );
    },
    async cancel(id: string) {
      return read(
        await transport.request(`${path(id)}/cancel`, { method: "POST", ...jsonHeaders }),
        id,
      );
    },
    async *watch(
      id: string,
      signal?: AbortSignal,
      onSnapshot?: (snapshot: TaskSnapshot<Payload>) => void,
    ): AsyncIterable<Payload> {
      let cursor = 0;
      let retries = 0;
      let lastPayload: Payload | null = null;
      while (!signal?.aborted) {
        let snapshot: TaskSnapshot<Payload> | null = null;
        try {
          const response = await success(
            await transport.request(`${path(id)}/events?cursor=${cursor}`, {
              method: "GET",
              headers: { Accept: protocol.eventStreamAccept },
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
          const frames = createTaskSseDecoder(id, cursor, protocol);
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
