import { z } from "zod/v3";
import {
  learningTaskCommandSchema,
  learningTaskPayloadSchema,
  learningTaskEventSchema,
  learningTaskSnapshotSchema,
  learningTaskEventsResponseSchema,
  type LearningTaskPayload,
  type LearningTaskSnapshot,
  type LearningTaskEvent,
} from "./learning-tasks.js";
import {
  startAnalysisGenerationRequestSchema,
  captureAnalysisGenerationRequestSchema,
  extensionQueryGenerationRequestSchema,
} from "./structured-teaching-requests.js";
import {
  analysisEventReadSchema,
  extensionQueryEventReadSchema,
  projectAnalysisEventForLegacy,
  projectQueryEventForLegacy,
} from "./structured-teaching-events.js";

/** The durable command envelope stays at v2; only its explicit generation contract changes. */
export const learningTaskCommandReadSchema = z.discriminatedUnion("kind", [
  learningTaskCommandSchema.options[0].extend({ input: extensionQueryGenerationRequestSchema }),
  learningTaskCommandSchema.options[1].extend({ input: startAnalysisGenerationRequestSchema }),
  learningTaskCommandSchema.options[2].extend({ input: captureAnalysisGenerationRequestSchema }),
  ...learningTaskCommandSchema.options.slice(3),
]);
export type LearningTaskCommandRead = z.infer<typeof learningTaskCommandReadSchema>;
export const learningTaskPayloadReadSchema = z.union([
  analysisEventReadSchema,
  extensionQueryEventReadSchema,
  ...learningTaskPayloadSchema.options.slice(2),
]);
export type LearningTaskPayloadRead = z.infer<typeof learningTaskPayloadReadSchema>;
export const learningTaskSnapshotReadSchema = learningTaskSnapshotSchema.extend({
  output: learningTaskPayloadReadSchema.nullable(),
});
export type LearningTaskSnapshotRead = z.infer<typeof learningTaskSnapshotReadSchema>;
export const learningTaskEventReadSchema = learningTaskEventSchema.extend({
  payload: learningTaskPayloadReadSchema,
});
export type LearningTaskEventRead = z.infer<typeof learningTaskEventReadSchema>;
export const learningTaskEventsReadResponseSchema = learningTaskEventsResponseSchema.extend({
  snapshot: learningTaskSnapshotReadSchema,
  events: z.array(learningTaskEventReadSchema).max(128),
});

export function projectTaskPayloadForLegacy(value: LearningTaskPayloadRead): LearningTaskPayload {
  const analysis = analysisEventReadSchema.safeParse(value);
  if (analysis.success) return projectAnalysisEventForLegacy(analysis.data);
  const query = extensionQueryEventReadSchema.safeParse(value);
  if (query.success) return projectQueryEventForLegacy(query.data);
  return learningTaskPayloadSchema.parse(value);
}
export function projectTaskSnapshotForLegacy(
  value: LearningTaskSnapshotRead,
): LearningTaskSnapshot {
  const snapshot = learningTaskSnapshotReadSchema.parse(value);
  return learningTaskSnapshotSchema.parse({
    ...snapshot,
    output: snapshot.output === null ? null : projectTaskPayloadForLegacy(snapshot.output),
  });
}
export function projectTaskEventForLegacy(value: LearningTaskEventRead): LearningTaskEvent {
  const event = learningTaskEventReadSchema.parse(value);
  return learningTaskEventSchema.parse({
    ...event,
    payload: projectTaskPayloadForLegacy(event.payload),
  });
}
