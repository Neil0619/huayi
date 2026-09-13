import {
  learningTaskEventSchema,
  learningTaskSnapshotSchema,
  type LearningTaskEvent,
  type LearningTaskSnapshot,
} from "./learning-tasks.js";
import type { z } from "zod/v3";
import { LearningTaskError } from "./learning-task-error.js";

export type TaskSnapshot<Payload> = Omit<LearningTaskSnapshot, "output"> & {
  output: Payload | null;
};
export type TaskEvent<Payload> = Omit<LearningTaskEvent, "payload"> & { payload: Payload };
export type TaskFrame<Payload> =
  | { kind: "event"; event: TaskEvent<Payload> }
  | { kind: "snapshot"; snapshot: TaskSnapshot<Payload> };
export type LearningTaskFrame = TaskFrame<LearningTaskEvent["payload"]>;
export interface TaskWireSchemas<Payload> {
  event: z.ZodType<TaskEvent<Payload>, z.ZodTypeDef, unknown>;
  snapshot: z.ZodType<TaskSnapshot<Payload>, z.ZodTypeDef, unknown>;
}
/** String framing is shared by Fetch and wx.request; no browser objects are used. */
export function createLearningTaskSseDecoder(taskId: string, initialCursor = 0) {
  return createTaskSseDecoder(taskId, initialCursor, {
    event: learningTaskEventSchema,
    snapshot: learningTaskSnapshotSchema,
  });
}
export function createTaskSseDecoder<Payload>(
  taskId: string,
  initialCursor: number,
  schemas: TaskWireSchemas<Payload>,
) {
  let buffer = "";
  let total = 0;
  let cursor = initialCursor;
  const invalid = () => new LearningTaskError("invalid_response", taskId);
  return {
    get cursor() {
      return cursor;
    },
    push(text: string): TaskFrame<Payload>[] {
      total += text.length;
      if (total > 4 * 1024 * 1024) throw invalid();
      buffer += text;
      const output: TaskFrame<Payload>[] = [];
      let boundary = buffer.search(/\r?\n\r?\n/u);
      while (boundary >= 0) {
        const frame = buffer.slice(0, boundary).replaceAll("\r\n", "\n");
        buffer = buffer.slice(
          boundary + (buffer.slice(boundary).match(/^\r?\n\r?\n/u)?.[0].length ?? 2),
        );
        const fields = new Map<string, string>();
        for (const line of frame.split("\n")) {
          if (line.startsWith(":") || line === "") continue;
          const colon = line.indexOf(":");
          const key = line.slice(0, colon);
          if (colon < 0 || fields.has(key) || !["event", "data", "id"].includes(key))
            throw invalid();
          fields.set(key, line.slice(colon + 1).replace(/^ /u, ""));
        }
        if (fields.size) {
          let data: unknown;
          try {
            data = JSON.parse(fields.get("data") ?? "");
          } catch {
            throw invalid();
          }
          if (fields.get("event") === "learning-task") {
            const parsed = schemas.event.safeParse(data);
            if (!parsed.success) throw invalid();
            const event = parsed.data;
            if (
              event.taskId !== taskId ||
              String(event.cursor) !== fields.get("id") ||
              event.cursor > cursor + 1
            )
              throw invalid();
            if (event.cursor > cursor) {
              cursor = event.cursor;
              output.push({ kind: "event", event });
            }
          } else if (fields.get("event") === "task-status") {
            const parsed = schemas.snapshot.safeParse(data);
            if (!parsed.success || parsed.data.id !== taskId || parsed.data.cursor < cursor)
              throw invalid();
            output.push({ kind: "snapshot", snapshot: parsed.data });
          } else throw invalid();
        }
        boundary = buffer.search(/\r?\n\r?\n/u);
      }
      if (buffer.length > 2 * 1024 * 1024) throw invalid();
      return output;
    },
    finish() {
      if (buffer !== "") throw new TypeError("Task subscription interrupted");
    },
  };
}
