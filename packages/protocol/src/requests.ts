import { z } from "zod";

import {
  MAX_CONTEXT_LENGTH,
  MAX_REQUEST_ID_LENGTH,
  MAX_SELECTION_LENGTH,
  SCHEMA_VERSION,
} from "./limits.js";

export const analyzeActionSchema = z.enum(["translate", "explain"]);
export type AnalyzeAction = z.infer<typeof analyzeActionSchema>;

export const selectionKindSchema = z.enum(["word", "phrase", "sentence", "paragraph"]);
export type SelectionKind = z.infer<typeof selectionKindSchema>;

export const requestIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(MAX_REQUEST_ID_LENGTH)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);

const schemaVersionSchema = z.literal(SCHEMA_VERSION);

const analyzeRequestObjectSchema = z.strictObject({
  action: analyzeActionSchema,
  context: z.string().max(MAX_CONTEXT_LENGTH),
  requestId: requestIdSchema,
  schemaVersion: schemaVersionSchema,
  selection: z.string().trim().min(1).max(MAX_SELECTION_LENGTH),
  selectionKind: selectionKindSchema,
  targetLanguage: z.literal("zh-CN"),
  type: z.literal("analyze"),
});

function rejectParagraphExplanation(
  request: z.infer<typeof analyzeRequestObjectSchema>,
  context: z.core.$RefinementCtx,
) {
  if (request.action === "explain" && request.selectionKind === "paragraph") {
    context.addIssue({
      code: "custom",
      message: "Paragraph selections support translation only.",
      path: ["action"],
    });
  }
}

export const analyzeRequestSchema = analyzeRequestObjectSchema.superRefine(
  rejectParagraphExplanation,
);
export type AnalyzeRequest = z.infer<typeof analyzeRequestSchema>;

export const healthRequestSchema = z.strictObject({
  requestId: requestIdSchema,
  schemaVersion: schemaVersionSchema,
  type: z.literal("health"),
});
export type HealthRequest = z.infer<typeof healthRequestSchema>;

export const cancelRequestSchema = z.strictObject({
  requestId: requestIdSchema,
  schemaVersion: schemaVersionSchema,
  targetRequestId: requestIdSchema,
  type: z.literal("cancel"),
});
export type CancelRequest = z.infer<typeof cancelRequestSchema>;

export const hostRequestSchema = z
  .discriminatedUnion("type", [
    healthRequestSchema,
    analyzeRequestObjectSchema,
    cancelRequestSchema,
  ])
  .superRefine((request, context) => {
    if (request.type === "analyze") {
      rejectParagraphExplanation(request, context);
    }
  });
export type HostRequest = z.infer<typeof hostRequestSchema>;
