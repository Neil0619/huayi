import { afterEach, describe, expect, it, vi } from "vitest";

import type { HostEvent, HostRequest } from "@huayi/protocol";

import type { NativeDisconnect, NativeTransport } from "./native-transport.js";
import {
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
}

function localTime(hour: number, minute = 0, day = 5): Date {
  return new Date(2026, 7, day, hour, minute, 0, 0);
}

function createFixture(now: () => Date) {
  let sequence = 0;
  const transport = new FakeTransport();
  const browser: WordSyncBrowserApi = {
    clearAlarm: vi.fn(),
    createAlarm: vi.fn(),
    createTab: vi.fn(),
    getAlarm: vi.fn(async () => undefined),
    sendToTab: vi.fn(),
    setBadgeText: vi.fn(),
    setTitle: vi.fn(),
  };
  const coordinator = new WordSyncCoordinator({
    browser,
    createRequestId: () => `sync-${++sequence}`,
    now,
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
    schemaVersion: 7,
    skippedCount: 0,
    type: "word-sync-status",
    unresolvedCount: 0,
    ...overrides,
  } as HostEvent;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("WordSyncCoordinator daily scheduling", () => {
  it("clears daily work while disabled and honors a configured local hour when enabled", async () => {
    const { browser, coordinator, transport } = createFixture(() => localTime(14, 30));
    coordinator.initialize({ automaticSync: true, enabled: false, syncHour: 17 });
    expect(browser.clearAlarm).toHaveBeenCalledWith(WORD_SYNC_DAILY_ALARM);
    expect(transport.requests).toEqual([]);
    expect(coordinator.startManualSync()).toBe(false);

    coordinator.configure({ automaticSync: true, enabled: true, syncHour: 17 });
    await vi.waitFor(() =>
      expect(browser.createAlarm).toHaveBeenCalledWith(WORD_SYNC_DAILY_ALARM, {
        when: localTime(17).getTime(),
      }),
    );
    expect(coordinator.startManualSync()).toBe(true);
    coordinator.dispose();
  });
  it("anchors the daily scan at the next local 08:00 instead of from service-worker startup", async () => {
    vi.useFakeTimers({ now: localTime(7, 30).getTime() });
    const { browser, coordinator } = createFixture(() => new Date());
    coordinator.initialize();

    await vi.waitFor(() =>
      expect(browser.createAlarm).toHaveBeenCalledWith(WORD_SYNC_DAILY_ALARM, {
        when: localTime(8).getTime(),
      }),
    );
    coordinator.dispose();
  });

  it("restores status, polls once when due, and schedules a persisted scan continuation", () => {
    const { browser, coordinator, transport } = createFixture(() => localTime(9));
    coordinator.initialize();
    expect(transport.requests[0]).toMatchObject({ type: "word-sync-status" });
    transport.emit(statusEvent("sync-1", { pollDue: true }));
    expect(transport.requests[1]).toMatchObject({ type: "word-sync-poll" });
    transport.emit(
      statusEvent("sync-2", { pendingCount: 12, pollDue: true, scanInProgress: true }),
    );
    expect(browser.setBadgeText).toHaveBeenLastCalledWith("12");
    expect(browser.createAlarm).toHaveBeenCalledWith(WORD_SYNC_CONTINUE_ALARM, {
      delayInMinutes: 1,
    });
    coordinator.dispose();
  });

  it("does not reset an existing one-shot alarm already anchored at the next local 08:00", async () => {
    const { browser, coordinator } = createFixture(() => localTime(7, 30));
    vi.mocked(browser.getAlarm).mockResolvedValue({
      scheduledTime: localTime(8).getTime(),
    } as chrome.alarms.Alarm);

    coordinator.initialize();
    await Promise.resolve();
    await Promise.resolve();

    expect(browser.createAlarm).not.toHaveBeenCalled();
    coordinator.dispose();
  });

  it("replaces a legacy periodic alarm and requeues the next local 08:00 after it fires", async () => {
    const { browser, coordinator, transport } = createFixture(() => localTime(8));
    vi.mocked(browser.getAlarm).mockResolvedValue({
      periodInMinutes: 1440,
      scheduledTime: localTime(8).getTime(),
    } as chrome.alarms.Alarm);

    coordinator.initialize();
    await vi.waitFor(() =>
      expect(browser.createAlarm).toHaveBeenCalledWith(WORD_SYNC_DAILY_ALARM, {
        when: localTime(8, 0, 6).getTime(),
      }),
    );
    vi.mocked(browser.createAlarm).mockClear();

    coordinator.handleAlarm(WORD_SYNC_DAILY_ALARM);
    expect(browser.createAlarm).toHaveBeenCalledWith(WORD_SYNC_DAILY_ALARM, {
      when: localTime(8, 0, 6).getTime(),
    });
    expect(transport.requests).toContainEqual(expect.objectContaining({ type: "word-sync-poll" }));
    coordinator.dispose();
  });

  it("waits until 08:00 before automatically recovering an overdue daily scan", () => {
    const { coordinator, transport } = createFixture(() => localTime(7, 59));
    coordinator.initialize();
    transport.emit(statusEvent("sync-1", { pollDue: true }));

    expect(transport.requests).toHaveLength(1);
    coordinator.dispose();
  });

  it("continues a persisted scan before 08:00 without starting a new daily scan", () => {
    const { coordinator, transport } = createFixture(() => localTime(7, 59));
    coordinator.initialize();
    transport.emit(statusEvent("sync-1", { pollDue: true, scanInProgress: true }));

    expect(transport.requests.map((request) => request.type)).toEqual([
      "word-sync-status",
      "word-sync-poll",
    ]);
    coordinator.dispose();
  });

  it("deduplicates concurrent daily checks and action prepares", () => {
    const { coordinator, transport } = createFixture(() => localTime(8));
    coordinator.handleAlarm(WORD_SYNC_DAILY_ALARM);
    coordinator.handleAlarm(WORD_SYNC_DAILY_ALARM);
    coordinator.startManualSync();
    coordinator.startManualSync();

    expect(transport.requests.map((request) => request.type)).toEqual([
      "word-sync-poll",
      "word-sync-prepare-batch",
    ]);
    coordinator.dispose();
  });
});
