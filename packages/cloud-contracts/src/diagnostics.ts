import { z } from "zod/v3";
import { apiErrorCodeSchema, cursorSchema, paginationQueryFields } from "./common-contracts.js";
import { diagnosticIssueSchema } from "./diagnostic-issues.js";

export const diagnosticCodeSchema = z.enum([
  ...apiErrorCodeSchema.options,
  "internal_error",
  "outcome_unknown",
  "model_timeout",
  "model_response_invalid",
  "network-error",
  "provider-error",
  "invalid-response",
  "timeout",
  "configuration-required",
  "permission-required",
  "input-too-large",
]);
export const diagnosticOperationSchema = z.enum([
  "http",
  "instant-query",
  "analysis",
  "capture-analysis",
  "sentence-start",
  "sentence-submit",
  "sentence-feedback-retry",
  "dialogue-start",
  "dialogue-turn",
  "dialogue-retry",
  "dialogue-finish",
  "duplicate-suggestions",
  "learning-task",
]);
export const diagnosticStageSchema = z.enum([
  "http",
  "dispatch",
  "model",
  "transport",
  "task",
  "internal",
  "json",
  "output-schema",
  "unit-count",
  "content-schema",
  "missing-body",
  "read",
  "utf8",
  "wire-limit",
  "content-limit",
  "frame-limit",
  "sse-line",
  "frame-json",
  "frame-schema",
  "stream-identity",
  "usage",
  "after-done",
  "after-finish",
  "missing-done",
  "missing-identity",
  "missing-usage",
  "pending-terminal",
  "unterminated-frame",
  "missing-finish",
  "empty-content",
  "token-limit-empty-content",
  "token-limit-with-content",
  "non-stop-finish",
  "schema",
  "source-mismatch",
]);
export const diagnosticSourceSchema = z.enum(["api", "store", "web"]);
export const diagnosticSeveritySchema = z.enum(["warn", "error"]);
export const diagnosticVersionSchema = z.string().regex(/^\d{1,5}\.\d{1,5}\.\d{1,5}$/u);
export const diagnosticEventSchema = z.strictObject({
  version: z.literal(1),
  id: z.string().uuid(),
  occurredAt: z.string().datetime(),
  source: diagnosticSourceSchema,
  severity: diagnosticSeveritySchema,
  operation: diagnosticOperationSchema,
  code: diagnosticCodeSchema,
  stage: diagnosticStageSchema,
  requestId: z.string().uuid().optional(),
  taskId: z.string().uuid().optional(),
  generationId: z.string().uuid().optional(),
  diagnosticId: z.string().uuid().optional(),
  httpStatus: z.number().int().min(100).max(599).optional(),
  durationMs: z.number().int().min(0).max(86_400_000).optional(),
  provider: z.enum(["deepseek", "openai", "platform"]).optional(),
  clientVersion: diagnosticVersionSchema.optional(),
  release: z
    .string()
    .regex(/^[0-9a-f]{7,40}$/u)
    .optional(),
  attempt: z.enum(["first", "repair"]).optional(),
  issues: z.array(diagnosticIssueSchema).max(8).optional(),
  issuesTruncated: z.boolean().optional(),
});
export type DiagnosticEvent = z.infer<typeof diagnosticEventSchema>;
export const diagnosticUploadSchema = z.strictObject({
  consentVersion: z.literal(1),
  events: z.array(diagnosticEventSchema).min(1).max(20),
});
export const diagnosticQuerySchema = z.strictObject({
  ...paginationQueryFields,
  days: z.enum(["1", "7", "30"]).default("7"),
  source: diagnosticSourceSchema.optional(),
  severity: diagnosticSeveritySchema.optional(),
  code: diagnosticCodeSchema.optional(),
  operation: diagnosticOperationSchema.optional(),
  reference: z.string().uuid().optional(),
});
export type DiagnosticQuery = z.infer<typeof diagnosticQuerySchema>;
export const diagnosticRecordSchema = z.strictObject({
  event: diagnosticEventSchema,
  userId: z.string().uuid().nullable(),
  receivedAt: z.string().datetime({ offset: true }),
});
export type DiagnosticRecord = z.infer<typeof diagnosticRecordSchema>;
export const diagnosticListSchema = z.strictObject({
  items: z.array(diagnosticRecordSchema).max(100),
  nextCursor: cursorSchema.nullable(),
  summary: z.strictObject({
    events: z.number().int().nonnegative(),
    errors: z.number().int().nonnegative(),
    affectedUsers: z.number().int().nonnegative(),
    affectedRequests: z.number().int().nonnegative(),
    groups: z
      .array(
        z.strictObject({
          source: diagnosticSourceSchema,
          operation: diagnosticOperationSchema,
          code: diagnosticCodeSchema,
          count: z.number().int().positive(),
        }),
      )
      .max(20),
  }),
});
export type DiagnosticList = z.infer<typeof diagnosticListSchema>;
