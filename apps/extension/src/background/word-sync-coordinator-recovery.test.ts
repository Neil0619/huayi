import { describe, expect, it, vi } from "vitest";

import type { HostEvent, HostRequest } from "@huayi/protocol";

import type { NativeDisconnect, NativeTransport } from "./native-transport.js";
import {
  WORD_SYNC_CONTINUE_ALARM,
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
    createRequestId: () => `sync-recovery-${++sequence}`,
    transport,
  });
  return { browser, coordinator, transport };
}

function statusEvent(requestId: string): HostEvent {
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
  };
}

describe("WordSyncCoordinator recovery", () => {
  it("fails closed when a mutation receives a status terminal", () => {
    const { browser, coordinator, transport } = createFixture();
    coordinator.resolveBatch(7, "batch-1", []);

    transport.emit(statusEvent("sync-recovery-1"));

    expect(browser.sendToTab).toHaveBeenCalledWith(
      7,
      expect.objectContaining({
        error: expect.objectContaining({ code: "INVALID_RESPONSE" }),
        type: "SHANBAY_SYNC_ERROR",
      }),
    );
    coordinator.dispose();
  });

  it("requests fresh status when poll and status both disconnect", () => {
    const { browser, coordinator, transport } = createFixture();
    coordinator.handleAlarm(WORD_SYNC_CONTINUE_ALARM);
    coordinator.handleStartup();
    expect(transport.requests.map((request) => request.type)).toEqual([
      "word-sync-poll",
      "word-sync-status",
    ]);

    transport.disconnect({ reason: "disconnected" });

    expect(transport.requests.map((request) => request.type)).toEqual([
      "word-sync-poll",
      "word-sync-status",
      "word-sync-status",
    ]);
    expect(browser.createAlarm).toHaveBeenCalledWith(WORD_SYNC_CONTINUE_ALARM, {
      delayInMinutes: 1,
    });
    coordinator.dispose();
  });
});
