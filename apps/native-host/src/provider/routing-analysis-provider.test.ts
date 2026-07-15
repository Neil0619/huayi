import { describe, expect, it, vi } from "vitest";

import type { AnalysisResult, AnalyzeRequest, ModelProvider } from "@huayi/protocol";

import type { AnalysisProvider, AnalysisStreamListener } from "./analysis-provider.js";
import { RoutingAnalysisProvider } from "./routing-analysis-provider.js";

const request: AnalyzeRequest = {
  action: "translate",
  context: "The investigation was in its early stages.",
  requestId: "analysis-1",
  schemaVersion: 4,
  selection: "investigation",
  selectionKind: "word",
  sentenceContext: null,
  targetLanguage: "zh-CN",
  type: "analyze",
};

const apiResult: AnalysisResult = {
  collocations: [],
  contextualMeaningZh: "调查",
  partOfSpeech: "noun",
  selectionKind: "word",
  similarTerms: [],
  sourceText: "investigation",
  type: "translate-lexical",
};

class MutableConfigurationStore {
  provider: ModelProvider = "codex";
  readonly read = vi.fn(async () => this.provider);
}

function deferred<T>(): {
  promise: Promise<T>;
  reject(error: unknown): void;
  resolve(value: T): void;
} {
  let resolvePromise: (value: T) => void = () => undefined;
  let rejectPromise: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return { promise, reject: rejectPromise, resolve: resolvePromise };
}

function fakeProvider(
  analyze: AnalysisProvider["analyze"] = async () => apiResult,
): AnalysisProvider & {
  analyze: ReturnType<typeof vi.fn<AnalysisProvider["analyze"]>>;
  dispose: ReturnType<typeof vi.fn>;
  warmup: ReturnType<typeof vi.fn<AnalysisProvider["warmup"]>>;
} {
  return {
    analyze: vi.fn(analyze),
    dispose: vi.fn(),
    warmup: vi.fn(async (signal: AbortSignal) => {
      void signal;
    }),
  };
}

describe("RoutingAnalysisProvider", () => {
  it("fails compatible analysis closed until its dedicated Provider is wired", async () => {
    const store = new MutableConfigurationStore();
    store.provider = "openai-compatible-http";
    const codex = fakeProvider();
    const openAI = fakeProvider();
    const router = new RoutingAnalysisProvider({ configurationStore: store, codex, openAI });

    await expect(router.analyze(request, new AbortController().signal)).rejects.toThrow(
      "Compatible HTTP provider is not available.",
    );

    expect(store.read).toHaveBeenCalledOnce();
    expect(codex.analyze).not.toHaveBeenCalled();
    expect(openAI.analyze).not.toHaveBeenCalled();
  });

  it("fails compatible warmup closed until its dedicated Provider is wired", async () => {
    const store = new MutableConfigurationStore();
    store.provider = "openai-compatible-http";
    const codex = fakeProvider();
    const openAI = fakeProvider();
    const router = new RoutingAnalysisProvider({ configurationStore: store, codex, openAI });

    await expect(router.warmup(new AbortController().signal)).rejects.toThrow(
      "Compatible HTTP provider is not available.",
    );

    expect(store.read).toHaveBeenCalledOnce();
    expect(codex.warmup).not.toHaveBeenCalled();
    expect(openAI.warmup).not.toHaveBeenCalled();
  });

  it("pins an active request to the provider selected by its single configuration read", async () => {
    const store = new MutableConfigurationStore();
    const pendingApi = deferred<AnalysisResult>();
    const codex = fakeProvider();
    const openAI = fakeProvider(async () => pendingApi.promise);
    const router = new RoutingAnalysisProvider({ configurationStore: store, codex, openAI });
    const listener: AnalysisStreamListener = () => undefined;
    const signal = new AbortController().signal;

    store.provider = "openai-responses";
    const pending = router.analyze(request, signal, listener);
    store.provider = "codex";
    pendingApi.resolve(apiResult);

    await expect(pending).resolves.toEqual(apiResult);
    await router.analyze({ ...request, requestId: "analysis-2" }, signal, listener);

    expect(store.read).toHaveBeenCalledTimes(2);
    expect(openAI.analyze).toHaveBeenCalledTimes(1);
    expect(openAI.analyze).toHaveBeenCalledWith(request, signal, listener);
    expect(codex.analyze).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["openai-responses", "api failure", "openAI", "codex"],
    ["codex", "codex failure", "codex", "openAI"],
  ] as const)("does not fall back after a %s failure", async (provider, message, used, unused) => {
    const store = new MutableConfigurationStore();
    store.provider = provider;
    const failure = new Error(message);
    const codex = fakeProvider(
      provider === "codex" ? async () => Promise.reject(failure) : undefined,
    );
    const openAI = fakeProvider(
      provider === "openai-responses" ? async () => Promise.reject(failure) : undefined,
    );
    const providers = { codex, openAI };
    const router = new RoutingAnalysisProvider({ configurationStore: store, codex, openAI });

    await expect(router.analyze(request, new AbortController().signal)).rejects.toBe(failure);

    expect(store.read).toHaveBeenCalledTimes(1);
    expect(providers[used].analyze).toHaveBeenCalledTimes(1);
    expect(providers[unused].analyze).not.toHaveBeenCalled();
  });

  it("warms Codex only in Codex mode and performs only the local read in API mode", async () => {
    const store = new MutableConfigurationStore();
    const codex = fakeProvider();
    const openAI = fakeProvider();
    const router = new RoutingAnalysisProvider({ configurationStore: store, codex, openAI });
    const signal = new AbortController().signal;

    store.provider = "codex";
    await router.warmup(signal);
    store.provider = "openai-responses";
    await router.warmup(signal);

    expect(store.read).toHaveBeenCalledTimes(2);
    expect(codex.warmup).toHaveBeenCalledOnce();
    expect(codex.warmup).toHaveBeenCalledWith(signal);
    expect(openAI.warmup).not.toHaveBeenCalled();
    expect(codex.analyze).not.toHaveBeenCalled();
    expect(openAI.analyze).not.toHaveBeenCalled();
  });

  it("disposes both providers exactly once", () => {
    const store = new MutableConfigurationStore();
    const codex = fakeProvider();
    const openAI = fakeProvider();
    const router = new RoutingAnalysisProvider({ configurationStore: store, codex, openAI });

    router.dispose();
    router.dispose();

    expect(codex.dispose).toHaveBeenCalledOnce();
    expect(openAI.dispose).toHaveBeenCalledOnce();
  });
});
