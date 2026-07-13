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
const englishWordPattern = /^[A-Za-z]+(?:[-'’][A-Za-z]+)*$/u;
const hanCharacterPattern = /\p{Script=Han}/u;

export const englishWordSchema = z
  .string()
  .trim()
  .min(1)
  .max(MAX_SELECTION_LENGTH)
  .regex(englishWordPattern);

export const englishContextSchema = z
  .string()
  .trim()
  .min(1)
  .max(MAX_CONTEXT_LENGTH)
  .regex(/[A-Za-z]/u)
  .refine((value) => !hanCharacterPattern.test(value), "Context must not contain Han text.");

const analyzeRequestObjectSchema = z.strictObject({
  action: analyzeActionSchema,
  context: z.string().max(MAX_CONTEXT_LENGTH),
  requestId: requestIdSchema,
  schemaVersion: schemaVersionSchema,
  selection: z.string().trim().min(1).max(MAX_SELECTION_LENGTH),
  selectionKind: selectionKindSchema,
  sentenceContext: englishContextSchema.nullable(),
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

function rejectPassageSentenceContext(
  request: z.infer<typeof analyzeRequestObjectSchema>,
  context: z.core.$RefinementCtx,
) {
  if (
    (request.selectionKind === "sentence" || request.selectionKind === "paragraph") &&
    request.sentenceContext !== null
  ) {
    context.addIssue({
      code: "custom",
      message: "Sentence and paragraph selections require a null sentence context.",
      path: ["sentenceContext"],
    });
  }
}

function refineAnalyzeRequest(
  request: z.infer<typeof analyzeRequestObjectSchema>,
  context: z.core.$RefinementCtx,
) {
  rejectParagraphExplanation(request, context);
  rejectPassageSentenceContext(request, context);
}

export const analyzeRequestSchema = analyzeRequestObjectSchema.superRefine(refineAnalyzeRequest);
export type AnalyzeRequest = z.infer<typeof analyzeRequestSchema>;

export const addWordRequestSchema = z.strictObject({
  context: englishContextSchema,
  language: z.literal("en"),
  requestId: requestIdSchema,
  schemaVersion: schemaVersionSchema,
  type: z.literal("add-word"),
  word: englishWordSchema,
});
export type AddWordRequest = z.infer<typeof addWordRequestSchema>;

export const checkWordRequestSchema = z.strictObject({
  language: z.literal("en"),
  requestId: requestIdSchema,
  schemaVersion: schemaVersionSchema,
  type: z.literal("check-word"),
  word: englishWordSchema,
});
export type CheckWordRequest = z.infer<typeof checkWordRequestSchema>;

export const hostWorkRequestSchema = z
  .discriminatedUnion("type", [
    analyzeRequestObjectSchema,
    checkWordRequestSchema,
    addWordRequestSchema,
  ])
  .superRefine((request, context) => {
    if (request.type === "analyze") {
      refineAnalyzeRequest(request, context);
    }
  });
export type HostWorkRequest = z.infer<typeof hostWorkRequestSchema>;

export const healthRequestSchema = z.strictObject({
  requestId: requestIdSchema,
  schemaVersion: schemaVersionSchema,
  type: z.literal("health"),
});
export type HealthRequest = z.infer<typeof healthRequestSchema>;

export const warmupRequestSchema = z.strictObject({
  requestId: requestIdSchema,
  schemaVersion: schemaVersionSchema,
  type: z.literal("warmup"),
});
export type WarmupRequest = z.infer<typeof warmupRequestSchema>;

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
    warmupRequestSchema,
    analyzeRequestObjectSchema,
    checkWordRequestSchema,
    addWordRequestSchema,
    cancelRequestSchema,
  ])
  .superRefine((request, context) => {
    if (request.type === "analyze") {
      refineAnalyzeRequest(request, context);
    }
  });
export type HostRequest = z.infer<typeof hostRequestSchema>;
