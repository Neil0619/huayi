import type {
  AnalysisEngine,
  AnalysisRequest,
  AnalysisResult,
  AnalysisUpdate,
  StoreSettings,
} from "@huayi/store-domain";
import { STORE_MESSAGE_VERSION } from "@huayi/store-domain";
import { describe, expect, it, vi } from "vitest";

import { createAnalysisSession, type AnalysisSessionPort } from "./analysis-session.js";

function port(): AnalysisSessionPort & {
  readonly messages: unknown[];
  receive(message: unknown): void;
  disconnect(): void;
} {
  const messages: unknown[] = [];
  let messageListener: ((message: unknown) => void) | undefined;
  let disconnectListener: (() => void) | undefined;
  return {
    messages,
    onDisconnect: { addListener: (listener) => (disconnectListener = listener) },
    onMessage: { addListener: (listener) => (messageListener = listener) },
    postMessage: (message) => messages.push(structuredClone(message)),
    receive: (message) => messageListener?.(message),
    disconnect: () => disconnectListener?.(),
  };
}

function settings(overrides: Partial<StoreSettings> = {}): StoreSettings {
  return {
    defaultAction: "ask",
    globallyEnabled: true,
    networkConsent: { grantedAt: "2026-08-11T01:00:00.000Z", version: 1 },
    overlayTheme: "pearl",
    providerId: "deepseek",
    recipientAccess: {
      eudic: { consent: null, enabled: false },
      shanbay: { consent: null, enabled: false },
    },
    schemaVersion: 6,
    sitePolicy: { defaultAction: "allow", rules: [] },
    youtubeMode: "english",
    youtubeShortcut: null,
    ...overrides,
  };
}

