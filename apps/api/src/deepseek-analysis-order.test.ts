import { analysisContentSchema, contractFixtures } from "@huayi/cloud-contracts";
import { describe, expect, it, vi } from "vitest";
import { simulatedProviderResponse } from "./acceptance-provider-response.js";
import {
  createDeepSeekAnalysisModel,
  type DeepSeekAnalysisFetch,
} from "./deepseek-analysis-model.js";
import { compactAnalysisFixture } from "./test-support/compact-analysis-fixture.js";
const sentences = ["To be frank, this works.", "To be frank, this helps."].map(
  (sourceText, ordinal) => ({ sourceText, ordinal, analysisUnitId: `u${ordinal + 1}` }),
);
const command = {
  input: {
    ...contractFixtures.startAnalysisRequest,
    sourceText: sentences.map((s) => s.sourceText).join(" "),
  },
  sentences,
};
const usage = { cachedInputTokens: 0, inputTokens: 64, outputTokens: 32 },
  billedCall = { costMicroUsd: 128, usage };
function privateOutput(counts: number[]) {
  const base = compactAnalysisFixture();
  return {
    ...base,
    result: {
      ...base.result,
      sentences: sentences.map((_s, unit) => ({
        ...base.result.sentences[0],
        candidates: Array.from({ length: counts[unit] ?? 0 }, (_, index) => ({
          ...contractFixtures.analysis.candidates[0].payload,
          text: "To be frank",
          usageZh: `用法 ${unit + 1}-${index + 1}。`,
        })),
      })),
    },
  };
}
function model(fetch: DeepSeekAnalysisFetch) {
  return createDeepSeekAnalysisModel({
    apiKey: "offline-test-key",
    fetch,
    prices: {
      cachedInputMicroUsdPerMillionTokens: 500_000,
      inputMicroUsdPerMillionTokens: 1_000_000,
      outputMicroUsdPerMillionTokens: 2_000_000,
    },
  });
}
function expectPreserved(content: unknown, output: ReturnType<typeof privateOutput>) {
  const parsed = analysisContentSchema.parse(content),
    payloads = output.result.sentences.flatMap((s) => s.candidates);
  expect(parsed.candidates.map((c) => c.ordinal)).toEqual(payloads.map((_p, i) => i));
  expect(parsed.candidates.map((c) => c.payload)).toEqual(payloads);
  let ordinal = 0;
  expect(parsed.result).toEqual({
    ...output.result,
    type: "sentence-passage-analysis-v2",
    sentences: output.result.sentences.map(({ candidates, ...teaching }, i) => ({
      ...teaching,
      ...sentences[i],
      candidateIds: candidates.map(() => `c${++ordinal}`),
    })),
  });
}

describe("trusted DeepSeek candidate order", () => {
  it.each([
    [2, 2],
    [3, 1],
    [0, 4],
  ])(
    "derives global contiguous order across local arrays %j without changing payloads",
    async (...counts) => {
      const output = privateOutput(counts),
        fetch = vi.fn<DeepSeekAnalysisFetch>(async () => simulatedProviderResponse(output, false));
      const generated = await model(fetch).analyze(command);
      expectPreserved(generated.content, output);
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(generated.billedCalls).toEqual([billedCall]);
    },
  );
  it("derives the same order after one malformed first response and bills both calls", async () => {
    const output = privateOutput([2, 2]);
    const fetch = vi
      .fn<DeepSeekAnalysisFetch>()
      .mockResolvedValueOnce(simulatedProviderResponse({ result: {} }, false))
      .mockResolvedValueOnce(simulatedProviderResponse(output, false));
    const generated = await model(fetch).analyze(command);
    expectPreserved(generated.content, output);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(generated.billedCalls).toEqual([billedCall, billedCall]);
    expect(generated.usageCostMicroUsd).toBe(256);
  });
  it.each(["analysisUnitId", "id", "ordinal", "candidateIds", "modelMetadata"])(
    "rejects injected %s rather than silently overwriting it",
    async (key) => {
      const output = privateOutput([2, 2]);
      const invalid = {
        ...output,
        result: {
          ...output.result,
          sentences: output.result.sentences.map((s) => ({
            ...s,
            candidates: s.candidates.map((p) => ({ ...p, [key]: "untrusted" })),
          })),
        },
      };
      const fetch = vi.fn<DeepSeekAnalysisFetch>(async () =>
        simulatedProviderResponse(invalid, false),
      );
      await expect(model(fetch).analyze(command)).rejects.toMatchObject({
        code: "model_output_invalid",
        billedCalls: [billedCall, billedCall],
        usageCostMicroUsd: 256,
      });
      expect(fetch).toHaveBeenCalledTimes(2);
    },
  );
  it("rejects the obsolete provider-controlled global references without a private-format fallback", async () => {
    const legacy = {
      candidates: contractFixtures.analysis.candidates,
      result: contractFixtures.analysis.result,
    };
    const fetch = vi.fn<DeepSeekAnalysisFetch>(async () =>
      simulatedProviderResponse(legacy, false),
    );
    await expect(model(fetch).analyze(command)).rejects.toMatchObject({
      code: "model_output_invalid",
      usageCostMicroUsd: 256,
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
