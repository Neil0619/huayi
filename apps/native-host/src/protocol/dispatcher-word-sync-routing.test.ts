import { describe, expect, it, vi } from "vitest";

import type { HostEvent } from "@huayi/protocol";

import { validResult } from "./dispatcher-test-helpers.js";
import { NativeMessageDispatcher, type WordSyncServiceLike } from "./dispatcher.js";

function createDispatcher(wordSyncService: WordSyncServiceLike): NativeMessageDispatcher {
  return new NativeMessageDispatcher({
    healthCheck: async () => ({
      codexVersion: "codex-cli 0.144.1",
      model: "gpt-5.4-mini",
      provider: "codex" as const,
    }),
    provider: {
      analyze: async () => validResult,
      warmup: async () => undefined,
    },
    wordSyncService,
  });
}

describe("NativeMessageDispatcher word-sync service routing", () => {
  it("routes all word-sync v6 requests through the independent sync service", async () => {
    const events: HostEvent[] = [];
    const status = {
      historyComplete: true,
      lastPollSucceeded: true,
      pendingCount: 1,
      pollDue: false,
      scanInProgress: false,
      skippedCount: 0,
      unresolvedCount: 1,
    };
    const wordSyncService: WordSyncServiceLike = {
      listUnresolved: vi.fn(async (offset: number) => ({
        items: [
          {
            candidates: [],
            lastTargetWord: "splendidly",
            reason: "no-lemma" as const,
            sourceWord: "splendidly",
          },
        ],
        offset,
        totalCount: 1,
      })),
      discardAllUnresolved: vi.fn(async () => ({
        discardedCount: 1,
        pendingCount: 0,
        unresolvedCount: 0,
      })),
      discardUnresolved: vi.fn(async () => ({
        discardedCount: 1,
        pendingCount: 0,
        unresolvedCount: 0,
      })),
      poll: vi.fn(async () => status),
      prepareBatch: vi.fn(async () => ({
        batchId: "batch-1",
        items: [
          {
            attempt: "original" as const,
            sourceWords: ["investigation"],
            targetWord: "investigation",
          },
        ],
        pendingAfterBatch: 0,
      })),
      requeueUnresolved: vi.fn(async () => ({
        pendingCount: 1,
        requeuedCount: 1,
        resolvedCount: 0,
        unresolvedCount: 0,
      })),
      resolveBatch: vi.fn(async (batchId) => ({
        batchId,
        pendingCount: 0,
        resolvedCount: 1,
        retryCount: 0,
        unresolved: [],
        unresolvedCount: 1,
      })),
      status: vi.fn(async () => status),
    };
    const dispatcher = createDispatcher(wordSyncService);
    const emit = (event: HostEvent) => events.push(event);
    dispatcher.dispatch(
      { requestId: "sync-status", schemaVersion: 6, type: "word-sync-status" },
      emit,
    );
    dispatcher.dispatch({ requestId: "sync-poll", schemaVersion: 6, type: "word-sync-poll" }, emit);
    dispatcher.dispatch(
      { requestId: "sync-prepare", schemaVersion: 6, type: "word-sync-prepare-batch" },
      emit,
    );
    dispatcher.dispatch(
      {
        batchId: "batch-1",
        rejectedTargets: ["orbiting"],
        requestId: "sync-resolve",
        schemaVersion: 6,
        type: "word-sync-resolve-batch",
      },
      emit,
    );
    dispatcher.dispatch(
      {
        limit: 100,
        offset: 0,
        requestId: "sync-list",
        schemaVersion: 6,
        type: "word-sync-list-unresolved",
      },
      emit,
    );
    dispatcher.dispatch(
      {
        items: [{ sourceWord: "splendidly", targetWord: "splendid" }],
        requestId: "sync-requeue",
        schemaVersion: 6,
        type: "word-sync-requeue-unresolved",
      },
      emit,
    );
    dispatcher.dispatch(
      {
        requestId: "sync-discard",
        schemaVersion: 6,
        sourceWords: ["splendidly"],
        type: "word-sync-discard-unresolved",
      },
      emit,
    );
    dispatcher.dispatch(
      {
        confirm: true,
        requestId: "sync-discard-all",
        schemaVersion: 6,
        type: "word-sync-discard-all-unresolved",
      },
      emit,
    );
    await vi.waitFor(() => expect(events).toHaveLength(8));
    expect(events.map((event) => event.type).sort()).toEqual([
      "word-sync-batch",
      "word-sync-batch-resolved",
      "word-sync-status",
      "word-sync-status",
      "word-sync-unresolved-discarded",
      "word-sync-unresolved-discarded",
      "word-sync-unresolved-list",
      "word-sync-unresolved-requeued",
    ]);
    expect(wordSyncService.resolveBatch).toHaveBeenCalledWith(
      "batch-1",
      ["orbiting"],
      expect.any(AbortSignal),
    );
    expect(wordSyncService.discardUnresolved).toHaveBeenCalledWith(
      ["splendidly"],
      expect.any(AbortSignal),
    );
    expect(wordSyncService.discardAllUnresolved).toHaveBeenCalledWith(expect.any(AbortSignal));
    dispatcher.dispose();
  });
});
