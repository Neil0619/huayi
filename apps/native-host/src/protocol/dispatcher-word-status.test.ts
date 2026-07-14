import { describe, expect, it, vi } from "vitest";

import type { AnalysisError, HostEvent, WordbookPresence } from "@huayi/protocol";

import type { AnalysisProvider } from "../provider/analysis-provider.js";
import type { WordbookProvider } from "../wordbook/wordbook-provider.js";
import {
  checkRequest,
  eventsFor,
  request,
  validResult,
  waitForAbort,
  wordRequest,
} from "./dispatcher-test-helpers.js";
import { NativeMessageDispatcher } from "./dispatcher.js";

interface DispatcherOverrides {
  mapWordbookError?: (error: unknown) => AnalysisError;
  maximumConcurrency?: number;
  provider?: AnalysisProvider;
  wordbookProvider?: WordbookProvider;
}

function createDispatcher(overrides: DispatcherOverrides = {}): NativeMessageDispatcher {
  const options = {
    healthCheck: async () => ({
      codexVersion: "codex-cli 0.144.1",
      model: "gpt-5.4-mini",
      provider: "codex" as const,
    }),
    provider: overrides.provider ?? {
      analyze: async () => validResult,
      warmup: async () => undefined,
    },
  };
  return new NativeMessageDispatcher({
    ...options,
    ...(overrides.mapWordbookError === undefined
      ? {}
      : { mapWordbookError: overrides.mapWordbookError }),
    ...(overrides.maximumConcurrency === undefined
      ? {}
      : { maximumConcurrency: overrides.maximumConcurrency }),
    ...(overrides.wordbookProvider === undefined
      ? {}
      : { wordbookProvider: overrides.wordbookProvider }),
  });
}

