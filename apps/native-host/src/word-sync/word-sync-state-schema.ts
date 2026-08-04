import {
  MAX_WORD_SYNC_BATCH_SIZE,
  MAX_WORD_SYNC_TOTAL_WORDS,
  englishWordSchema,
  errorCodeSchema,
  wordSyncAttemptSchema,
  wordSyncBatchIdSchema,
  wordSyncUnresolvedReasonSchema,
} from "@huayi/protocol";
import { z } from "zod";

const isoTimestampSchema = z.string().datetime({ offset: true });
const normalizedWordKeySchema = englishWordSchema.transform(normalizeWord);
const normalizedWordKeysSchema = z.array(normalizedWordKeySchema).max(MAX_WORD_SYNC_TOTAL_WORDS);

export function normalizeWord(value: string): string {
  return value.toLocaleLowerCase("en-US").replaceAll("’", "'");
}

const pendingWordSchema = z.strictObject({
  attempt: wordSyncAttemptSchema,
  attemptedTargetKeys: normalizedWordKeysSchema,
  sourceKey: normalizedWordKeySchema,
  sourceWord: englishWordSchema,
  targetKey: normalizedWordKeySchema,
  targetWord: englishWordSchema,
});

const scanSchema = z.strictObject({
  mode: z.enum(["full", "incremental"]),
  nextPage: z.number().int().min(0).max(50),
  recentDays: z.number().int().nonnegative(),
  startedAt: isoTimestampSchema,
});

const activeBatchSchema = z.strictObject({
  batchId: wordSyncBatchIdSchema,
  sourceKeys: z.array(normalizedWordKeySchema).min(1).max(MAX_WORD_SYNC_BATCH_SIZE),
});

const resolvedWordSchema = z.strictObject({
  outcome: z.enum([
    "delivered-original",
    "delivered-lemma",
    "delivered-manual",
    "covered-by-target",
    "discarded",
    "legacy-completed",
  ]),
  sourceKey: normalizedWordKeySchema,
  sourceWord: englishWordSchema,
  targetKey: normalizedWordKeySchema.nullable(),
  targetWord: englishWordSchema.nullable(),
});

const unresolvedWordSchema = z.strictObject({
  attemptedTargetKeys: normalizedWordKeysSchema,
  candidates: z.array(englishWordSchema).max(3),
  lastTargetKey: normalizedWordKeySchema,
  lastTargetWord: englishWordSchema,
  reason: wordSyncUnresolvedReasonSchema,
  sourceKey: normalizedWordKeySchema,
  sourceWord: englishWordSchema,
});

const legacyReauditProbeSchema = z.strictObject({
  sourceKey: normalizedWordKeySchema,
  status: z.enum(["queued", "accepted", "rejected"]),
});

function duplicate(values: readonly string[]): boolean {
  return new Set(values).size !== values.length;
}

function validateWordPair(
  key: string,
  word: string,
  context: z.core.$RefinementCtx,
  path: PropertyKey[],
): void {
  if (key !== normalizeWord(word)) {
    context.addIssue({
      code: "custom",
      message: "Word keys must match their normalized words.",
      path,
    });
  }
}

const wordSyncStateBaseSchema = z.strictObject({
  activeBatch: activeBatchSchema.nullable(),
  deliveredTargetKeys: normalizedWordKeysSchema,
  historyComplete: z.boolean(),
  lastErrorCode: errorCodeSchema.nullable(),
  lastPollSucceeded: z.boolean(),
  lastSuccessfulPollAt: isoTimestampSchema.nullable(),
  legacyReauditProbe: legacyReauditProbeSchema.nullable(),
  pending: z.array(pendingWordSchema).max(MAX_WORD_SYNC_TOTAL_WORDS),
  resolved: z.array(resolvedWordSchema).max(MAX_WORD_SYNC_TOTAL_WORDS),
  scan: scanSchema.nullable(),
  skippedCount: z.number().int().nonnegative().max(MAX_WORD_SYNC_TOTAL_WORDS),
  skippedKeys: z.array(z.string().regex(/^sha256:[a-f0-9]{64}$/u)).max(MAX_WORD_SYNC_TOTAL_WORDS),
  unresolved: z.array(unresolvedWordSchema).max(MAX_WORD_SYNC_TOTAL_WORDS),
});
type WordSyncStateBase = z.infer<typeof wordSyncStateBaseSchema>;

