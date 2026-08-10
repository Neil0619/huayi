import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  AddWordRequest,
  AnalyzeRequest,
  CheckWordRequest,
  HostWorkRequest,
} from "@huayi/protocol";

import { DEFAULT_EXTENSION_SETTINGS } from "../settings/settings-domain.js";
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
  schemaVersion: 7,
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
  schemaVersion: 7,
  type: "add-word",
  word: "investigation",
};

const checkRequest: CheckWordRequest = {
  language: "en",
  requestId: "check-1",
  schemaVersion: 7,
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

  it("accepts settings only from extension pages and applies the site-policy defense", async () => {
    const coordinator = new FakeCoordinator();
    const mutate = vi.fn(async () => DEFAULT_EXTENSION_SETTINGS);
    const listener = createRuntimeMessageListener(
      coordinator,
      undefined,
      undefined,
      { mutate },
      "chrome-extension://extension-id/",
      (sender) => sender.url === "https://allowed.example/article",
    );
    const responses: unknown[] = [];

    expect(
      listener(
        { enabled: false, type: "MUTATE_SETTINGS" },
        { url: "https://evil.example/" },
        (response) => responses.push(response),
      ),
    ).toBe(false);
    expect(mutate).not.toHaveBeenCalled();
    expect(
      listener(
        { mutation: { enabled: false, type: "set-enabled" }, type: "MUTATE_SETTINGS" },
        { url: "chrome-extension://extension-id/options.html" },
        (response) => responses.push(response),
      ),
    ).toBe(true);
    await vi.waitFor(() => expect(mutate).toHaveBeenCalledOnce());

    listener(
      { request, type: "ANALYZE_SELECTION" },
      { tab: { id: 7 }, url: "https://blocked.example/article" },
      (response) => responses.push(response),
    );
    listener(
      { request, type: "ANALYZE_SELECTION" },
      { tab: { id: 7 }, url: "https://allowed.example/article" },
      (response) => responses.push(response),
    );
    listener(
      { requestId: request.requestId, type: "CANCEL_REQUEST" },
      { tab: { id: 7 }, url: "https://blocked.example/article" },
      (response) => responses.push(response),
    );
    expect(coordinator.starts).toEqual([{ request, tabId: 7 }]);
    expect(coordinator.cancellations).toEqual([{ requestId: request.requestId, tabId: 7 }]);
  });

  it("cancels every request lane when Chrome removes the sender tab", async () => {
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
        clear: () => Promise.resolve(true),
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
        getURL: (path: string) => `chrome-extension://extension-id/${path}`,
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
      storage: {
        local: {
          get: () => Promise.resolve({}),
          set: () => Promise.resolve(),
        },
        onChanged: {
          addListener: () => undefined,
          removeListener: () => undefined,
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
    await vi.waitFor(() =>
      expect(postedMessages).toEqual([
        expect.objectContaining({ schemaVersion: 7, type: "word-sync-status" }),
      ]),
    );

    const send = runtimeListeners[0];
    const removeTab = tabRemovedListeners[0];
    if (send === undefined || removeTab === undefined) {
      throw new Error("Expected registered Chrome listeners.");
    }
    const sender = { tab: { id: 7 }, url: "https://example.com/article" };
    send({ type: "WARMUP_HOST" }, sender, () => undefined);
    send({ request, type: "ANALYZE_SELECTION" }, sender, () => undefined);
    send({ request: checkRequest, type: "CHECK_WORD_IN_EUDIC" }, sender, () => undefined);
    removeTab(7, { isWindowClosing: false, windowId: 1 });

    expect(postedMessages).toHaveLength(6);
    expect(postedMessages[1]).toMatchObject({ schemaVersion: 7, type: "warmup" });
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
