import { describe, expect, it, vi } from "vitest";

import type { HostEvent } from "@huayi/protocol";

import type { AnalysisProvider } from "../provider/analysis-provider.js";
import { validResult } from "./dispatcher-test-helpers.js";
import { NativeMessageDispatcher } from "./dispatcher.js";
import type { WordSyncServiceLike } from "./dispatcher.js";

interface DispatcherOptions {
  maximumConcurrency?: number;
  provider?: AnalysisProvider;
}

function deferred<T>() {
  let resolvePromise: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve: (value: T) => {
      if (resolvePromise === undefined) {
        throw new Error("Deferred promise was not initialized.");
      }
      resolvePromise(value);
    },
  };
}

function createDispatcher(
  wordSyncService: WordSyncServiceLike,
  options: DispatcherOptions = {},
): NativeMessageDispatcher {
  const provider: AnalysisProvider = options.provider ?? {
    analyze: async () => validResult,
    warmup: async () => undefined,
  };
  return new NativeMessageDispatcher({
    healthCheck: async () => ({
      codexVersion: "codex-cli 0.144.1",
      model: "gpt-5.4-mini",
      provider: "codex" as const,
    }),
    ...(options.maximumConcurrency === undefined
      ? {}
      : { maximumConcurrency: options.maximumConcurrency }),
    provider,
    wordSyncService,
  });
}

