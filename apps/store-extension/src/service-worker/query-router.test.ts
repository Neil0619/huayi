import type {
  AnalysisCancellationSignal,
  AnalysisEngine,
  AnalysisRequest,
  AnalysisResult,
} from "@huayi/store-domain";
import { describe, expect, it, vi } from "vitest";

import { BrowserAnalysisError } from "../analysis/analysis-error.js";
import { createQueryRouter } from "./query-router.js";

const request: AnalysisRequest = {
  action: "explain",
  providerId: "deepseek",
  requestId: "request-1",
  selection: "The plan fell through.",
  selectionKind: "sentence",
  sentenceContext: null,
  targetLanguage: "zh-CN",
};

const result: AnalysisResult = {
  contextRole: "说明",
  keyExpressions: [{ meaningZh: "落空", text: "fell through" }],
  mainStructure: "结构",
  requestId: "request-1",
  selectionKind: "sentence",
  sourceText: "The plan fell through.",
  translationZh: "计划落空了。",
  type: "explain-sentence",
};

function engine(outcome: AnalysisResult | Error): AnalysisEngine {
  return {
    analyze: vi.fn(async () => {
      if (outcome instanceof Error) throw outcome;
      return outcome;
    }),
  };
}

const signal: AnalysisCancellationSignal = {
  aborted: false,
  throwIfAborted() {
    return undefined;
  },
};

describe("query router", () => {
  it("uses local BYOK while signed out and for an account in BYOK mode", async () => {
    const byok = engine(result);
    const platform = engine(new Error("must not run"));
    const preferences = [null, { extensionQueryModelMode: "byok" as const }];
    const router = createQueryRouter({
      byok,
      platform,
      readPreferences: async () => null,
      syncPreferences: async () => preferences.shift() ?? null,
    });

    await router.analyze(request, signal, () => undefined);
    await router.analyze(request, signal, () => undefined);

    expect(byok.analyze).toHaveBeenCalledTimes(2);
    expect(platform.analyze).not.toHaveBeenCalled();
  });

  it("pins platform mode at query start and never falls back to BYOK", async () => {
    const byok = engine(result);
    const failure = new BrowserAnalysisError("network-error");
    const platform = engine(failure);
    const router = createQueryRouter({
      byok,
      platform,
      readPreferences: async () => ({ extensionQueryModelMode: "platform" }),
      syncPreferences: async () => ({ extensionQueryModelMode: "platform" }),
    });

    const running = router.analyze(request, signal, () => undefined);

    await expect(running).rejects.toBe(failure);
    expect(platform.analyze).toHaveBeenCalledTimes(1);
    expect(byok.analyze).not.toHaveBeenCalled();
  });

  it("fails the current platform query when its session expires during preference sync", async () => {
    const byok = engine(result);
    const platform = engine(result);
    const router = createQueryRouter({
      byok,
      platform,
      readPreferences: async () => ({ extensionQueryModelMode: "platform" }),
      syncPreferences: async () => null,
    });

    await expect(router.analyze(request, signal, () => undefined)).rejects.toMatchObject({
      code: "credential-missing",
    });
    expect(byok.analyze).not.toHaveBeenCalled();
    expect(platform.analyze).not.toHaveBeenCalled();
  });
});
