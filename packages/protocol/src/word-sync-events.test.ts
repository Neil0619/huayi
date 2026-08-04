import { describe, expect, it } from "vitest";

import {
  hostEventSchema,
  wordSyncBatchEventSchema,
  wordSyncBatchResolvedEventSchema,
  wordSyncUnresolvedDiscardedEventSchema,
  wordSyncUnresolvedListEventSchema,
} from "./index.js";

describe("word sync events", () => {
  it("accepts strict status, batch, resolution, and unresolved-list terminals", () => {
    const status = {
      historyComplete: true,
      lastPollSucceeded: true,
      pendingCount: 2,
      pollDue: false,
      requestId: "sync-status-1",
      scanInProgress: false,
      schemaVersion: 6,
      skippedCount: 1,
      type: "word-sync-status",
      unresolvedCount: 1,
    } as const;
    const batch = {
      batchId: "batch-1",
      items: [
        {
          attempt: "lemma",
          sourceWords: ["orbiting"],
          targetWord: "orbit",
        },
      ],
      pendingAfterBatch: 0,
      requestId: "sync-batch-1",
      schemaVersion: 6,
      type: "word-sync-batch",
    } as const;
    const resolved = {
      batchId: "batch-1",
      pendingCount: 0,
      requestId: "sync-resolve-1",
      resolvedCount: 1,
      retryCount: 0,
      schemaVersion: 6,
      type: "word-sync-batch-resolved",
      unresolved: [],
      unresolvedCount: 0,
    } as const;
    const unresolvedList = {
      items: [
        {
          candidates: [],
          lastTargetWord: "splendidly",
          reason: "no-lemma",
          sourceWord: "splendidly",
        },
      ],
      offset: 0,
      requestId: "sync-list-1",
      schemaVersion: 6,
      totalCount: 1,
      type: "word-sync-unresolved-list",
    } as const;
    expect(hostEventSchema.parse(status)).toEqual(status);
    expect(wordSyncBatchEventSchema.parse(batch)).toEqual(batch);
    expect(wordSyncBatchResolvedEventSchema.parse(resolved)).toEqual(resolved);
    expect(wordSyncUnresolvedListEventSchema.parse(unresolvedList)).toEqual(unresolvedList);

    const discarded = {
      discardedCount: 1,
      pendingCount: 0,
      requestId: "sync-discard-1",
      schemaVersion: 6,
      type: "word-sync-unresolved-discarded",
      unresolvedCount: 0,
    } as const;
    expect(wordSyncUnresolvedDiscardedEventSchema.parse(discarded)).toEqual(discarded);
    expect(hostEventSchema.parse(discarded)).toEqual(discarded);
    expect(() =>
      wordSyncUnresolvedDiscardedEventSchema.parse({ ...discarded, resolvedCount: 1 }),
    ).toThrow();
  });

  it("rejects oversized, invalid, and non-strict batches", () => {
    const batch = {
      batchId: "batch-1",
      items: [
        {
          attempt: "original",
          sourceWords: ["valid"],
          targetWord: "valid",
        },
      ],
      pendingAfterBatch: 0,
      requestId: "sync-batch-1",
      schemaVersion: 6,
      type: "word-sync-batch",
    } as const;
    expect(() => wordSyncBatchEventSchema.parse({ ...batch, items: [] })).toThrow();
    expect(() =>
      wordSyncBatchEventSchema.parse({
        ...batch,
        items: [{ ...batch.items[0], targetWord: "two words" }],
      }),
    ).toThrow();
    expect(() =>
      wordSyncBatchEventSchema.parse({
        ...batch,
        items: [
          ...batch.items,
          { attempt: "original", sourceWords: ["other"], targetWord: "Valid" },
        ],
      }),
    ).toThrow();
    expect(() =>
      wordSyncBatchEventSchema.parse({ ...batch, url: "https://example.com" }),
    ).toThrow();
  });
});
