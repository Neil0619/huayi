import { webcrypto } from "node:crypto";
import { runInNewContext } from "node:vm";

import { IDBFactory } from "fake-indexeddb";
import { STORE_ANALYSIS_PORT_NAME, STORE_MESSAGE_VERSION } from "@huayi/store-domain";

import type { ChromeVaultStorage, ChromeVaultStorageArea } from "./vault/chrome-vault-storage.js";
import type { AnalysisSessionPort } from "./service-worker/analysis-session.js";

type ConnectedPort = AnalysisSessionPort & {
  readonly name: string;
  readonly sender: { readonly id: string; readonly url: string };
};

type MessageListener = (
  message: unknown,
  sender: {
    readonly id: string;
    readonly url: string;
    readonly tab?: { readonly id: number };
    readonly documentId?: string;
    readonly frameId?: number;
  },
  respond: (response: unknown) => void,
) => boolean;

function memoryStorage(): ChromeVaultStorageArea {
  const values = new Map<string, unknown>();
  return {
    get: async (key) => ({ [key]: structuredClone(values.get(key)) }),
    remove: async (key) => {
      values.delete(key);
    },
    set: async (items) => {
      for (const [key, value] of Object.entries(items)) values.set(key, structuredClone(value));
    },
    setAccessLevel: async () => undefined,
  };
}

/** Extension-local state shared between isolated worker restarts in offline tests. */
export function createPackagedWorkerStorage(): ChromeVaultStorage {
  return { local: memoryStorage(), session: memoryStorage() };
}

/** Runs the actual packaged entrypoint; only browser I/O is replaced, never production wiring. */
export function loadPackagedWorker(
  source: string,
  extensionId: string,
  storage = createPackagedWorkerStorage(),
  options: {
    readonly preferencesResponse?: () => Response;
    readonly request?: (input: URL, init?: RequestInit) => Promise<Response>;
  } = {},
) {
  const listeners: MessageListener[] = [];
  const connections: ((port: ConnectedPort) => void)[] = [];
  const openedUrls: string[] = [];
  const badges: string[] = [];
  const tabs: { id: number; windowId: number; url: string }[] = [];
  const requests: { readonly url: string; readonly method: string | undefined }[] = [];
  const noListener = { addListener: () => undefined };
  const locks = new Map<string, Promise<unknown>>();
  const alarms = new Map<string, { name: string; when?: number; periodInMinutes?: number }>();
  const alarmListeners: ((alarm: { name: string }) => void)[] = [];
  runInNewContext(source, {
    AbortController,
    AbortSignal,
    Headers,
    Response,
    TextDecoder,
    TextEncoder,
    URL,
    atob,
    btoa,
    clearInterval,
    clearTimeout,
    crypto: webcrypto,
    indexedDB: new IDBFactory(),
    location: { origin: `chrome-extension://${extensionId}` },
    navigator: {
      locks: {
        request: async <T>(
          name: string,
          optionsOrOperation: unknown | (() => Promise<T>),
          operation?: () => Promise<T>,
        ): Promise<T> => {
          const previous = locks.get(name) ?? Promise.resolve();
          const running = previous.then(operation ?? (optionsOrOperation as () => Promise<T>));
          locks.set(
            name,
            running.catch(() => undefined),
          );
          return running;
        },
      },
    },
    performance,
    setInterval,
    setTimeout,
    structuredClone,
    fetch: async (input: string | URL, init?: RequestInit) => {
      const url = new URL(input);
      requests.push({ method: init?.method, url: url.href });
      if (url.pathname === "/v1/extension-preferences" && options.preferencesResponse) {
        return options.preferencesResponse();
      }
      if (options.request) return options.request(url, init);
      if (url.pathname !== "/v1/extension-pairings" || init?.method !== "POST") {
        throw new Error("Unexpected offline worker request.");
      }
      return Response.json({
        expiresAt: "2099-01-01T00:00:00.000Z",
        id: "packaged-pairing",
        pairingPath: "/pair-extension/packaged-pairing",
        status: "pending",
      });
    },
    chrome: {
      action: {
        setBadgeText: async ({ text }: { text: string }) => {
          badges.push(text);
        },
        setBadgeBackgroundColor: async () => undefined,
      },
      alarms: {
        create: async (name: string, details: { when?: number; periodInMinutes?: number }) => {
          alarms.set(name, { name, ...details });
        },
        get: async (name: string) => alarms.get(name),
        onAlarm: {
          addListener: (listener: (alarm: { name: string }) => void) =>
            alarmListeners.push(listener),
        },
      },
      runtime: {
        onStartup: noListener,
        onInstalled: noListener,
        getManifest: () => ({ version: "1.0.0" }),
        id: extensionId,
        onConnect: {
          addListener: (listener: (port: ConnectedPort) => void) => connections.push(listener),
        },
        onMessage: { addListener: (listener: MessageListener) => listeners.push(listener) },
      },
      storage: { ...storage, onChanged: noListener },
      tabs: {
        create: async ({ url }: { readonly url: string }) => {
          openedUrls.push(url);
          const tab = { id: tabs.length + 1, windowId: 1, url };
          tabs.push(tab);
          return { ...tab };
        },
        query: async () => tabs.map(({ id, windowId }) => ({ id, windowId })),
        update: async (id: number, update: { url?: string; active?: boolean }) => {
          const tab = tabs.find((item) => item.id === id);
          if (!tab) throw new Error("Unknown offline tab.");
          if (update.url !== undefined) {
            tab.url = update.url;
            openedUrls.push(update.url);
          }
          return { ...tab };
        },
        sendMessage: async (id: number, message: { type: string }) => {
          const tab = tabs.find((item) => item.id === id);
          if (!tab) throw new Error("Unknown offline tab.");
          return message.type === "store/backfill-probe"
            ? { shanbayCollection: tab.url === "https://web.shanbay.com/wordsweb/#/collection" }
            : undefined;
        },
      },
      windows: { update: async () => undefined },
    },
  });
  const sendMessage = async (
    message: unknown,
    sender: Parameters<MessageListener>[1] = {
      id: extensionId,
      url: `chrome-extension://${extensionId}/popup.html`,
    },
  ): Promise<unknown> => {
    const listener = listeners[0];
    if (listener === undefined) throw new Error("Packaged worker has no message listener.");
    return new Promise((resolve) => {
      const asynchronous = listener(message, sender, resolve);
      if (!asynchronous) resolve(undefined);
    });
  };
  return {
    badges,
    openedUrls,
    requests,
    alarms,
    emitAlarm(name: string) {
      for (const listener of alarmListeners) listener({ name });
    },
    sendMessage,
    connect() {
      const incoming: ((message: unknown) => void)[] = [];
      const disconnecting: (() => void)[] = [];
      const messages: unknown[] = [];
      const port: ConnectedPort = {
        name: STORE_ANALYSIS_PORT_NAME,
        sender: { id: extensionId, url: "https://article.example.test/reading" },
        onDisconnect: { addListener: (listener) => disconnecting.push(listener) },
        onMessage: { addListener: (listener) => incoming.push(listener) },
        postMessage: (message) => messages.push(message),
      };
      if (!connections.length) throw new Error("Packaged worker has no connection listener.");
      for (const listener of connections) listener(port);
      return {
        messages,
        post: (message: unknown) => incoming.forEach((listener) => listener(message)),
        disconnect: () => disconnecting.forEach((listener) => listener()),
      };
    },
    async send(type: string): Promise<unknown> {
      return sendMessage({ messageVersion: STORE_MESSAGE_VERSION, type });
    },
  };
}
