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
  registerServiceWorker,
  type RequestCoordinatorLike,
  type RuntimeMessageListener,
} from "./service-worker.js";

const request: AnalyzeRequest = {
  action: "translate",
  context: "The investigation was in its early stages.",
  requestId: "request-1",
  schemaVersion: 2,
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
  schemaVersion: 2,
  type: "add-word",
  word: "investigation",
};

const checkRequest: CheckWordRequest = {
  language: "en",
  requestId: "check-1",
  schemaVersion: 2,
  type: "check-word",
  word: "investigation",
};

class FakeCoordinator implements RequestCoordinatorLike {
  readonly cancellations: { requestId: string; tabId: number }[] = [];
  readonly starts: { request: HostWorkRequest; tabId: number }[] = [];

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
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("handleContentMessage", () => {
  it("routes valid analyze, check-word, add-word, and cancel commands for a sender tab", () => {
    const coordinator = new FakeCoordinator();

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
  });

  it("ignores malformed messages and messages without a tab", () => {
    const coordinator = new FakeCoordinator();

    expect(handleContentMessage({ type: "ANALYZE_SELECTION" }, 7, coordinator)).toBe(false);
    expect(
      handleContentMessage({ request, type: "ANALYZE_SELECTION" }, undefined, coordinator),
    ).toBe(false);
    expect(coordinator.starts).toEqual([]);
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
    vi.stubGlobal("chrome", {
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
      },
      tabs: {
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

    const send = runtimeListeners[0];
    const removeTab = tabRemovedListeners[0];
    if (send === undefined || removeTab === undefined) {
      throw new Error("Expected registered Chrome listeners.");
    }
    send({ request, type: "ANALYZE_SELECTION" }, { tab: { id: 7 } }, () => undefined);
    send(
      { request: checkRequest, type: "CHECK_WORD_IN_EUDIC" },
      { tab: { id: 7 } },
      () => undefined,
    );
    removeTab(7, { isWindowClosing: false, windowId: 1 });

    expect(postedMessages).toHaveLength(4);
    expect(
      postedMessages
        .slice(2)
        .map((message) =>
          typeof message === "object" && message !== null && "targetRequestId" in message
            ? message.targetRequestId
            : null,
        ),
    ).toEqual(["request-1", "check-1"]);

    dispose();
    expect(runtimeListeners).toHaveLength(0);
    expect(tabRemovedListeners).toHaveLength(0);
  });
});
