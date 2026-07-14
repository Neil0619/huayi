import { describe, expect, it, vi } from "vitest";

import { analysisResultSchema } from "@huayi/protocol";
import type { OpenAIApiKeyReader } from "../credentials/openai-keychain.js";
import type { AnalysisProvider, AnalysisStreamUpdate } from "../provider/analysis-provider.js";
import type {
  AnalysisProviderFactory,
  AnalysisProviderFactoryOptions,
} from "../provider/analysis-provider-factory.js";
import type { OpenAIFetch } from "../provider/openai-responses-client.js";
import type { CodexAppServer } from "../runtime/codex-app-server-lifecycle.js";
import { CodexProviderError } from "../runtime/error-mapper.js";
import {
  COMPARISON_PROFILE_IDS,
  comparisonCaseIds,
  comparisonTableRows,
  nearestRankPercentile,
  runProviderComparison,
  serializeComparisonReport,
  type ComparisonProviderFactory,
} from "./compare-providers.js";
import { createComparisonProviders } from "./comparison-provider-runtime.js";

const SENTINEL_KEY = "sk-sentinel-secret";
const SENTINEL_CONTEXT = "sentinel private context";
const SENTINEL_PROMPT = "sentinel private prompt";
const SENTINEL_ASSISTANT_RESULT = "sentinel private assistant result";
const SENTINEL_AUTHORIZATION = `Bearer ${SENTINEL_KEY}`;

function validResult(request: Parameters<AnalysisProvider["analyze"]>[0]) {
  if (request.selectionKind === "sentence") {
    return analysisResultSchema.parse({
      contextRole: "上下文作用",
      keyExpressions: [{ meaningZh: "含义", text: "come forward" }],
      mainStructure: "主句结构",
      selectionKind: "sentence",
      sourceText: request.selection,
      translationZh: SENTINEL_ASSISTANT_RESULT,
      type: "explain-sentence",
    });
  }
  if (request.selectionKind === "paragraph") {
    return analysisResultSchema.parse({
      selectionKind: "paragraph",
      sourceText: request.selection,
      translationZh: SENTINEL_ASSISTANT_RESULT,
      type: "translate-passage",
    });
  }
  if (request.action === "explain") {
    return analysisResultSchema.parse({
      collocations: [{ meaningZh: "搭配", text: "sentinel collocation" }],
      contextualMeaningZh: SENTINEL_ASSISTANT_RESULT,
      coreMeanings: [{ meaningZh: "核心含义", partOfSpeech: "noun" }],
      selectionKind: request.selectionKind,
      sourceText: request.selection,
      synonyms: [{ meaningZh: "近义", partOfSpeech: "noun", text: "sentinel synonym" }],
      type: "explain-lexical",
    });
  }
  return analysisResultSchema.parse({
    collocations: [{ meaningZh: "搭配", text: "sentinel collocation" }],
    contextualMeaningZh: SENTINEL_ASSISTANT_RESULT,
    partOfSpeech: "noun",
    selectionKind: request.selectionKind,
    similarTerms: [{ meaningZh: "相似", partOfSpeech: "noun", text: "sentinel similar" }],
    sourceText: request.selection,
    type: "translate-lexical",
  });
}

function successfulFactory(): ComparisonProviderFactory {
  return (milestones) => ({
    async analyze(request, _signal, onUpdate) {
      milestones.upstreamSent();
      milestones.rawDelta();
      const updates: AnalysisStreamUpdate[] = [
        { delta: SENTINEL_ASSISTANT_RESULT, section: "contextual-meaning", type: "analysis-delta" },
        {
          section: "collocations",
          type: "analysis-section",
          value: [{ meaningZh: "搭配", text: "sentinel collocation" }],
        },
        {
          section: "collocations",
          type: "analysis-section",
          value: [
            { meaningZh: "搭配", text: "sentinel collocation" },
            { meaningZh: "搭配二", text: "sentinel second collocation" },
          ],
        },
      ];
      for (const update of updates) onUpdate?.(update);
      return validResult(request);
    },
    async warmup(signal) {
      void signal;
    },
  });
}

function fixedProviders(factory = successfulFactory()) {
  return {
    "api-gpt-5.4-mini-low": factory,
    "api-gpt-5.6-luna-none": factory,
    "codex-gpt-5.4-mini-low": factory,
  } as const;
}

