import { describe, expect, it, vi } from "vitest";

import type { HostEvent, HostRequest } from "@huayi/protocol";

import type { NativeDisconnect, NativeTransport } from "./native-transport.js";
import {
  SHANBAY_COLLECTION_URL,
  WORD_SYNC_CONTINUE_ALARM,
  WORD_SYNC_DAILY_ALARM,
  WordSyncCoordinator,
  type WordSyncBrowserApi,
} from "./word-sync-coordinator.js";

class FakeTransport implements NativeTransport {
  readonly requests: HostRequest[] = [];
  private readonly disconnectListeners = new Set<(disconnect: NativeDisconnect) => void>();
  private readonly eventListeners = new Set<(event: HostEvent) => void>();

  onDisconnect(listener: (disconnect: NativeDisconnect) => void): () => void {
    this.disconnectListeners.add(listener);
    return () => this.disconnectListeners.delete(listener);
  }

  onEvent(listener: (event: HostEvent) => void): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  send(request: HostRequest): void {
    this.requests.push(request);
  }

  emit(event: HostEvent): void {
    for (const listener of this.eventListeners) listener(event);
  }

  disconnect(disconnect: NativeDisconnect): void {
    for (const listener of this.disconnectListeners) listener(disconnect);
  }
}

function createFixture(options: { timeoutMs?: number } = {}) {
  let sequence = 0;
  const transport = new FakeTransport();
  const browser: WordSyncBrowserApi = {
    createAlarm: vi.fn(),
    getAlarm: vi.fn(async () => undefined),
    createTab: vi.fn(),
    sendToTab: vi.fn(),
    setBadgeText: vi.fn(),
    setTitle: vi.fn(),
  };
  const coordinator = new WordSyncCoordinator({
    browser,
    createRequestId: () => `sync-${++sequence}`,
    transport,
    ...options,
  });
  return { browser, coordinator, transport };
}

function statusEvent(requestId: string, overrides = {}): HostEvent {
  return {
    historyComplete: true,
    lastPollSucceeded: true,
    pendingCount: 0,
    pollDue: false,
    requestId,
    scanInProgress: false,
    schemaVersion: 7,
    skippedCount: 0,
    type: "word-sync-status",
    unresolvedCount: 0,
    ...overrides,
  } as HostEvent;
}

function batchEvent(requestId: string, batchId = "batch-1", pendingAfterBatch = 0): HostEvent {
  return {
    batchId,
    items: [
      {
        attempt: "original",
        sourceWords: [batchId === "batch-1" ? "investigation" : "second"],
        targetWord: batchId === "batch-1" ? "investigation" : "second",
      },
    ],
    pendingAfterBatch,
    requestId,
    schemaVersion: 7,
    type: "word-sync-batch",
  };
}

