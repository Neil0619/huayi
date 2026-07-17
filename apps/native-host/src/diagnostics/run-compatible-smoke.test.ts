import { describe, expect, it } from "vitest";

import type { AnalysisResult, AnalyzeRequest } from "@huayi/protocol";

import type { AnalysisProvider } from "../provider/analysis-provider.js";
import {
  createDefaultCompatibleSmokeRuntime,
  runConfiguredCompatibleSmoke,
  type CompatibleSmokeReport,
  type CompatibleSmokeRuntime,
} from "./run-compatible-smoke.js";

const configuration = {
  allowInsecureHttp: true,
  baseUrl: "http://secret-endpoint.example/v1",
  effort: "low",
  model: "gpt-5.4-mini",
  schemaVersion: 1,
} as const;

function validResult(request: AnalyzeRequest): AnalysisResult {
  if (request.action === "translate") {
    if (request.selectionKind === "word") {
      return {
        commonMeanings: [{ meaningsZh: ["测试义"], partOfSpeech: "noun" }],
        commonPhrases: [],
        confusableWords: [],
        contextualSense: { meaningZh: "测试义", partOfSpeech: "noun" },
        dictionaryForm: request.selection,
        selectionKind: "word",
        sourceText: request.selection,
        type: "translate-word",
      };
    }
    if (request.selectionKind === "phrase") {
      return {
        collocations: [],
        contextualMeaningZh: "测试义",
        partOfSpeech: "noun",
        selectionKind: request.selectionKind,
        similarTerms: [],
        sourceText: request.selection,
        type: "translate-lexical",
      };
    }
    return {
      selectionKind: request.selectionKind,
      sourceText: request.selection,
      translationZh: "测试翻译",
      type: "translate-passage",
    };
  }
  if (request.selectionKind === "sentence") {
    return {
      contextRole: "测试作用",
      keyExpressions: [{ meaningZh: "测试表达", text: "test expression" }],
      mainStructure: "测试主干",
      selectionKind: "sentence",
      sourceText: request.selection,
      translationZh: "测试翻译",
      type: "explain-sentence",
    };
  }
  if (request.selectionKind === "paragraph") {
    throw new Error("The fixed smoke corpus does not explain paragraphs.");
  }
  if (request.selectionKind === "word") {
    return {
      contextualAnalysisZh: "测试语境解析",
      selectionKind: "word",
      sourceText: request.selection,
      synonyms: [],
      type: "explain-word",
      usageNotes: [],
      wordForm: { baseForm: request.selection, formTypeZh: "原形" },
    };
  }
  return {
    collocations: [],
    contextualMeaningZh: "测试义",
    coreMeanings: [{ meaningZh: "测试义", partOfSpeech: "noun" }],
    selectionKind: request.selectionKind,
    sourceText: request.selection,
    synonyms: [],
    type: "explain-lexical",
  };
}

function runtime(provider: AnalysisProvider) {
  const reports: CompatibleSmokeReport[] = [];
  let now = 0;
  const result: CompatibleSmokeRuntime = {
    createProvider: () => provider,
    now: () => ++now,
    readConfiguration: async () => configuration,
    writeReport: (report) => reports.push(report),
  };
  return { reports, runtime: result };
}

describe("runConfiguredCompatibleSmoke", () => {
  it("constructs the dedicated runtime without Native Host or Codex environment variables", () => {
    expect(() =>
      createDefaultCompatibleSmokeRuntime({
        environment: {},
        homeDirectory: "/Users/tester",
        moduleUrl: "file:///build/diagnostics/run-compatible-smoke.js",
      }),
    ).not.toThrow();
  });

  it("runs only the fixed corpus and emits anonymous timings", async () => {
    const requests: AnalyzeRequest[] = [];
    const provider: AnalysisProvider = {
      analyze: async (request, _signal, onDelta) => {
        requests.push(request);
        onDelta?.({ delta: "测试", section: "translation", type: "analysis-delta" });
        return validResult(request);
      },
      warmup: async () => undefined,
    };
    const fixture = runtime(provider);

    await expect(runConfiguredCompatibleSmoke(fixture.runtime)).resolves.toBe(0);

    expect(requests).toHaveLength(8);
    expect(fixture.reports).toHaveLength(1);
    expect(fixture.reports[0]).toMatchObject({
      cancelled: 0,
      completed: 8,
      invalid: 0,
      profiles: [{ id: "compatible-gpt-5.4-mini-low" }],
    });
    expect(fixture.reports[0]?.profiles[0].cases).toHaveLength(8);
    expect(fixture.reports[0]?.profiles[0].cases[0]).toEqual({
      caseId: "case-01",
      completedMs: expect.any(Number),
      firstDeltaMs: expect.any(Number),
    });
    const output = JSON.stringify(fixture.reports);
    for (const forbidden of [
      "investigation",
      "secret-endpoint",
      "Authorization",
      "api-key",
      "测试翻译",
      "测试义",
    ]) {
      expect(output).not.toContain(forbidden);
    }
  });

  it.each([
    [
      "invalid result",
      async (request: AnalyzeRequest) => ({ ...validResult(request), sourceText: "wrong" }),
    ],
    ["failure", async () => Promise.reject(new Error("secret response body"))],
  ])("returns one for %s without exposing failure details", async (_label, analyze) => {
    const fixture = runtime({ analyze, warmup: async () => undefined } as AnalysisProvider);

    await expect(runConfiguredCompatibleSmoke(fixture.runtime)).resolves.toBe(1);

    expect(fixture.reports[0]).toMatchObject({ cancelled: 0, completed: 0, invalid: 8 });
    expect(JSON.stringify(fixture.reports)).not.toContain("secret response body");
  });

  it("counts typed cancellation separately and selects the luna profile", async () => {
    const fixture = runtime({
      analyze: async () => Promise.reject({ code: "CANCELLED" }),
      warmup: async () => undefined,
    });
    fixture.runtime.readConfiguration = async () => ({
      ...configuration,
      effort: "none",
      model: "gpt-5.6-luna",
    });

    await expect(runConfiguredCompatibleSmoke(fixture.runtime)).resolves.toBe(1);

    expect(fixture.reports[0]).toMatchObject({
      cancelled: 8,
      completed: 0,
      invalid: 0,
      profiles: [{ id: "compatible-gpt-5.6-luna-none" }],
    });
  });
});
