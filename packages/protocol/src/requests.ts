import { z } from "zod";

import {
  MAX_CONTEXT_LENGTH,
  MAX_REQUEST_ID_LENGTH,
  MAX_SELECTION_LENGTH,
  MAX_WORD_SYNC_BATCH_SIZE,
  MAX_WORD_SYNC_TOTAL_WORDS,
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

export const wordSyncBatchIdSchema = requestIdSchema;
export type WordSyncBatchId = z.infer<typeof wordSyncBatchIdSchema>;

function normalizedWord(value: string): string {
  return value.toLocaleLowerCase("en-US").replaceAll("’", "'");
}

function hasUniqueWords(values: readonly string[]): boolean {
  return new Set(values.map(normalizedWord)).size === values.length;
}

export const wordSyncStatusRequestSchema = z.strictObject({
  requestId: requestIdSchema,
  schemaVersion: schemaVersionSchema,
  type: z.literal("word-sync-status"),
});
export type WordSyncStatusRequest = z.infer<typeof wordSyncStatusRequestSchema>;

export const wordSyncPollRequestSchema = z.strictObject({
  requestId: requestIdSchema,
  schemaVersion: schemaVersionSchema,
  type: z.literal("word-sync-poll"),
});
export type WordSyncPollRequest = z.infer<typeof wordSyncPollRequestSchema>;

export const wordSyncPrepareBatchRequestSchema = z.strictObject({
  requestId: requestIdSchema,
  schemaVersion: schemaVersionSchema,
  type: z.literal("word-sync-prepare-batch"),
});
export type WordSyncPrepareBatchRequest = z.infer<typeof wordSyncPrepareBatchRequestSchema>;

export const wordSyncResolveBatchRequestSchema = z.strictObject({
  batchId: wordSyncBatchIdSchema,
  rejectedTargets: z
    .array(englishWordSchema)
    .max(MAX_WORD_SYNC_BATCH_SIZE)
    .refine(hasUniqueWords, "Rejected targets must be unique."),
  requestId: requestIdSchema,
  schemaVersion: schemaVersionSchema,
  type: z.literal("word-sync-resolve-batch"),
});
export type WordSyncResolveBatchRequest = z.infer<typeof wordSyncResolveBatchRequestSchema>;

export const wordSyncListUnresolvedRequestSchema = z.strictObject({
  limit: z.number().int().min(1).max(MAX_WORD_SYNC_BATCH_SIZE),
  offset: z.number().int().nonnegative().max(MAX_WORD_SYNC_TOTAL_WORDS),
  requestId: requestIdSchema,
  schemaVersion: schemaVersionSchema,
  type: z.literal("word-sync-list-unresolved"),
});
export type WordSyncListUnresolvedRequest = z.infer<typeof wordSyncListUnresolvedRequestSchema>;

const wordSyncRequeueItemSchema = z.strictObject({
  sourceWord: englishWordSchema,
  targetWord: englishWordSchema,
});

export const wordSyncRequeueUnresolvedRequestSchema = z
  .strictObject({
    items: z.array(wordSyncRequeueItemSchema).min(1).max(MAX_WORD_SYNC_BATCH_SIZE),
    requestId: requestIdSchema,
    schemaVersion: schemaVersionSchema,
    type: z.literal("word-sync-requeue-unresolved"),
  })
  .superRefine((request, context) => {
    if (!hasUniqueWords(request.items.map((item) => item.sourceWord))) {
      context.addIssue({
        code: "custom",
        message: "Requeued source words must be unique.",
        path: ["items"],
      });
    }
  });
export type WordSyncRequeueUnresolvedRequest = z.infer<
  typeof wordSyncRequeueUnresolvedRequestSchema
>;

export const wordSyncDiscardUnresolvedRequestSchema = z.strictObject({
  requestId: requestIdSchema,
  schemaVersion: schemaVersionSchema,
  sourceWords: z
    .array(englishWordSchema)
    .min(1)
    .max(MAX_WORD_SYNC_BATCH_SIZE)
    .refine(hasUniqueWords, "Discarded source words must be unique."),
  type: z.literal("word-sync-discard-unresolved"),
});
export type WordSyncDiscardUnresolvedRequest = z.infer<
  typeof wordSyncDiscardUnresolvedRequestSchema
>;

export const wordSyncDiscardAllUnresolvedRequestSchema = z.strictObject({
  confirm: z.literal(true),
  requestId: requestIdSchema,
  schemaVersion: schemaVersionSchema,
  type: z.literal("word-sync-discard-all-unresolved"),
});
export type WordSyncDiscardAllUnresolvedRequest = z.infer<
  typeof wordSyncDiscardAllUnresolvedRequestSchema
>;

export const wordSyncRequestSchema = z.discriminatedUnion("type", [
  wordSyncStatusRequestSchema,
  wordSyncPollRequestSchema,
  wordSyncPrepareBatchRequestSchema,
  wordSyncResolveBatchRequestSchema,
  wordSyncListUnresolvedRequestSchema,
  wordSyncRequeueUnresolvedRequestSchema,
  wordSyncDiscardUnresolvedRequestSchema,
  wordSyncDiscardAllUnresolvedRequestSchema,
]);
export type WordSyncRequest = z.infer<typeof wordSyncRequestSchema>;

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
    wordSyncStatusRequestSchema,
    wordSyncPollRequestSchema,
    wordSyncPrepareBatchRequestSchema,
    wordSyncResolveBatchRequestSchema,
    wordSyncListUnresolvedRequestSchema,
    wordSyncRequeueUnresolvedRequestSchema,
    wordSyncDiscardUnresolvedRequestSchema,
    wordSyncDiscardAllUnresolvedRequestSchema,
    cancelRequestSchema,
  ])
  .superRefine((request, context) => {
    if (request.type === "analyze") {
      refineAnalyzeRequest(request, context);
    }
  });
export type HostRequest = z.infer<typeof hostRequestSchema>;