describe("WordSyncCoordinator", () => {
  it("opens Shanbay only when a batch exists and sends the durable batch after page readiness", () => {
    const { browser, coordinator, transport } = createFixture();
    coordinator.startManualSync();
    transport.emit(batchEvent("sync-1", "batch-1", 3));
    expect(browser.createTab).toHaveBeenCalledWith(SHANBAY_COLLECTION_URL);

    coordinator.handlePageReady(7);
    transport.emit(batchEvent("sync-2", "batch-1", 3));
    expect(browser.sendToTab).toHaveBeenCalledWith(
      7,
      expect.objectContaining({ type: "SHANBAY_SYNC_BATCH" }),
    );
    coordinator.dispose();
  });

  it("resolves the exact rejected subset before preparing the next batch in the same tab", async () => {
    const { browser, coordinator, transport } = createFixture();
    coordinator.resolveBatch(7, "batch-1", ["orbiting"]);
    expect(transport.requests[0]).toMatchObject({
      batchId: "batch-1",
      rejectedTargets: ["orbiting"],
      type: "word-sync-resolve-batch",
    });
    transport.emit({
      batchId: "batch-1",
      pendingCount: 2,
      requestId: "sync-1",
      resolvedCount: 1,
      retryCount: 1,
      schemaVersion: 7,
      type: "word-sync-batch-resolved",
      unresolved: [],
      unresolvedCount: 0,
    });
    await vi.waitFor(() =>
      expect(browser.sendToTab).toHaveBeenCalledWith(
        7,
        expect.objectContaining({ type: "SHANBAY_SYNC_RESOLVED" }),
      ),
    );
    expect(browser.sendToTab).toHaveBeenCalledWith(
      7,
      expect.objectContaining({ type: "SHANBAY_SYNC_RESOLVED" }),
    );
    await vi.waitFor(() =>
      expect(transport.requests[1]).toMatchObject({ type: "word-sync-prepare-batch" }),
    );
    transport.emit(batchEvent("sync-2", "batch-2"));
    expect(browser.sendToTab).toHaveBeenLastCalledWith(
      7,
      expect.objectContaining({
        event: expect.objectContaining({ batchId: "batch-2" }),
        type: "SHANBAY_SYNC_BATCH",
      }),
    );
    coordinator.dispose();
  });

  it("opens the unresolved panel from the attention badge and supports manual requeue", async () => {
    const { browser, coordinator, transport } = createFixture();
    coordinator.startManualSync();
    transport.emit(statusEvent("sync-1", { unresolvedCount: 2 }));
    expect(browser.createTab).toHaveBeenCalledWith(SHANBAY_COLLECTION_URL);

    coordinator.handlePageReady(7);
    transport.emit(statusEvent("sync-2", { unresolvedCount: 2 }));
    await vi.waitFor(() =>
      expect(transport.requests[2]).toMatchObject({
        limit: 100,
        offset: 0,
        type: "word-sync-list-unresolved",
      }),
    );
    transport.emit({
      items: [
        {
          candidates: [],
          lastTargetWord: "splendidly",
          reason: "no-lemma",
          sourceWord: "splendidly",
        },
      ],
      offset: 0,
      requestId: "sync-3",
      schemaVersion: 7,
      totalCount: 2,
      type: "word-sync-unresolved-list",
    });
    expect(browser.sendToTab).toHaveBeenLastCalledWith(
      7,
      expect.objectContaining({ type: "SHANBAY_SYNC_UNRESOLVED" }),
    );

    coordinator.requeueUnresolved(7, [{ sourceWord: "splendidly", targetWord: "splendid" }]);
    expect(transport.requests[3]).toMatchObject({ type: "word-sync-requeue-unresolved" });
    coordinator.dispose();
  });

  it("discards selected unresolved words durably and refreshes the remaining list", async () => {
    const { browser, coordinator, transport } = createFixture();

    coordinator.discardUnresolved(7, ["splendidly"]);
    expect(transport.requests[0]).toMatchObject({
      sourceWords: ["splendidly"],
      type: "word-sync-discard-unresolved",
    });
    transport.emit({
      discardedCount: 1,
      pendingCount: 0,
      requestId: "sync-1",
      schemaVersion: 7,
      type: "word-sync-unresolved-discarded",
      unresolvedCount: 10,
    });

    await vi.waitFor(() =>
      expect(browser.sendToTab).toHaveBeenCalledWith(
        7,
        expect.objectContaining({ type: "SHANBAY_SYNC_DISCARDED" }),
      ),
    );
    await vi.waitFor(() =>
      expect(transport.requests[1]).toMatchObject({
        limit: 100,
        offset: 0,
        type: "word-sync-list-unresolved",
      }),
    );
    expect(browser.setBadgeText).toHaveBeenLastCalledWith("!");
    coordinator.dispose();
  });

  it("uses an explicit confirmation request to discard all unresolved words", async () => {
    const { browser, coordinator, transport } = createFixture();

    coordinator.discardAllUnresolved(7);
    expect(transport.requests[0]).toMatchObject({
      confirm: true,
      type: "word-sync-discard-all-unresolved",
    });
    transport.emit({
      discardedCount: 11,
      pendingCount: 0,
      requestId: "sync-1",
      schemaVersion: 7,
      type: "word-sync-unresolved-discarded",
      unresolvedCount: 0,
    });

    await vi.waitFor(() =>
      expect(browser.sendToTab).toHaveBeenCalledWith(
        7,
        expect.objectContaining({
          event: expect.objectContaining({ discardedCount: 11, unresolvedCount: 0 }),
          type: "SHANBAY_SYNC_DISCARDED",
        }),
      ),
    );
    expect(transport.requests).toHaveLength(1);
    expect(browser.setBadgeText).toHaveBeenLastCalledWith("");
    coordinator.dispose();
  });

  it("keeps a known pending count visible when the Host disconnects", () => {
    const { browser, coordinator, transport } = createFixture();
    coordinator.initialize();
    transport.emit(statusEvent("sync-1", { pendingCount: 8 }));
    coordinator.startManualSync();
    transport.disconnect({ reason: "disconnected" });
    expect(browser.setBadgeText).toHaveBeenLastCalledWith("8");
    coordinator.dispose();
  });

  it("uses the durable post-resolution counts for later failure presentation", async () => {
    const { browser, coordinator, transport } = createFixture();
    coordinator.initialize();
    transport.emit(statusEvent("sync-1", { pendingCount: 8 }));
    coordinator.resolveBatch(7, "batch-1", []);
    transport.emit({
      batchId: "batch-1",
      pendingCount: 2,
      requestId: "sync-2",
      resolvedCount: 6,
      retryCount: 0,
      schemaVersion: 7,
      type: "word-sync-batch-resolved",
      unresolved: [],
      unresolvedCount: 1,
    });
    await vi.waitFor(() =>
      expect(browser.sendToTab).toHaveBeenCalledWith(
        7,
        expect.objectContaining({ type: "SHANBAY_SYNC_RESOLVED" }),
      ),
    );
    coordinator.startManualSync();
    transport.disconnect({ reason: "disconnected" });
    expect(browser.setBadgeText).toHaveBeenLastCalledWith("2");
    coordinator.dispose();
  });

  it("uses the exact badge cap and attention marker rules", () => {
    const { browser, coordinator, transport } = createFixture();
    coordinator.initialize();
    transport.emit(statusEvent("sync-1", { pendingCount: 1_000 }));
    expect(browser.setBadgeText).toHaveBeenLastCalledWith("999+");

    coordinator.handleStartup();
    transport.emit(
      statusEvent("sync-2", {
        historyComplete: false,
        lastPollSucceeded: false,
        pendingCount: 0,
        unresolvedCount: 3,
      }),
    );
    expect(browser.setBadgeText).toHaveBeenLastCalledWith("!");
    coordinator.dispose();
  });

  it("keeps the unresolved count in the title while presenting a pending batch", () => {
    const { browser, coordinator, transport } = createFixture();
    coordinator.initialize();
    transport.emit(statusEvent("sync-1", { pendingCount: 8, unresolvedCount: 3 }));
    coordinator.startManualSync();
    transport.emit(batchEvent("sync-2", "batch-1", 7));

    expect(browser.setTitle).toHaveBeenLastCalledWith(
      "语见：8 个生词待同步到扇贝；3 个词需要人工处理",
    );
    coordinator.dispose();
  });

  it("restores persisted status and schedules recovery after a retryable poll failure", () => {
    const { browser, coordinator, transport } = createFixture();
    coordinator.handleAlarm(WORD_SYNC_DAILY_ALARM);
    transport.emit({
      error: { code: "NETWORK_ERROR", message: "offline", retryable: true },
      requestId: "sync-1",
      schemaVersion: 7,
      type: "error",
    });
    expect(browser.createAlarm).toHaveBeenCalledWith(WORD_SYNC_CONTINUE_ALARM, {
      delayInMinutes: 1,
    });
    expect(transport.requests[1]).toMatchObject({ type: "word-sync-status" });
    transport.emit(statusEvent("sync-2", { lastPollSucceeded: false, pendingCount: 9 }));
    expect(browser.setBadgeText).toHaveBeenLastCalledWith("9");
    coordinator.dispose();
  });

  it("restores status and schedules recovery after a Native Host disconnect during polling", () => {
    const { browser, coordinator, transport } = createFixture();
    coordinator.handleAlarm(WORD_SYNC_DAILY_ALARM);

    transport.disconnect({ reason: "disconnected" });

    expect(browser.createAlarm).toHaveBeenCalledWith(WORD_SYNC_CONTINUE_ALARM, {
      delayInMinutes: 1,
    });
    expect(transport.requests[1]).toMatchObject({ type: "word-sync-status" });
    coordinator.dispose();
  });

  it("cancels a timed-out unresolved action once and ignores its late terminal event", () => {
    vi.useFakeTimers();
    const { browser, coordinator, transport } = createFixture({ timeoutMs: 100 });
    coordinator.discardUnresolved(7, ["splendidly"]);

    vi.advanceTimersByTime(100);

    expect(transport.requests).toHaveLength(2);
    expect(transport.requests[1]).toMatchObject({
      targetRequestId: "sync-1",
      type: "cancel",
    });
    expect(browser.sendToTab).toHaveBeenCalledTimes(1);
    expect(browser.sendToTab).toHaveBeenLastCalledWith(
      7,
      expect.objectContaining({ type: "SHANBAY_SYNC_ERROR" }),
    );
    transport.emit({
      discardedCount: 1,
      pendingCount: 0,
      requestId: "sync-1",
      schemaVersion: 7,
      type: "word-sync-unresolved-discarded",
      unresolvedCount: 0,
    });
    expect(browser.sendToTab).toHaveBeenCalledTimes(1);
    coordinator.dispose();
    vi.useRealTimers();
  });
});
