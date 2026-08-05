import { describe, expect, it, vi } from "vitest";

import type { HostEvent, HostRequest } from "@huayi/protocol";

import type { NativeDisconnect, NativeTransport } from "./native-transport.js";
import {
  SHANBAY_COLLECTION_URL,
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
}

function createFixture() {
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
    schemaVersion: 6,
    skippedCount: 0,
    type: "word-sync-status",
    unresolvedCount: 0,
    ...overrides,
  } as HostEvent;
}

function batchEvent(requestId: string): HostEvent {
  return {
    batchId: "batch-1",
    items: [
      {
        attempt: "original",
        sourceWords: ["investigation"],
        targetWord: "investigation",
      },
    ],
    pendingAfterBatch: 3,
    requestId,
    schemaVersion: 6,
    type: "word-sync-batch",
  };
}

describe("WordSyncCoordinator overdue polling", () => {
  it("polls overdue Eudic words before preparing an action-click batch", () => {
    const { browser, coordinator, transport } = createFixture();

    coordinator.handleActionClick();
    expect(transport.requests[0]).toMatchObject({ type: "word-sync-prepare-batch" });

    transport.emit(statusEvent("sync-1", { pollDue: true }));
    expect(transport.requests[1]).toMatchObject({ type: "word-sync-poll" });
    expect(browser.createTab).not.toHaveBeenCalled();

    transport.emit(statusEvent("sync-2", { pendingCount: 4 }));
    expect(transport.requests[2]).toMatchObject({ type: "word-sync-prepare-batch" });

    transport.emit(batchEvent("sync-3"));
    expect(browser.createTab).toHaveBeenCalledWith(SHANBAY_COLLECTION_URL);
    coordinator.dispose();
  });

  it("finishes a persisted multi-request scan before preparing the clicked batch", () => {
    const { browser, coordinator, transport } = createFixture();

    coordinator.handleActionClick();
    transport.emit(statusEvent("sync-1", { pollDue: true }));
    transport.emit(statusEvent("sync-2", { pollDue: true, scanInProgress: true }));

    expect(transport.requests.map((request) => request.type)).toEqual([
      "word-sync-prepare-batch",
      "word-sync-poll",
      "word-sync-poll",
    ]);
    expect(browser.createTab).not.toHaveBeenCalled();

    transport.emit(statusEvent("sync-3", { pendingCount: 4 }));
    expect(transport.requests[3]).toMatchObject({ type: "word-sync-prepare-batch" });
    coordinator.dispose();
  });

  it("attaches an action click to an already running daily poll", () => {
    const { coordinator, transport } = createFixture();

    coordinator.handleAlarm(WORD_SYNC_DAILY_ALARM);
    coordinator.handleActionClick();
    transport.emit(statusEvent("sync-2", { pollDue: true }));

    expect(transport.requests.map((request) => request.type)).toEqual([
      "word-sync-poll",
      "word-sync-prepare-batch",
    ]);

    transport.emit(statusEvent("sync-1", { pendingCount: 4 }));
    expect(transport.requests[2]).toMatchObject({ type: "word-sync-prepare-batch" });
    coordinator.dispose();
  });
});