function validateWordSyncState(state: WordSyncStateBase, context: z.core.$RefinementCtx): void {
  const pendingKeys = state.pending.map((entry) => entry.sourceKey);
  const resolvedKeys = state.resolved.map((entry) => entry.sourceKey);
  const unresolvedKeys = state.unresolved.map((entry) => entry.sourceKey);
  const allSourceKeys = [...pendingKeys, ...resolvedKeys, ...unresolvedKeys];
  if (duplicate(allSourceKeys) || allSourceKeys.length > MAX_WORD_SYNC_TOTAL_WORDS) {
    context.addIssue({
      code: "custom",
      message: "Word sources must be unique across state lanes.",
      path: ["pending"],
    });
  }
  if (duplicate(state.deliveredTargetKeys)) {
    context.addIssue({
      code: "custom",
      message: "Delivered target words must be unique.",
      path: ["deliveredTargetKeys"],
    });
  }
  if (duplicate(state.skippedKeys) || state.skippedCount !== state.skippedKeys.length) {
    context.addIssue({
      code: "custom",
      message: "Skipped word state is inconsistent.",
      path: ["skippedKeys"],
    });
  }

  state.pending.forEach((entry, index) => {
    validateWordPair(entry.sourceKey, entry.sourceWord, context, ["pending", index, "sourceKey"]);
    validateWordPair(entry.targetKey, entry.targetWord, context, ["pending", index, "targetKey"]);
    if (
      duplicate(entry.attemptedTargetKeys) ||
      !entry.attemptedTargetKeys.includes(entry.targetKey)
    ) {
      context.addIssue({
        code: "custom",
        message: "Pending target history must be unique and include the current target.",
        path: ["pending", index, "attemptedTargetKeys"],
      });
    }
  });

  state.resolved.forEach((entry, index) => {
    validateWordPair(entry.sourceKey, entry.sourceWord, context, ["resolved", index, "sourceKey"]);
    const legacy = entry.outcome === "legacy-completed";
    const targetIsAbsent = entry.targetKey === null && entry.targetWord === null;
    const targetIsComplete = entry.targetKey !== null && entry.targetWord !== null;
    if ((legacy && !targetIsAbsent) || (!legacy && !targetIsComplete)) {
      context.addIssue({
        code: "custom",
        message: "Only legacy outcomes omit their delivered target.",
        path: ["resolved", index],
      });
    }
    if (entry.targetKey !== null && entry.targetWord !== null) {
      validateWordPair(entry.targetKey, entry.targetWord, context, [
        "resolved",
        index,
        "targetKey",
      ]);
    }
  });

  state.unresolved.forEach((entry, index) => {
    validateWordPair(entry.sourceKey, entry.sourceWord, context, [
      "unresolved",
      index,
      "sourceKey",
    ]);
    validateWordPair(entry.lastTargetKey, entry.lastTargetWord, context, [
      "unresolved",
      index,
      "lastTargetKey",
    ]);
    if (
      duplicate(entry.attemptedTargetKeys) ||
      !entry.attemptedTargetKeys.includes(entry.lastTargetKey) ||
      duplicate(entry.candidates.map(normalizeWord))
    ) {
      context.addIssue({
        code: "custom",
        message: "Unresolved target history or candidates are inconsistent.",
        path: ["unresolved", index],
      });
    }
  });

  if (state.activeBatch !== null) {
    const pending = new Set(pendingKeys);
    if (
      duplicate(state.activeBatch.sourceKeys) ||
      state.activeBatch.sourceKeys.some((key) => !pending.has(key))
    ) {
      context.addIssue({
        code: "custom",
        message: "Active batch must reference unique pending source words.",
        path: ["activeBatch"],
      });
    }
  }

  if (state.legacyReauditProbe !== null) {
    const { sourceKey, status } = state.legacyReauditProbe;
    const isQueued = pendingKeys.includes(sourceKey);
    const isAccepted = state.resolved.some(
      (entry) => entry.sourceKey === sourceKey && entry.outcome !== "legacy-completed",
    );
    const isRejected = isQueued || isAccepted || unresolvedKeys.includes(sourceKey);
    if (
      (status === "queued" && !isQueued) ||
      (status === "accepted" && !isAccepted) ||
      (status === "rejected" && !isRejected)
    ) {
      context.addIssue({
        code: "custom",
        message: "Legacy re-audit probe status does not match its word state.",
        path: ["legacyReauditProbe"],
      });
    }
  }
}

