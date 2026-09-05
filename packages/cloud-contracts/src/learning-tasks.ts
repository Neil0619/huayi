import { z } from "zod/v3";
import { analysisEventSchema, startAnalysisRequestSchema } from "./analysis-contracts.js";
import {
  extensionQueryEventSchema,
  extensionQueryRequestSchema,
  studyCaptureAnalyzeRequestSchema,
} from "./extension-learning-contracts.js";
import { resourceIdSchema } from "./common-contracts.js";
import {
  duplicateSuggestionsRequestSchema,
  duplicateSuggestionsResponseSchema,
} from "./learning-contracts.js";
import {
  startSentenceSessionRequestSchema,
  startDialogueSessionRequestSchema,
  submitPracticeAttemptRequestSchema,
  submitDialogueTurnRequestSchema,
  finishPracticeSessionRequestSchema,
  retryPracticeFeedbackRequestSchema,
  retryDialogueAssistantRequestSchema,
  practiceSessionResponseSchema,
} from "./practice-contracts.js";

const version = z.literal(2);
export const learningTaskCommandSchema = z.discriminatedUnion("kind", [
  z.strictObject({ version, kind: z.literal("instant-query"), input: extensionQueryRequestSchema }),
  z.strictObject({ version, kind: z.literal("analysis"), input: startAnalysisRequestSchema }),
  z.strictObject({
    version,
    kind: z.literal("capture-analysis"),
    captureId: resourceIdSchema,
    input: studyCaptureAnalyzeRequestSchema,
  }),
  z.strictObject({
    version,
    kind: z.literal("sentence-start"),
    sessionId: resourceIdSchema.optional(),
    input: startSentenceSessionRequestSchema,
  }),
  z.strictObject({
    version,
    kind: z.literal("sentence-submit"),
    sessionId: resourceIdSchema,
    input: submitPracticeAttemptRequestSchema,
  }),
  z.strictObject({
    version,
    kind: z.literal("sentence-feedback-retry"),
    sessionId: resourceIdSchema,
    attemptId: resourceIdSchema,
    input: retryPracticeFeedbackRequestSchema,
  }),
  z.strictObject({
    version,
    kind: z.literal("dialogue-start"),
    input: startDialogueSessionRequestSchema,
  }),
  z.strictObject({
    version,
    kind: z.literal("dialogue-turn"),
    sessionId: resourceIdSchema,
    input: submitDialogueTurnRequestSchema,
  }),
  z.strictObject({
    version,
    kind: z.literal("dialogue-finish"),
    sessionId: resourceIdSchema,
    input: finishPracticeSessionRequestSchema,
  }),
  z.strictObject({
    version,
    kind: z.literal("dialogue-retry"),
    sessionId: resourceIdSchema,
    input: retryDialogueAssistantRequestSchema,
  }),
  z.strictObject({
    version,
    kind: z.literal("duplicate-suggestions"),
    itemId: resourceIdSchema,
    input: duplicateSuggestionsRequestSchema,
  }),
]);
export type LearningTaskCommand = z.infer<typeof learningTaskCommandSchema>;
export const learningTaskPayloadSchema = z.union([
  analysisEventSchema,
  extensionQueryEventSchema,
  z.strictObject({
    type: z.literal("practice.preview"),
    section: z.enum(["prompt", "feedback", "assistantTurn", "opener", "summary"]),
    text: z.string().min(1).max(4096),
    sequence: z.number().int().nonnegative(),
  }),
  z.strictObject({ type: z.literal("practice.updated"), session: practiceSessionResponseSchema }),
  z.strictObject({
    type: z.literal("duplicates.completed"),
    result: duplicateSuggestionsResponseSchema,
  }),
]);
export type LearningTaskPayload = z.infer<typeof learningTaskPayloadSchema>;
export const learningTaskStateSchema = z.enum([
  "queued",
  "running",
  "cancelling",
  "completed",
  "failed",
  "cancelled",
  "unknown",
]);
export type LearningTaskState = z.infer<typeof learningTaskStateSchema>;
export const learningTaskErrorSchema = z.strictObject({
  code: z.enum([
    "cancelled",
    "model_timeout",
    "model_unavailable",
    "model_response_invalid",
    "model_output_invalid",
    "quota_exhausted",
    "generation_busy",
    "revision_conflict",
    "not_found",
    "forbidden",
    "outcome_unknown",
    "internal_error",
  ]),
  diagnosticId: resourceIdSchema,
});
export const learningTaskSnapshotSchema = z.strictObject({
  version,
  id: resourceIdSchema,
  kind: z.string().min(1).max(40),
  subjectId: resourceIdSchema.nullable(),
  state: learningTaskStateSchema,
  cursor: z.number().int().nonnegative(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
  error: learningTaskErrorSchema.nullable(),
  output: learningTaskPayloadSchema.nullable(),
  timings: z
    .record(z.number().nonnegative().finite())
    .refine((value) => Object.keys(value).length <= 16),
});
export type LearningTaskSnapshot = z.infer<typeof learningTaskSnapshotSchema>;
export const learningTaskEventSchema = z.strictObject({
  version,
  taskId: resourceIdSchema,
  cursor: z.number().int().positive(),
  payload: learningTaskPayloadSchema,
});
export type LearningTaskEvent = z.infer<typeof learningTaskEventSchema>;
export const learningTaskEventsResponseSchema = z.strictObject({
  snapshot: learningTaskSnapshotSchema,
  events: z.array(learningTaskEventSchema).max(128),
});
export const learningTaskRoutes = Object.freeze({
  submit: "/v2/learning-tasks",
  list: "/v2/learning-tasks",
  detail: "/v2/learning-tasks/:id",
  events: "/v2/learning-tasks/:id/events",
  cancel: "/v2/learning-tasks/:id/cancel",
  worker: "/internal/learning-tasks/run",
});
