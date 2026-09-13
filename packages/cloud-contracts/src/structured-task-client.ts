import { createTaskClient, type LearningTaskTransport } from "./learning-task-client-core.js";
import { createTaskSseDecoder } from "./learning-task-sse-decoder.js";
import {
  learningTaskCommandReadSchema,
  learningTaskSnapshotReadSchema,
  learningTaskEventReadSchema,
  type LearningTaskCommandRead,
  type LearningTaskPayloadRead,
} from "./structured-learning-tasks.js";
import { structuredTeachingAccept } from "./structured-teaching-requests.js";
const protocol = {
  command: learningTaskCommandReadSchema,
  snapshot: learningTaskSnapshotReadSchema,
  event: learningTaskEventReadSchema,
  jsonAccept: structuredTeachingAccept.json,
  eventStreamAccept: structuredTeachingAccept.eventStream,
};
export function createStructuredLearningTaskClient(transport: LearningTaskTransport) {
  return createTaskClient<LearningTaskCommandRead, LearningTaskPayloadRead>(transport, protocol);
}
export function createStructuredLearningTaskSseDecoder(taskId: string, initialCursor = 0) {
  return createTaskSseDecoder<LearningTaskPayloadRead>(taskId, initialCursor, protocol);
}
export type StructuredLearningTaskClient = ReturnType<typeof createStructuredLearningTaskClient>;