export const WORD_SYNC_DATA_SOURCE_VERSION = "eudic-default-wordbook-v1" as const;

export const wordSyncStateV2Schema = wordSyncStateBaseSchema
  .extend({ stateVersion: z.literal(2) })
  .superRefine(validateWordSyncState);
export type WordSyncStateV2 = z.infer<typeof wordSyncStateV2Schema>;

export const wordSyncStateSchema = wordSyncStateBaseSchema
  .extend({
    dataSourceVersion: z.literal(WORD_SYNC_DATA_SOURCE_VERSION),
    stateVersion: z.literal(3),
  })
  .superRefine(validateWordSyncState);
export type WordSyncState = z.infer<typeof wordSyncStateSchema>;

const legacyPendingWordSchema = z.strictObject({
  key: normalizedWordKeySchema,
  word: englishWordSchema,
});

const legacyActiveBatchSchema = z.strictObject({
  batchId: wordSyncBatchIdSchema,
  keys: z.array(normalizedWordKeySchema).min(1).max(MAX_WORD_SYNC_BATCH_SIZE),
});

export const legacyWordSyncStateSchema = z.strictObject({
  activeBatch: legacyActiveBatchSchema.nullable(),
  completedKeys: normalizedWordKeysSchema,
  historyComplete: z.boolean(),
  lastErrorCode: errorCodeSchema.nullable(),
  lastPollSucceeded: z.boolean(),
  lastSuccessfulPollAt: isoTimestampSchema.nullable(),
  pending: z.array(legacyPendingWordSchema).max(MAX_WORD_SYNC_TOTAL_WORDS),
  scan: scanSchema.nullable(),
  skippedCount: z.number().int().nonnegative().max(MAX_WORD_SYNC_TOTAL_WORDS),
  skippedKeys: z.array(z.string().regex(/^sha256:[a-f0-9]{64}$/u)).max(MAX_WORD_SYNC_TOTAL_WORDS),
  stateVersion: z.literal(1),
});
export type LegacyWordSyncState = z.infer<typeof legacyWordSyncStateSchema>;

export const persistedWordSyncStateSchema = z.union([
  wordSyncStateSchema,
  wordSyncStateV2Schema,
  legacyWordSyncStateSchema,
]);
export type PersistedWordSyncState = z.infer<typeof persistedWordSyncStateSchema>;

export function createInitialWordSyncState(): WordSyncState {
  return {
    activeBatch: null,
    dataSourceVersion: WORD_SYNC_DATA_SOURCE_VERSION,
    deliveredTargetKeys: [],
    historyComplete: false,
    lastErrorCode: null,
    lastPollSucceeded: true,
    lastSuccessfulPollAt: null,
    legacyReauditProbe: null,
    pending: [],
    resolved: [],
    scan: null,
    skippedCount: 0,
    skippedKeys: [],
    stateVersion: 3,
    unresolved: [],
  };
}
