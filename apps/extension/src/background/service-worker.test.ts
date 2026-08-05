import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  AddWordRequest,
  AnalyzeRequest,
  CheckWordRequest,
  HostWorkRequest,
} from "@huayi/protocol";

import {
  createRuntimeMessageListener,
  handleContentMessage,
  handleShanbayMessage,
  registerServiceWorker,
  type RequestCoordinatorLike,
  type RuntimeMessageListener,
  type WordSyncCoordinatorLike,
} from "./service-worker.js";

const request: AnalyzeRequest = {
  action: "translate",
  context: "The investigation was in its early stages.",
  requestId: "request-1",
  schemaVersion: 6,
  selection: "investigation",
  selectionKind: "word",
  sentenceContext: null,
  targetLanguage: "zh-CN",
  type: "analyze",
};

const wordRequest: AddWordRequest = {
  context: "The investigation was in its early stages.",
  language: "en",
  requestId: "word-1",
  schemaVersion: 6,
  type: "add-word",
  word: "investigation",
};

const checkRequest: CheckWordRequest = {
  language: "en",
  requestId: "check-1",
  schemaVersion: 6,
  type: "check-word",
  word: "investigation",
};

class FakeCoordinator implements RequestCoordinatorLike {
  readonly cancellations: { requestId: string; tabId: number }[] = [];
  readonly starts: { request: HostWorkRequest; tabId: number }[] = [];
  warmups = 0;

  cancel(tabId: number, requestId: string): boolean {
    this.cancellations.push({ requestId, tabId });
    return true;
  }

  cancelTab(tabId: number): void {
    this.cancellations.push({ requestId: "*", tabId });
  }

  start(tabId: number, workRequest: HostWorkRequest): void {
    this.starts.push({ request: workRequest, tabId });
  }

