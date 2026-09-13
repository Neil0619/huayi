import {
  learningTaskCommandSchema,
  learningTaskSnapshotSchema,
  learningTaskEventSchema,
  type LearningTaskCommand,
  type LearningTaskPayload,
} from "./learning-tasks.js";
import { createTaskClient, type LearningTaskTransport } from "./learning-task-client-core.js";
export { LearningTaskError } from "./learning-task-error.js";
export type { LearningTaskTransport };
export function createLearningTaskClient(transport: LearningTaskTransport) {
  return createTaskClient<LearningTaskCommand, LearningTaskPayload>(transport, {
    command: learningTaskCommandSchema,
    snapshot: learningTaskSnapshotSchema,
    event: learningTaskEventSchema,
    eventStreamAccept: "text/event-stream",
  });
}
export type LearningTaskClient = ReturnType<typeof createLearningTaskClient>;