describe("Provider comparison diagnostics", () => {
  it("uses only the fixed corpus IDs and fixed profiles", () => {
    expect(comparisonCaseIds).toEqual([
      "word-investigation",
      "word-sustained",
      "word-victims",
      "word-accountable",
      "word-four",
      "phrase",
      "sentence",
      "paragraph",
    ]);
    expect(COMPARISON_PROFILE_IDS).toEqual([
      "codex-gpt-5.4-mini-low",
      "api-gpt-5.4-mini-low",
      "api-gpt-5.6-luna-none",
    ]);
  });

  it("computes nearest-rank P50 and P90", () => {
    const samples = [90, 10, 70, 20, 60, 30, 50, 40, 80, 100];

    expect(nearestRankPercentile(samples, 50)).toBe(50);
    expect(nearestRankPercentile(samples, 90)).toBe(90);
    expect(nearestRankPercentile([], 50)).toBeNull();
  });

  it("records safe milestones and never emits corpus, prompt, Key, header, or model text", async () => {
    let tick = 1_000;
    const report = await runProviderComparison({
      now: () => (tick += 7),
      providers: fixedProviders(),
    });
    const output = `${serializeComparisonReport(report)}\n${JSON.stringify(
      comparisonTableRows(report),
    )}`;

    expect(report.qualityPassed).toBe(true);
    expect(report.samples).toHaveLength(comparisonCaseIds.length * COMPARISON_PROFILE_IDS.length);
    expect(report.samples[0]).toMatchObject({
      arrivals: [
        { index: 0, kind: "section", section: "contextual-meaning" },
        { index: 0, kind: "item", section: "collocations" },
        { index: 1, kind: "item", section: "collocations" },
      ],
      caseId: "word-investigation",
      profile: "codex-gpt-5.4-mini-low",
      timingsMs: {
        firstRawDelta: expect.any(Number),
        firstValidatedVisibleUpdate: expect.any(Number),
        hostStart: 0,
        providerStart: expect.any(Number),
        strictCompletion: expect.any(Number),
        upstreamSent: expect.any(Number),
      },
    });
    for (const profile of report.profiles) {
      expect(profile.counts).toEqual({ cancelled: 0, invalid: 0, success: 8, total: 8 });
      expect(profile.percentilesMs.strictCompletion).toEqual({
        p50: expect.any(Number),
        p90: expect.any(Number),
      });
    }

    for (const privateValue of [
      SENTINEL_KEY,
      SENTINEL_CONTEXT,
      SENTINEL_PROMPT,
      SENTINEL_ASSISTANT_RESULT,
      SENTINEL_AUTHORIZATION,
      "in the early stages",
      "He urged anyone to come forward.",
      "First sentence. Second sentence.",
      "sentinel collocation",
      "sentinel synonym",
    ]) {
      expect(output).not.toContain(privateValue);
    }
    for (const caseIdSuffix of ["investigation", "sustained", "victims", "accountable"]) {
      expect(output.match(new RegExp(caseIdSuffix, "g"))).toHaveLength(
        COMPARISON_PROFILE_IDS.length,
      );
    }
  });

  it("counts strict-schema failures and cancellations separately", async () => {
    const factory: ComparisonProviderFactory = (milestones) => ({
      async analyze(request) {
        milestones.upstreamSent();
        milestones.rawDelta();
        if (request.requestId.endsWith("word-investigation")) {
          return { unsafe: SENTINEL_ASSISTANT_RESULT } as never;
        }
        if (request.requestId.endsWith("word-sustained")) {
          throw new CodexProviderError("CANCELLED", "cancelled", false);
        }
        return validResult(request);
      },
      async warmup(signal) {
        void signal;
      },
    });

    const report = await runProviderComparison({
      now: (() => {
        let tick = 0;
        return () => ++tick;
      })(),
      providers: fixedProviders(factory),
    });

    expect(report.qualityPassed).toBe(false);
    expect(report.profiles[0]?.counts).toEqual({ cancelled: 1, invalid: 1, success: 6, total: 8 });
    expect(serializeComparisonReport(report)).not.toContain(SENTINEL_ASSISTANT_RESULT);
  });

  it("constructs only the three fixed profiles through the shared Provider factory", async () => {
    const captured: AnalysisProviderFactoryOptions[] = [];
    const provider: AnalysisProvider = {
      async analyze(request) {
        return validResult(request);
      },
      async warmup(signal) {
        void signal;
      },
    };
    const createFactory = (options: AnalysisProviderFactoryOptions): AnalysisProviderFactory => {
      captured.push(options);
      return {
        analysisProvider: provider,
        async healthCheck() {
          throw new Error("Health is outside comparison scope.");
        },
        wordbookProvider: {
          async addWord() {
            throw new Error("Wordbook is outside comparison scope.");
          },
          async checkWord() {
            throw new Error("Wordbook is outside comparison scope.");
          },
        },
      };
    };
    const appServer: CodexAppServer = {
      dispose() {
        return undefined;
      },
      async interrupt(requestId) {
        void requestId;
      },
      async runTurn(request) {
        request.onAssistantDelta("private raw delta");
        return "";
      },
      async warmup(signal) {
        void signal;
      },
    };
    const apiKeyReader = {
      async read() {
        return SENTINEL_KEY;
      },
    } as unknown as OpenAIApiKeyReader;
    const openAIFetch: OpenAIFetch = async () => {
      throw new Error("Fetch is outside fixed-profile construction.");
    };

    const providers = createComparisonProviders({
      apiKeyReader,
      appServer,
      createFactory,
      openAIFetch,
      schemaDirectory: "/fixed/schema/directory",
    });

    expect(Object.keys(providers)).toEqual(COMPARISON_PROFILE_IDS);
    expect(await captured[0]?.configurationStore.read()).toBe("codex");
    expect(captured[0]?.openAIModelConfiguration).toBeUndefined();
    expect(await captured[1]?.configurationStore.read()).toBe("openai-responses");
    expect(captured[1]?.openAIModelConfiguration).toEqual({ effort: "low", model: "gpt-5.4-mini" });
    expect(await captured[2]?.configurationStore.read()).toBe("openai-responses");
    expect(captured[2]?.openAIModelConfiguration).toEqual({
      effort: "none",
      model: "gpt-5.6-luna",
    });
    expect(captured).toHaveLength(3);
    expect(
      captured.every(({ schemaDirectory }) => schemaDirectory === "/fixed/schema/directory"),
    ).toBe(true);

    const milestones = { rawDelta: vi.fn(), upstreamSent: vi.fn() };
    providers["codex-gpt-5.4-mini-low"](milestones);
    await captured[0]?.appServer.runTurn({
      onAssistantDelta: () => undefined,
      outputSchema: {},
      prompt: SENTINEL_PROMPT,
      requestId: "runtime-order",
      signal: new AbortController().signal,
    });
    expect(milestones.rawDelta).toHaveBeenCalledOnce();
    expect(milestones.upstreamSent).not.toHaveBeenCalled();
  });
});