function start(overrides: Record<string, unknown> = {}): unknown {
  return {
    action: "translate",
    boundaryEvidence: { kind: "local-rules" },
    messageVersion: STORE_MESSAGE_VERSION,
    selection: "selected expression",
    sentenceContext: "The selected expression appears here.",
    type: "store/analysis-start",
    ...overrides,
  };
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("Store analysis session", () => {
  it("pins trusted settings, derives trusted metadata, and streams one engine invocation", async () => {
    const requests: AnalysisRequest[] = [];
    const engine: AnalysisEngine = {
      analyze: vi.fn(async (request, _signal, onUpdate): Promise<AnalysisResult> => {
        requests.push(request);
        const update: AnalysisUpdate = {
          requestId: request.requestId,
          stage: "queued",
          type: "progress",
        };
        onUpdate(update);
        return {
          collocations: [],
          contextualMeaningZh: "选定表达",
          coreMeanings: [{ meaningZh: "固定搭配", partOfSpeech: "phrase" }],
          requestId: request.requestId,
          selectionKind: "phrase",
          sourceText: request.selection,
          synonyms: [],
          type: "explain-lexical",
        };
      }),
    };
    const sessionPort = port();
    createAnalysisSession(sessionPort, {
      analysisEngine: engine,
      createRequestId: () => "trusted-request-1",
      getSettings: async () => settings(),
      siteHost: "example.com",
    });

    sessionPort.receive(start({ action: "explain" }));
    await settle();

    expect(requests).toEqual([
      {
        action: "explain",
        providerId: "deepseek",
        requestId: "trusted-request-1",
        selection: "selected expression",
        selectionKind: "phrase",
        sentenceContext: "The selected expression appears here.",
        targetLanguage: "zh-CN",
      },
    ]);
    expect(sessionPort.messages).toEqual([
      {
        messageVersion: STORE_MESSAGE_VERSION,
        type: "store/analysis-update",
        update: { requestId: "trusted-request-1", stage: "queued", type: "progress" },
      },
      {
        messageVersion: STORE_MESSAGE_VERSION,
        result: {
          collocations: [],
          contextualMeaningZh: "选定表达",
          coreMeanings: [{ meaningZh: "固定搭配", partOfSpeech: "phrase" }],
          requestId: "trusted-request-1",
          selectionKind: "phrase",
          sourceText: "selected expression",
          synonyms: [],
          type: "explain-lexical",
        },
        type: "store/analysis-result",
      },
    ]);
    expect(engine.analyze).toHaveBeenCalledOnce();
  });

  it("blocks missing consent before any paid request", async () => {
    const engine: AnalysisEngine = { analyze: vi.fn() };
    const sessionPort = port();
    createAnalysisSession(sessionPort, {
      analysisEngine: engine,
      createRequestId: () => "trusted-request-1",
      getSettings: async () => settings({ networkConsent: null }),
      siteHost: "example.com",
    });

    sessionPort.receive(start());
    await settle();

    expect(engine.analyze).not.toHaveBeenCalled();
    expect(sessionPort.messages).toEqual([
      {
        code: "consent-required",
        messageVersion: STORE_MESSAGE_VERSION,
        requestId: null,
        type: "store/analysis-error",
      },
    ]);
  });

  it("blocks a disabled sender site before engine access", async () => {
    const engine: AnalysisEngine = { analyze: vi.fn() };
    const sessionPort = port();
    createAnalysisSession(sessionPort, {
      analysisEngine: engine,
      createRequestId: () => "trusted-request-1",
      getSettings: async () =>
        settings({
          sitePolicy: {
            defaultAction: "allow",
            rules: [{ action: "block", hostname: "example.com", includeSubdomains: false }],
          },
        }),
      siteHost: "example.com",
    });

    sessionPort.receive(start());
    await settle();

    expect(engine.analyze).not.toHaveBeenCalled();
    expect(sessionPort.messages).toEqual([
      {
        code: "invalid-request",
        messageVersion: STORE_MESSAGE_VERSION,
        requestId: null,
        type: "store/analysis-error",
      },
    ]);
  });

  it("rejects malformed or authority-bearing starts and never retries", async () => {
    const engine: AnalysisEngine = { analyze: vi.fn() };
    const sessionPort = port();
    createAnalysisSession(sessionPort, {
      analysisEngine: engine,
      createRequestId: () => "trusted-request-1",
      getSettings: async () => settings(),
      siteHost: "example.com",
    });

    sessionPort.receive(start({ endpoint: "https://attacker.invalid", providerId: "openai" }));
    await settle();

    expect(engine.analyze).not.toHaveBeenCalled();
    expect(sessionPort.messages).toEqual([
      {
        code: "invalid-request",
        messageVersion: STORE_MESSAGE_VERSION,
        requestId: null,
        type: "store/analysis-error",
      },
    ]);
  });

  it.each(["update", "result"] as const)(
    "fails closed when the engine emits a %s for another trusted request",
    async (eventKind) => {
      const engine: AnalysisEngine = {
        analyze: vi.fn(async (request, _signal, onUpdate): Promise<AnalysisResult> => {
          if (eventKind === "update") {
            onUpdate({ requestId: "another-request", stage: "queued", type: "progress" });
          }
          return {
            collocations: [],
            contextualMeaningZh: "选定表达",
            partOfSpeech: "phrase",
            requestId: eventKind === "result" ? "another-request" : request.requestId,
            selectionKind: "phrase",
            similarTerms: [],
            sourceText: request.selection,
            type: "translate-lexical",
          };
        }),
      };
      const sessionPort = port();
      createAnalysisSession(sessionPort, {
        analysisEngine: engine,
        createRequestId: () => "trusted-request-1",
        getSettings: async () => settings(),
        siteHost: "example.com",
      });

      sessionPort.receive(start());
      await settle();

      expect(sessionPort.messages).toEqual([
        {
          code: "invalid-response",
          messageVersion: STORE_MESSAGE_VERSION,
          requestId: "trusted-request-1",
          type: "store/analysis-error",
        },
      ]);
    },
  );

  it("aborts on cancel and disconnect and allows only one start per port", async () => {
    const signals: AbortSignal[] = [];
    const engine: AnalysisEngine = {
      analyze: vi.fn((_request, signal): Promise<never> => {
        signals.push(signal as AbortSignal);
        return new Promise<never>((_resolve, reject) => {
          (signal as AbortSignal).addEventListener("abort", () => reject(new Error("cancelled")));
        });
      }),
    };
    const first = port();
    createAnalysisSession(first, {
      analysisEngine: engine,
      createRequestId: () => "trusted-request-1",
      getSettings: async () => settings(),
      siteHost: "example.com",
    });
    first.receive(start());
    await settle();
    first.receive({ messageVersion: STORE_MESSAGE_VERSION, type: "store/analysis-cancel" });
    await settle();
    expect(signals[0]?.aborted).toBe(true);
    expect(engine.analyze).toHaveBeenCalledOnce();

    const second = port();
    createAnalysisSession(second, {
      analysisEngine: engine,
      createRequestId: () => "trusted-request-2",
      getSettings: async () => settings(),
      siteHost: "example.com",
    });
    second.receive(start());
    await settle();
    second.receive(start());
    second.disconnect();
    await settle();
    expect(signals[1]?.aborted).toBe(true);
    expect(engine.analyze).toHaveBeenCalledTimes(2);
  });

  it("never posts a late result after the user disconnects", async () => {
    let resolve: ((result: AnalysisResult) => void) | undefined;
    const engine: AnalysisEngine = {
      analyze: vi.fn(
        (request): Promise<AnalysisResult> =>
          new Promise((complete) => {
            resolve = complete;
            expect(request.requestId).toBe("trusted-request-1");
          }),
      ),
    };
    const sessionPort = port();
    createAnalysisSession(sessionPort, {
      analysisEngine: engine,
      createRequestId: () => "trusted-request-1",
      getSettings: async () => settings(),
      siteHost: "example.com",
    });
    sessionPort.receive(start());
    await settle();
    sessionPort.disconnect();
    resolve?.({
      requestId: "trusted-request-1",
      selectionKind: "sentence",
      sourceText: "selected expression",
      translationZh: "翻译",
      type: "translate-passage",
    });
    await settle();

    expect(sessionPort.messages).toEqual([]);
  });

  it("keeps a completed local result independent from cloud learning capture", async () => {
    const engine: AnalysisEngine = {
      analyze: vi.fn(async (request): Promise<AnalysisResult> => ({
        requestId: request.requestId,
        selectionKind: "sentence",
        sourceText: request.selection,
        translationZh: "翻译",
        type: "translate-passage",
      })),
    };
    const sessionPort = port();
    createAnalysisSession(sessionPort, {
      analysisEngine: engine,
      createRequestId: () => "trusted-request-1",
      getSettings: async () => settings(),
      siteHost: "example.com",
    });
    sessionPort.receive(start());
    await settle();

    expect(sessionPort.messages.at(-1)).toMatchObject({ type: "store/analysis-result" });
  });
});
