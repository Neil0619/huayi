import { describe, expect, it } from "vitest";

import type { AnalysisResult, AnalyzeRequest } from "@huayi/protocol";

import type { AnalysisProvider } from "../provider/analysis-provider.js";
import {
  createDefaultDeepSeekSmokeRuntime,
  runDeepSeekSmoke,
  type DeepSeekSmokeReport,
  type DeepSeekSmokeRuntime,
} from "./run-deepseek-smoke.js";

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

function runtime(provider: AnalysisProvider): {
  reports: DeepSeekSmokeReport[];
  runtime: DeepSeekSmokeRuntime;
} {
  const reports: DeepSeekSmokeReport[] = [];
  let now = 0;
  return {
    reports,
    runtime: {
      createProvider: () => provider,
      now: () => ++now,
      writeReport: (report) => reports.push(report),
    },
  };
}

describe("runDeepSeekSmoke", () => {
  it("constructs a dedicated runtime without Codex or API environment variables", () => {
    expect(() =>
      createDefaultDeepSeekSmokeRuntime(
        {},
        "/Users/tester",
        "file:///build/diagnostics/run-deepseek-smoke.js",
      ),
    ).not.toThrow();
  });

  it("runs only the fixed corpus and reports anonymous timings", async () => {
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

    await expect(runDeepSeekSmoke(fixture.runtime)).resolves.toBe(0);

    expect(requests).toHaveLength(9);
    expect(requests.at(-1)).toMatchObject({ context: "hatch", selection: "hatch" });
    expect(fixture.reports).toEqual([
      expect.objectContaining({
        cancelled: 0,
        completed: 9,
        invalid: 0,
        mode: "non-thinking",
        model: "deepseek-v4-flash",
        timings: expect.arrayContaining([expect.objectContaining({ caseId: "case-09" })]),
      }),
    ]);
    const output = JSON.stringify(fixture.reports);
    for (const forbidden of ["investigation", "hatch", "测试翻译", "测试义", "api-key"]) {
      expect(output).not.toContain(forbidden);
    }
  });

  it("fails closed without exposing provider errors", async () => {
    const fixture = runtime({
      analyze: async () => Promise.reject(new Error("secret response body")),
      warmup: async () => undefined,
    });

    await expect(runDeepSeekSmoke(fixture.runtime)).resolves.toBe(1);

    expect(fixture.reports[0]).toMatchObject({ cancelled: 0, completed: 0, invalid: 9 });
    expect(JSON.stringify(fixture.reports)).not.toContain("secret response body");
  });
});