describe("NativeMessageDispatcher wordbook routing", () => {
  it("keeps add-word routing intact", async () => {
    const events: HostEvent[] = [];
    let aborted = false;
    const wordbookProvider: WordbookProvider = {
      addWord: (currentRequest, signal) => {
        if (currentRequest.requestId === wordRequest.requestId) {
          return Promise.resolve("added");
        }
        return new Promise((_resolve, reject) => {
          signal.addEventListener(
            "abort",
            () => {
              aborted = true;
              reject(new Error("aborted"));
            },
            { once: true },
          );
        });
      },
      checkWord: async () => "absent",
    };
    const dispatcher = createDispatcher({ wordbookProvider });

    dispatcher.dispatch(wordRequest, (event) => events.push(event));

    await vi.waitFor(() => expect(events.some((event) => event.type === "word-added")).toBe(true));
    expect(events.at(-1)).toEqual({
      outcome: "added",
      requestId: wordRequest.requestId,
      schemaVersion: 3,
      type: "word-added",
    });

    dispatcher.dispatch({ ...wordRequest, requestId: "word-2" }, (event) => events.push(event));
    dispatcher.dispatch(
      {
        requestId: "cancel-add",
        schemaVersion: 3,
        targetRequestId: "word-2",
        type: "cancel",
      },
      (event) => events.push(event),
    );
    await vi.waitFor(() => expect(aborted).toBe(true));
    expect(events.at(-1)).toMatchObject({
      error: { code: "CANCELLED" },
      requestId: "word-2",
      type: "error",
    });
    dispatcher.dispose();
  });

  it.each(["present", "absent"] as const)(
    "emits a validated %s word status",
    async (presence: WordbookPresence) => {
      const events: HostEvent[] = [];
      const wordbookProvider: WordbookProvider = {
        addWord: async () => "added",
        checkWord: async () => presence,
      };
      const dispatcher = createDispatcher({ wordbookProvider });

      dispatcher.dispatch(checkRequest, (event) => events.push(event));

      await vi.waitFor(() =>
        expect(events.some((event) => event.type === "word-status")).toBe(true),
      );
      expect(eventsFor(events, checkRequest.requestId).map((event) => event.type)).toEqual([
        "progress",
        "progress",
        "word-status",
      ]);
      expect(events.at(-1)).toEqual({
        presence,
        requestId: checkRequest.requestId,
        schemaVersion: 3,
        type: "word-status",
      });
      dispatcher.dispose();
    },
  );

  it("fails check-word when the wordbook provider is missing", () => {
    const events: HostEvent[] = [];
    const dispatcher = createDispatcher();

    dispatcher.dispatch(checkRequest, (event) => events.push(event));

    expect(events).toEqual([
      expect.objectContaining({
        error: expect.objectContaining({ code: "EUDIC_NOT_CONFIGURED" }),
        requestId: checkRequest.requestId,
        type: "error",
      }),
    ]);
    dispatcher.dispose();
  });

  it("rejects an invalid wordbook presence", async () => {
    const events: HostEvent[] = [];
    const wordbookProvider: WordbookProvider = {
      addWord: async () => "added",
      checkWord: async () => "unknown" as unknown as WordbookPresence,
    };
    const dispatcher = createDispatcher({ wordbookProvider });

    dispatcher.dispatch(checkRequest, (event) => events.push(event));

    await vi.waitFor(() => expect(events.some((event) => event.type === "error")).toBe(true));
    expect(events.at(-1)).toMatchObject({ error: { code: "INVALID_RESPONSE" }, type: "error" });
    dispatcher.dispose();
  });

  it("maps a terminal check-word provider error", async () => {
    const events: HostEvent[] = [];
    const mappedErrors: unknown[] = [];
    const failure = new Error("fake Eudic failure");
    const mapped: AnalysisError = {
      code: "NETWORK_ERROR",
      message: "生词本网络请求失败。",
      retryable: true,
    };
    const wordbookProvider: WordbookProvider = {
      addWord: async () => "added",
      checkWord: async () => Promise.reject(failure),
    };
    const dispatcher = createDispatcher({
      mapWordbookError: (error) => {
        mappedErrors.push(error);
        return mapped;
      },
      wordbookProvider,
    });

    dispatcher.dispatch(checkRequest, (event) => events.push(event));

    await vi.waitFor(() => expect(events.some((event) => event.type === "error")).toBe(true));
    expect(mappedErrors).toEqual([failure]);
    expect(events.at(-1)).toMatchObject({ error: mapped, type: "error" });
    dispatcher.dispose();
  });

  it("cancels a running check-word with one terminal error", async () => {
    const events: HostEvent[] = [];
    let aborted = false;
    const wordbookProvider: WordbookProvider = {
      addWord: async () => "added",
      checkWord: (_currentRequest, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener(
            "abort",
            () => {
              aborted = true;
              reject(new Error("aborted"));
            },
            { once: true },
          );
        }),
    };
    const dispatcher = createDispatcher({ wordbookProvider });

    dispatcher.dispatch(checkRequest, (event) => events.push(event));
    dispatcher.dispatch(
      {
        requestId: "cancel-2",
        schemaVersion: 3,
        targetRequestId: checkRequest.requestId,
        type: "cancel",
      },
      (event) => events.push(event),
    );

    await vi.waitFor(() => expect(aborted).toBe(true));
    expect(eventsFor(events, checkRequest.requestId).map((event) => event.type)).toEqual([
      "progress",
      "progress",
      "error",
    ]);
    dispatcher.dispose();
  });

  it("cancels a queued check-word without exceeding shared concurrency two", () => {
    const events: HostEvent[] = [];
    let checkCalls = 0;
    const provider: AnalysisProvider = {
      warmup: async () => undefined,
      analyze: (_currentRequest, signal) => waitForAbort(signal),
    };
    const wordbookProvider: WordbookProvider = {
      addWord: async () => "added",
      checkWord: async () => {
        checkCalls += 1;
        return "present";
      },
    };
    const dispatcher = createDispatcher({ provider, wordbookProvider });

    dispatcher.dispatch(request, (event) => events.push(event));
    dispatcher.dispatch({ ...request, requestId: "request-2" }, (event) => events.push(event));
    dispatcher.dispatch(checkRequest, (event) => events.push(event));
    dispatcher.dispatch(
      {
        requestId: "cancel-3",
        schemaVersion: 3,
        targetRequestId: checkRequest.requestId,
        type: "cancel",
      },
      (event) => events.push(event),
    );

    expect(checkCalls).toBe(0);
    expect(eventsFor(events, checkRequest.requestId).map((event) => event.type)).toEqual([
      "progress",
      "error",
    ]);
    dispatcher.dispose();
  });

  it("disposes active and queued work with the analysis provider exactly once", async () => {
    const events: HostEvent[] = [];
    let aborted = 0;
    let checkCalls = 0;
    let disposeCalls = 0;
    const provider: AnalysisProvider = {
      warmup: async () => undefined,
      analyze: (_currentRequest, signal, onDelta) =>
        new Promise((resolve) => {
          signal.addEventListener(
            "abort",
            () => {
              aborted += 1;
              onDelta?.({ delta: "late", section: "translation", type: "analysis-delta" });
              resolve(validResult);
            },
            { once: true },
          );
        }),
      dispose: () => {
        disposeCalls += 1;
      },
    };
    const wordbookProvider: WordbookProvider = {
      addWord: async () => "added",
      checkWord: async () => {
        checkCalls += 1;
        return "present";
      },
    };
    const dispatcher = createDispatcher({ maximumConcurrency: 1, provider, wordbookProvider });

    dispatcher.dispatch(request, (event) => events.push(event));
    dispatcher.dispatch(checkRequest, (event) => events.push(event));
    dispatcher.dispose();
    dispatcher.dispose();
    await Promise.resolve();

    expect({ aborted, checkCalls, disposeCalls }).toEqual({
      aborted: 1,
      checkCalls: 0,
      disposeCalls: 1,
    });
    expect(eventsFor(events, request.requestId).map((event) => event.type)).toEqual([
      "progress",
      "progress",
    ]);
    expect(eventsFor(events, checkRequest.requestId).map((event) => event.type)).toEqual([
      "progress",
    ]);
  });
});
