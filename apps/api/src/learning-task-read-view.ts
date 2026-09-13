import {
  acceptsStructuredTeaching,
  learningTaskEventReadSchema,
  learningTaskEventsReadResponseSchema,
  learningTaskSnapshotReadSchema,
  projectTaskEventForLegacy,
  projectTaskSnapshotForLegacy,
  type LearningTaskEventRead,
  type LearningTaskSnapshotRead,
} from "@huayi/cloud-contracts";
import { CloudFault } from "./cloud-fault.js";

function frame(value: unknown, event: string, id?: string) {
  const data = JSON.stringify(value);
  // JSON data is a single line; match Hono's actual field separators and final blank line.
  const encoded = `event: ${event}\ndata: ${data}\n${id === undefined ? "" : `id: ${id}\n`}\n`;
  const bytes = Buffer.byteLength(encoded, "utf8");
  if (bytes > 2 * 1024 * 1024)
    throw new CloudFault("model_output_invalid", "The task frame exceeds its limit.");
  return { bytes, message: { event, data, ...(id === undefined ? {} : { id }) } };
}

export function createLearningTaskReadView(accept: string | undefined) {
  const nativeJson = acceptsStructuredTeaching(accept, "json");
  const nativeSse = acceptsStructuredTeaching(accept, "eventStream");
  const snapshot = (value: LearningTaskSnapshotRead, native: boolean) =>
    native ? learningTaskSnapshotReadSchema.parse(value) : projectTaskSnapshotForLegacy(value);
  return {
    snapshot: (value: LearningTaskSnapshotRead) => snapshot(value, nativeJson),
    page(value: unknown) {
      const page = learningTaskEventsReadResponseSchema.parse(value);
      return {
        snapshot: snapshot(page.snapshot, nativeJson),
        events: page.events.map((event) => (nativeJson ? event : projectTaskEventForLegacy(event))),
      };
    },
    eventFrame(value: LearningTaskEventRead) {
      const event = nativeSse
        ? learningTaskEventReadSchema.parse(value)
        : projectTaskEventForLegacy(value);
      return frame(event, "learning-task", String(event.cursor));
    },
    statusFrame(value: LearningTaskSnapshotRead) {
      return frame(snapshot(value, nativeSse), "task-status");
    },
  };
}