describe("NativeMessageDispatcher word-sync routing", () => {
  it("routes all eight word-sync request types through the global request queue", async () => {
    const blocker = deferred<typeof validResult>();
    const events: HostEvent[] = [];
    const status = {
      historyComplete: true,
      lastPollSucceeded: true,
      pendingCount: 0,
      pollDue: false,
      scanInProgress: false,
      skippedCount: 0,
      unresolvedCount: 0,
    };
    const wordSyncService: WordSyncServiceLike = {
      discardAllUnresolved: vi.fn(async () => ({
        discardedCount: 0,
        pendingCount: 0,
        unresolvedCount: 0,
      })),
      discardUnresolved: vi.fn(async () => ({
        discardedCount: 0,
        pendingCount: 0,
        unresolvedCount: 0,
      })),
      listUnresolved: vi.fn(async () => ({
        items: [],
        offset: 0,
        totalCount: 0,
      })),
      poll: vi.fn(async () => status),
      prepareBatch: vi.fn(async () => ({
        batchId: "batch-queued",
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
        pendingCount: 0,
        requeuedCount: 0,
        resolvedCount: 0,
        unresolvedCount: 0,
      })),
      resolveBatch: vi.fn(async () => ({
        batchId: "batch-queued",
        pendingCount: 0,
        resolvedCount: 0,
        retryCount: 0,
        unresolved: [],
        unresolvedCount: 0,
      })),
      status: vi.fn(async () => status),
    };
    const dispatcher = createDispatcher(wordSyncService, {
      maximumConcurrency: 1,
      provider: {
        analyze: async () => blocker.promise,
        warmup: async () => undefined,
      },
    });
    dispatcher.dispatch(
      {
        action: "translate",
        context: "The investigation continues.",
        requestId: "queue-blocker",
        schemaVersion: 7,
        selection: "investigation",
        selectionKind: "word",
        sentenceContext: null,
        targetLanguage: "zh-CN",
        type: "analyze",
      },
      (event) => events.push(event),
    );
    const requests = [
      { requestId: "sync-status-q", schemaVersion: 7, type: "word-sync-status" },
      { requestId: "sync-poll-q", schemaVersion: 7, type: "word-sync-poll" },
      { requestId: "sync-prepare-q", schemaVersion: 7, type: "word-sync-prepare-batch" },
      {
        batchId: "batch-queued",
        rejectedTargets: [],
        requestId: "sync-resolve-q",
        schemaVersion: 7,
        type: "word-sync-resolve-batch",
      },
      {
        limit: 100,
        offset: 0,
        requestId: "sync-list-q",
        schemaVersion: 7,
        type: "word-sync-list-unresolved",
      },
      {
        items: [{ sourceWord: "splendidly", targetWord: "splendid" }],
        requestId: "sync-requeue-q",
        schemaVersion: 7,
        type: "word-sync-requeue-unresolved",
      },
      {
        requestId: "sync-discard-q",
        schemaVersion: 7,
        sourceWords: ["splendidly"],
        type: "word-sync-discard-unresolved",
      },
      {
        confirm: true,
        requestId: "sync-discard-all-q",
        schemaVersion: 7,
        type: "word-sync-discard-all-unresolved",
      },
    ] as const;
    requests.forEach((request) => dispatcher.dispatch(request, (event) => events.push(event)));

    Object.values(wordSyncService).forEach((operation) => {
      expect(operation).not.toHaveBeenCalled();
    });

    blocker.resolve(validResult);
    await vi.waitFor(() =>
      expect(
        events.filter((event) => event.requestId.startsWith("sync-") && event.type !== "progress"),
      ).toHaveLength(8),
    );
    expect(wordSyncService.status).toHaveBeenCalledWith(expect.any(AbortSignal));
    expect(wordSyncService.poll).toHaveBeenCalledWith(expect.any(AbortSignal));
    expect(wordSyncService.prepareBatch).toHaveBeenCalledWith(expect.any(AbortSignal));
    expect(wordSyncService.resolveBatch).toHaveBeenCalledWith(
      "batch-queued",
      [],
      expect.any(AbortSignal),
    );
    expect(wordSyncService.listUnresolved).toHaveBeenCalledWith(0, 100, expect.any(AbortSignal));
    expect(wordSyncService.requeueUnresolved).toHaveBeenCalledWith(
      [{ sourceWord: "splendidly", targetWord: "splendid" }],
      expect.any(AbortSignal),
    );
    expect(wordSyncService.discardUnresolved).toHaveBeenCalledWith(
      ["splendidly"],
      expect.any(AbortSignal),
    );
    expect(wordSyncService.discardAllUnresolved).toHaveBeenCalledWith(expect.any(AbortSignal));
    dispatcher.dispose();
  });

  it("cancels pending and running non-poll requests once without late success terminals", async () => {
    const prepare = deferred<Awaited<ReturnType<WordSyncServiceLike["prepareBatch"]>>>();
    const events: HostEvent[] = [];
    let prepareSignal: AbortSignal | undefined;
    const status = {
      historyComplete: true,
      lastPollSucceeded: true,
      pendingCount: 0,
      pollDue: false,
      scanInProgress: false,
      skippedCount: 0,
      unresolvedCount: 0,
    };
    const wordSyncService: WordSyncServiceLike = {
      discardAllUnresolved: async () => ({
        discardedCount: 0,
        pendingCount: 0,
        unresolvedCount: 0,
      }),
      discardUnresolved: async () => ({
        discardedCount: 0,
        pendingCount: 0,
        unresolvedCount: 0,
      }),
      listUnresolved: async () => ({ items: [], offset: 0, totalCount: 0 }),
      poll: async () => status,
      prepareBatch: vi.fn((signal: AbortSignal) => {
        prepareSignal = signal;
        return prepare.promise;
      }),
      requeueUnresolved: async () => ({
        pendingCount: 0,
        requeuedCount: 0,
        resolvedCount: 0,
        unresolvedCount: 0,
      }),
      resolveBatch: vi.fn(async () => ({
        batchId: "batch-pending",
        pendingCount: 0,
        resolvedCount: 0,
        retryCount: 0,
        unresolved: [],
        unresolvedCount: 0,
      })),
      status: async () => status,
    };
    const dispatcher = createDispatcher(wordSyncService, { maximumConcurrency: 1 });
    const emit = (event: HostEvent) => events.push(event);

    dispatcher.dispatch(
      { requestId: "prepare-running", schemaVersion: 7, type: "word-sync-prepare-batch" },
      emit,
    );
    await vi.waitFor(() => expect(wordSyncService.prepareBatch).toHaveBeenCalledOnce());
    dispatcher.dispatch(
      {
        batchId: "batch-pending",
        rejectedTargets: [],
        requestId: "resolve-pending",
        schemaVersion: 7,
        type: "word-sync-resolve-batch",
      },
      emit,
    );
    expect(wordSyncService.resolveBatch).not.toHaveBeenCalled();

    for (const targetRequestId of ["resolve-pending", "prepare-running"] as const) {
      dispatcher.dispatch(
        {
          requestId: `cancel-${targetRequestId}`,
          schemaVersion: 7,
          targetRequestId,
          type: "cancel",
        },
        emit,
      );
      dispatcher.dispatch(
        {
          requestId: `cancel-${targetRequestId}-again`,
          schemaVersion: 7,
          targetRequestId,
          type: "cancel",
        },
        emit,
      );
    }
    expect(prepareSignal?.aborted).toBe(true);
    prepare.resolve({
      batchId: "late-batch",
      items: [],
      pendingAfterBatch: 0,
    });
    await Promise.resolve();
    await Promise.resolve();

    for (const requestId of ["resolve-pending", "prepare-running"]) {
      expect(events.filter((event) => event.requestId === requestId)).toEqual([
        expect.objectContaining({
          error: expect.objectContaining({ code: "CANCELLED" }),
          type: "error",
        }),
      ]);
    }
    expect(wordSyncService.resolveBatch).not.toHaveBeenCalled();
    expect(events.some((event) => event.type === "word-sync-batch")).toBe(false);
    expect(events.some((event) => event.type === "word-sync-batch-resolved")).toBe(false);
    dispatcher.dispose();
  });
});