  warmup(): void {
    this.warmups += 1;
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("handleContentMessage", () => {
  it("accepts sync commands only from the exact Shanbay collection page", () => {
    const coordinator: WordSyncCoordinatorLike = {
      discardAllUnresolved: vi.fn(),
      discardUnresolved: vi.fn(),
      handlePageReady: vi.fn(),
      handleStartup: vi.fn(),
      listUnresolved: vi.fn(),
      requeueUnresolved: vi.fn(),
      resolveBatch: vi.fn(),
    };
    expect(
      handleShanbayMessage(
        { type: "SHANBAY_PAGE_READY" },
        { tab: { id: 9 }, url: "https://web.shanbay.com/wordsweb/#/collection" },
        coordinator,
      ),
    ).toBe(true);
    expect(coordinator.handlePageReady).toHaveBeenCalledWith(9);
    expect(
      handleShanbayMessage(
        { type: "SHANBAY_PAGE_READY" },
        { tab: { id: 9 }, url: "https://web.shanbay.com/wordsweb#/collection" },
        coordinator,
      ),
    ).toBe(false);
    expect(
      handleShanbayMessage(
        { type: "SHANBAY_PAGE_READY" },
        { tab: { id: 9 }, url: "https://web.shanbay.com/other/#/collection" },
        coordinator,
      ),
    ).toBe(false);
    expect(
      handleShanbayMessage(
        { type: "SHANBAY_PAGE_READY" },
        { tab: { id: 9 }, url: "https://web.shanbay.com/wordsweb/#/collection-evil" },
        coordinator,
      ),
    ).toBe(false);
    expect(
      handleShanbayMessage(
        { batchId: "batch-1", rejectedTargets: [], type: "RESOLVE_SHANBAY_BATCH" },
        { tab: { id: 9 }, url: "https://evil.invalid/#/collection" },
        coordinator,
      ),
    ).toBe(false);
    expect(coordinator.resolveBatch).not.toHaveBeenCalled();

    expect(
      handleShanbayMessage(
        {
          batchId: "batch-1",
          rejectedTargets: ["orbiting"],
          type: "RESOLVE_SHANBAY_BATCH",
        },
        { tab: { id: 9 }, url: "https://web.shanbay.com/wordsweb/#/collection" },
        coordinator,
      ),
    ).toBe(true);
    expect(coordinator.resolveBatch).toHaveBeenCalledWith(9, "batch-1", ["orbiting"]);

    expect(
      handleShanbayMessage(
        {
          sourceWords: ["splendidly"],
          type: "DISCARD_SHANBAY_UNRESOLVED",
        },
        { tab: { id: 9 }, url: "https://web.shanbay.com/wordsweb/#/collection" },
        coordinator,
      ),
    ).toBe(true);
    expect(coordinator.discardUnresolved).toHaveBeenCalledWith(9, ["splendidly"]);

    expect(
      handleShanbayMessage(
        { type: "DISCARD_ALL_SHANBAY_UNRESOLVED" },
        { tab: { id: 9 }, url: "https://web.shanbay.com/wordsweb/#/collection" },
        coordinator,
      ),
    ).toBe(true);
    expect(coordinator.discardAllUnresolved).toHaveBeenCalledWith(9);
  });

  it("routes valid warmup, analyze, check-word, add-word, and cancel commands for a sender tab", () => {
    const coordinator = new FakeCoordinator();

    expect(handleContentMessage({ type: "WARMUP_HOST" }, 7, coordinator)).toBe(true);
    expect(handleContentMessage({ request, type: "ANALYZE_SELECTION" }, 7, coordinator)).toBe(true);
    expect(
      handleContentMessage({ request: wordRequest, type: "ADD_WORD_TO_EUDIC" }, 7, coordinator),
    ).toBe(true);
    expect(
      handleContentMessage({ request: checkRequest, type: "CHECK_WORD_IN_EUDIC" }, 7, coordinator),
    ).toBe(true);
    expect(
      handleContentMessage({ requestId: "request-1", type: "CANCEL_REQUEST" }, 7, coordinator),
    ).toBe(true);
    expect(coordinator.starts).toEqual([
      { request, tabId: 7 },
      { request: wordRequest, tabId: 7 },
      { request: checkRequest, tabId: 7 },
    ]);
    expect(coordinator.cancellations).toEqual([{ requestId: "request-1", tabId: 7 }]);
    expect(coordinator.warmups).toBe(1);
  });

  it("ignores malformed messages and messages without a tab", () => {
    const coordinator = new FakeCoordinator();

    expect(handleContentMessage({ type: "ANALYZE_SELECTION" }, 7, coordinator)).toBe(false);
    expect(
      handleContentMessage({ request, type: "ANALYZE_SELECTION" }, undefined, coordinator),
    ).toBe(false);
    expect(handleContentMessage({ type: "WARMUP_HOST" }, undefined, coordinator)).toBe(false);
    expect(
      handleContentMessage({ selection: "investigation", type: "WARMUP_HOST" }, 7, coordinator),
    ).toBe(false);
    expect(coordinator.starts).toEqual([]);
    expect(coordinator.warmups).toBe(0);
  });

  it("responds synchronously without leaving the Chrome message channel open", () => {
    const coordinator = new FakeCoordinator();
    const listener = createRuntimeMessageListener(coordinator);
    const responses: unknown[] = [];

    expect(
      listener({ request, type: "ANALYZE_SELECTION" }, { tab: { id: 7 } }, (response) =>
        responses.push(response),
      ),
    ).toBe(false);
    expect(responses).toEqual([{ handled: true }]);
  });

  it("cancels every request lane when Chrome removes the sender tab", () => {
    type TabRemovedListener = (
      tabId: number,
      removeInfo: { isWindowClosing: boolean; windowId: number },
    ) => void;
    const runtimeListeners: RuntimeMessageListener[] = [];
    const tabRemovedListeners: TabRemovedListener[] = [];
    const postedMessages: unknown[] = [];
    const actionListeners: (() => void)[] = [];
    const alarmListeners: ((alarm: { name: string }) => void)[] = [];
    const startupListeners: (() => void)[] = [];
    vi.stubGlobal("chrome", {
      action: {
        onClicked: {
          addListener: (listener: () => void) => actionListeners.push(listener),
          removeListener: (listener: () => void) =>
            actionListeners.splice(actionListeners.indexOf(listener), 1),
        },
        setBadgeText: () => Promise.resolve(),
        setTitle: () => Promise.resolve(),
      },
      alarms: {
        create: () => Promise.resolve(),
        get: () => Promise.resolve(undefined),
        onAlarm: {
          addListener: (listener: (alarm: { name: string }) => void) =>
            alarmListeners.push(listener),
          removeListener: (listener: (alarm: { name: string }) => void) =>
            alarmListeners.splice(alarmListeners.indexOf(listener), 1),
        },
      },
      runtime: {
        connectNative: () => ({
          disconnect: () => undefined,
          onDisconnect: { addListener: () => undefined },
          onMessage: { addListener: () => undefined },
          postMessage: (message: unknown) => postedMessages.push(message),
        }),
        id: "extension-id",
        onMessage: {
          addListener: (listener: RuntimeMessageListener) => runtimeListeners.push(listener),
          removeListener: (listener: RuntimeMessageListener) =>
            runtimeListeners.splice(runtimeListeners.indexOf(listener), 1),
        },
        onStartup: {
          addListener: (listener: () => void) => startupListeners.push(listener),
          removeListener: (listener: () => void) =>
            startupListeners.splice(startupListeners.indexOf(listener), 1),
        },
      },
      tabs: {
        create: () => Promise.resolve(),
        onRemoved: {
          addListener: (listener: TabRemovedListener) => tabRemovedListeners.push(listener),
          removeListener: (listener: TabRemovedListener) =>
            tabRemovedListeners.splice(tabRemovedListeners.indexOf(listener), 1),
        },
        sendMessage: () => Promise.resolve(),
      },
    });

    const dispose = registerServiceWorker();
    expect(runtimeListeners).toHaveLength(1);
    expect(tabRemovedListeners).toHaveLength(1);
    expect(startupListeners).toHaveLength(1);
    expect(postedMessages).toEqual([
      expect.objectContaining({ schemaVersion: 6, type: "word-sync-status" }),
    ]);

    const send = runtimeListeners[0];
    const removeTab = tabRemovedListeners[0];
    if (send === undefined || removeTab === undefined) {
      throw new Error("Expected registered Chrome listeners.");
    }
    send({ type: "WARMUP_HOST" }, { tab: { id: 7 } }, () => undefined);
    send({ request, type: "ANALYZE_SELECTION" }, { tab: { id: 7 } }, () => undefined);
    send(
      { request: checkRequest, type: "CHECK_WORD_IN_EUDIC" },
      { tab: { id: 7 } },
      () => undefined,
    );
    removeTab(7, { isWindowClosing: false, windowId: 1 });

    expect(postedMessages).toHaveLength(6);
    expect(postedMessages[1]).toMatchObject({ schemaVersion: 6, type: "warmup" });
    expect(Object.keys(postedMessages[1] as object).sort()).toEqual([
      "requestId",
      "schemaVersion",
      "type",
    ]);
    expect(
      postedMessages
        .slice(4)
        .map((message) =>
          typeof message === "object" && message !== null && "targetRequestId" in message
            ? message.targetRequestId
            : null,
        ),
    ).toEqual(["request-1", "check-1"]);

    dispose();
    expect(runtimeListeners).toHaveLength(0);
    expect(tabRemovedListeners).toHaveLength(0);
    expect(actionListeners).toHaveLength(0);
    expect(alarmListeners).toHaveLength(0);
    expect(startupListeners).toHaveLength(0);
  });
});
