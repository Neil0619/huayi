import { afterEach, describe, expect, it, vi } from "vitest";

import type { AnalyzeRequest } from "@huayi/protocol";

import { DEFAULT_EXTENSION_SETTINGS } from "../settings/settings-domain.js";
import { SETTINGS_STORAGE_KEY } from "../settings/settings-store.js";
import { registerServiceWorker, type RuntimeMessageListener } from "./service-worker.js";

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

type StorageChangeListener = Parameters<typeof chrome.storage.onChanged.addListener>[0];

function createDeferred<Value>(): {
  promise: Promise<Value>;
  reject(reason?: unknown): void;
  resolve(value: Value): void;
} {
  let rejectPromise: (reason?: unknown) => void = () => undefined;
  let resolvePromise: (value: Value) => void = () => undefined;
  const promise = new Promise<Value>((resolve, reject) => {
    rejectPromise = reject;
    resolvePromise = resolve;
  });
  return { promise, reject: rejectPromise, resolve: resolvePromise };
}

function stubChromeWithDeferredSettingsRead(settingsRead: Promise<Record<string, unknown>>): {
  postedMessages: unknown[];
  runtimeListeners: RuntimeMessageListener[];
  storageListeners: StorageChangeListener[];
} {
  const postedMessages: unknown[] = [];
  const runtimeListeners: RuntimeMessageListener[] = [];
  const storageListeners: StorageChangeListener[] = [];
  vi.stubGlobal("chrome", {
    action: {
      setBadgeText: () => Promise.resolve(),
      setTitle: () => Promise.resolve(),
    },
    alarms: {
      clear: () => Promise.resolve(true),
      create: () => Promise.resolve(),
      get: () => Promise.resolve(undefined),
      onAlarm: {
        addListener: () => undefined,
        removeListener: () => undefined,
      },
    },
    runtime: {
      connectNative: () => ({
        disconnect: () => undefined,
        onDisconnect: { addListener: () => undefined },
        onMessage: { addListener: () => undefined },
        postMessage: (message: unknown) => postedMessages.push(message),
      }),
      getURL: (path: string) => `chrome-extension://extension-id/${path}`,
      id: "extension-id",
      onMessage: {
        addListener: (listener: RuntimeMessageListener) => runtimeListeners.push(listener),
        removeListener: () => undefined,
      },
      onStartup: {
        addListener: () => undefined,
        removeListener: () => undefined,
      },
    },
    storage: {
      local: {
        get: () => settingsRead,
        set: () => Promise.resolve(),
      },
      onChanged: {
        addListener: (listener: StorageChangeListener) => storageListeners.push(listener),
        removeListener: () => undefined,
      },
    },
    tabs: {
      create: () => Promise.resolve(),
      onRemoved: {
        addListener: () => undefined,
        removeListener: () => undefined,
      },
      sendMessage: () => Promise.resolve(),
    },
  });
  return { postedMessages, runtimeListeners, storageListeners };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("registerServiceWorker settings loading", () => {
  it("fails closed before settings load and does not let a stale read replace a newer change", async () => {
    const settingsRead = createDeferred<Record<string, unknown>>();
    const { postedMessages, runtimeListeners, storageListeners } =
      stubChromeWithDeferredSettingsRead(settingsRead.promise);
    const dispose = registerServiceWorker();
    const send = runtimeListeners[0];
    const notifyStorageChange = storageListeners[0];
    if (send === undefined || notifyStorageChange === undefined) {
      throw new Error("Expected registered settings listeners.");
    }
    const sender = { tab: { id: 7 }, url: "https://example.com/article" };
    const responses: unknown[] = [];

    send({ request, type: "ANALYZE_SELECTION" }, sender, (response) => responses.push(response));
    expect(responses).toEqual([{ handled: false }]);
    expect(postedMessages).toEqual([]);

    notifyStorageChange(
      {
        [SETTINGS_STORAGE_KEY]: {
          newValue: {
            ...DEFAULT_EXTENSION_SETTINGS,
            enabled: false,
            wordbook: { automaticSync: false, enabled: false, syncHour: 8 },
          },
        },
      },
      "local",
    );
    settingsRead.resolve({});
    await Promise.resolve();
    await Promise.resolve();

    send({ request, type: "ANALYZE_SELECTION" }, sender, (response) => responses.push(response));
    expect(responses).toEqual([{ handled: false }, { handled: false }]);
    expect(postedMessages).toEqual([]);
    dispose();
  });

  it("keeps content and word sync disabled when the settings read fails", async () => {
    const settingsRead = createDeferred<Record<string, unknown>>();
    const { postedMessages, runtimeListeners } = stubChromeWithDeferredSettingsRead(
      settingsRead.promise,
    );
    const dispose = registerServiceWorker();
    const send = runtimeListeners[0];
    if (send === undefined) throw new Error("Expected a registered runtime listener.");

    settingsRead.reject(new Error("storage unavailable"));
    await Promise.resolve();
    await Promise.resolve();
    const responses: unknown[] = [];
    send(
      { request, type: "ANALYZE_SELECTION" },
      { tab: { id: 7 }, url: "https://example.com/article" },
      (response) => responses.push(response),
    );

    expect(responses).toEqual([{ handled: false }]);
    expect(postedMessages).toEqual([]);
    dispose();
  });
});
