import { z } from "zod";

import { MAX_WORD_SYNC_BATCH_SIZE, MAX_WORD_SYNC_TOTAL_WORDS, SCHEMA_VERSION } from "./limits.js";
import { englishWordSchema, requestIdSchema, wordSyncBatchIdSchema } from "./requests.js";

const schemaVersionSchema = z.literal(SCHEMA_VERSION);
const wordSyncCountSchema = z.number().int().nonnegative().max(MAX_WORD_SYNC_TOTAL_WORDS);

export const wordSyncStatusEventSchema = z.strictObject({
  historyComplete: z.boolean(),
  lastPollSucceeded: z.boolean(),
  pendingCount: wordSyncCountSchema,
  pollDue: z.boolean(),
  requestId: requestIdSchema,
  scanInProgress: z.boolean(),
  schemaVersion: schemaVersionSchema,
  skippedCount: wordSyncCountSchema,
  type: z.literal("word-sync-status"),
  unresolvedCount: wordSyncCountSchema,
});
export type WordSyncStatusEvent = z.infer<typeof wordSyncStatusEventSchema>;

export const wordSyncAttemptSchema = z.enum(["original", "lemma", "manual"]);
export type WordSyncAttempt = z.infer<typeof wordSyncAttemptSchema>;

export const wordSyncBatchItemSchema = z.strictObject({
  attempt: wordSyncAttemptSchema,
  sourceWords: z.array(englishWordSchema).min(1).max(MAX_WORD_SYNC_BATCH_SIZE),
  targetWord: englishWordSchema,
});
export type WordSyncBatchItem = z.infer<typeof wordSyncBatchItemSchema>;

function normalizedWord(value: string): string {
  return value.toLocaleLowerCase("en-US").replaceAll("’", "'");
}

function duplicateWord(values: readonly string[]): boolean {
  return new Set(values.map(normalizedWord)).size !== values.length;
}

export const wordSyncBatchEventSchema = z
  .strictObject({
    batchId: wordSyncBatchIdSchema,
    items: z.array(wordSyncBatchItemSchema).min(1).max(MAX_WORD_SYNC_BATCH_SIZE),
    pendingAfterBatch: wordSyncCountSchema,
    requestId: requestIdSchema,
    schemaVersion: schemaVersionSchema,
    type: z.literal("word-sync-batch"),
  })
  .superRefine((event, context) => {
    if (duplicateWord(event.items.map((item) => item.targetWord))) {
      context.addIssue({
        code: "custom",
        message: "Batch target words must be unique.",
        path: ["items"],
      });
    }
    const sourceWords = event.items.flatMap((item) => item.sourceWords);
    if (sourceWords.length > MAX_WORD_SYNC_BATCH_SIZE || duplicateWord(sourceWords)) {
      context.addIssue({
        code: "custom",
        message: "Batch source words must be unique and bounded.",
        path: ["items"],
      });
    }
  });
export type WordSyncBatchEvent = z.infer<typeof wordSyncBatchEventSchema>;

export const wordSyncUnresolvedReasonSchema = z.enum([
  "no-lemma",
  "ambiguous-lemma",
  "shanbay-rejected-lemma",
  "shanbay-rejected-manual",
]);
export type WordSyncUnresolvedReason = z.infer<typeof wordSyncUnresolvedReasonSchema>;

export const wordSyncUnresolvedItemSchema = z.strictObject({
  candidates: z.array(englishWordSchema).max(3),
  lastTargetWord: englishWordSchema,
  reason: wordSyncUnresolvedReasonSchema,
  sourceWord: englishWordSchema,
});
export type WordSyncUnresolvedItem = z.infer<typeof wordSyncUnresolvedItemSchema>;

export const wordSyncBatchResolvedEventSchema = z.strictObject({
  batchId: wordSyncBatchIdSchema,
  pendingCount: wordSyncCountSchema,
  requestId: requestIdSchema,
  resolvedCount: wordSyncCountSchema,
  retryCount: wordSyncCountSchema,
  schemaVersion: schemaVersionSchema,
  type: z.literal("word-sync-batch-resolved"),
  unresolved: z.array(wordSyncUnresolvedItemSchema).max(MAX_WORD_SYNC_BATCH_SIZE),
  unresolvedCount: wordSyncCountSchema,
});
export type WordSyncBatchResolvedEvent = z.infer<typeof wordSyncBatchResolvedEventSchema>;

export const wordSyncUnresolvedListEventSchema = z.strictObject({
  items: z.array(wordSyncUnresolvedItemSchema).max(MAX_WORD_SYNC_BATCH_SIZE),
  offset: wordSyncCountSchema,
  requestId: requestIdSchema,
  schemaVersion: schemaVersionSchema,
  totalCount: wordSyncCountSchema,
  type: z.literal("word-sync-unresolved-list"),
});
export type WordSyncUnresolvedListEvent = z.infer<typeof wordSyncUnresolvedListEventSchema>;

export const wordSyncUnresolvedRequeuedEventSchema = z.strictObject({
  pendingCount: wordSyncCountSchema,
  requestId: requestIdSchema,
  requeuedCount: wordSyncCountSchema,
  resolvedCount: wordSyncCountSchema,
  schemaVersion: schemaVersionSchema,
  type: z.literal("word-sync-unresolved-requeued"),
  unresolvedCount: wordSyncCountSchema,
});
export type WordSyncUnresolvedRequeuedEvent = z.infer<typeof wordSyncUnresolvedRequeuedEventSchema>;

export const wordSyncUnresolvedDiscardedEventSchema = z.strictObject({
  discardedCount: wordSyncCountSchema,
  pendingCount: wordSyncCountSchema,
  requestId: requestIdSchema,
  schemaVersion: schemaVersionSchema,
  type: z.literal("word-sync-unresolved-discarded"),
  unresolvedCount: wordSyncCountSchema,
});
export type WordSyncUnresolvedDiscardedEvent = z.infer<
  typeof wordSyncUnresolvedDiscardedEventSchema
>;
