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
  sender: { readonly id: string; readonly url: string },
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
  const requests: { readonly url: string; readonly method: string | undefined }[] = [];
  const noListener = { addListener: () => undefined };
  runInNewContext(source, {
    AbortController,
    Headers,
    Response,
    TextDecoder,
    TextEncoder,
    URL,
    atob,
    btoa,
    clearTimeout,
    crypto: webcrypto,
    indexedDB: new IDBFactory(),
    location: { origin: `chrome-extension://${extensionId}` },
    navigator: {
      locks: {
        request: async <T>(
          _name: string,
          _options: unknown,
          operation: () => Promise<T>,
        ): Promise<T> => operation(),
      },
    },
    setTimeout,
    structuredClone,
    fetch: async (input: URL, init?: RequestInit) => {
      requests.push({ method: init?.method, url: input.href });
      if (input.pathname === "/v1/extension-preferences" && options.preferencesResponse) {
        return options.preferencesResponse();
      }
      if (options.request) return options.request(input, init);
      if (input.pathname !== "/v1/extension-pairings" || init?.method !== "POST") {
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
      alarms: { create: async () => undefined, onAlarm: noListener },
      runtime: {
        getManifest: () => ({ version: "1.0.0" }),
        id: extensionId,
        onConnect: {
          addListener: (listener: (port: ConnectedPort) => void) => connections.push(listener),
        },
        onMessage: { addListener: (listener: MessageListener) => listeners.push(listener) },
      },
      storage,
      tabs: {
        create: async ({ url }: { readonly url: string }) => {
          openedUrls.push(url);
        },
      },
    },
  });
  return {
    openedUrls,
    requests,
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
      const listener = listeners[0];
      if (listener === undefined) throw new Error("Packaged worker has no message listener.");
      return new Promise((resolve) => {
        const asynchronous = listener(
          { messageVersion: STORE_MESSAGE_VERSION, type },
          { id: extensionId, url: `chrome-extension://${extensionId}/popup.html` },
          resolve,
        );
        if (!asynchronous) resolve(undefined);
      });
    },
  };
}
