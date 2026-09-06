import { analysisContentSchema, contractFixtures } from "@huayi/cloud-contracts";
import { describe, expect, it, vi } from "vitest";

import { simulatedProviderResponse } from "./acceptance-provider-response.js";
import {
  createDeepSeekAnalysisModel,
  type DeepSeekAnalysisFetch,
} from "./deepseek-analysis-model.js";

const sentences = [
  { analysisUnitId: "u1", ordinal: 0, sourceText: "To be frank, this works." },
  { analysisUnitId: "u2", ordinal: 1, sourceText: "To be frank, this helps." },
];
const command = {
  input: {
    ...contractFixtures.startAnalysisRequest,
    sourceText: sentences.map((s) => s.sourceText).join(" "),
  },
  sentences,
};
const usage = { cachedInputTokens: 0, inputTokens: 64, outputTokens: 32 };
const billedCall = { costMicroUsd: 128, usage };

function privateOutput(ordinals: number[]) {
  const candidates = ordinals.map((ordinal, index) => ({
    ...contractFixtures.analysis.candidates[0],
    analysisUnitId: index < 2 ? "u1" : "u2",
    id: ["candidate-z", "candidate-a", "candidate-y", "candidate-b"][index] ?? "candidate-extra",
    ordinal,
    payload: { ...contractFixtures.analysis.candidates[0].payload, usageZh: `用法 ${index + 1}。` },
  }));
  return {
    candidates,
    result: {
      ...contractFixtures.analysis.result,
      sentences: sentences.map((sentence) => ({
        ...contractFixtures.analysis.result.sentences[0],
        ...sentence,
        candidateIds: candidates
          .filter((c) => c.analysisUnitId === sentence.analysisUnitId)
          .map((c) => c.id),
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
  const parsed = analysisContentSchema.parse(content);
  expect(parsed.candidates.map((candidate) => candidate.ordinal)).toEqual([0, 1, 2, 3]);
  expect(parsed.candidates).toEqual(
    output.candidates.map((candidate, ordinal) => ({ ...candidate, ordinal })),
  );
  expect(parsed.result).toEqual(output.result);
}

describe("DeepSeek candidate order canonicalization", () => {
  it.each<[string, number[]]>([
    ["one-based", [1, 2, 3, 4]],
    ["non-contiguous and descending", [9, 2, 199, 4]],
    ["per-unit reset", [0, 1, 0, 1]],
  ])(
    "accepts %s ordinals in one call without changing candidates or unit references",
    async (_name, ordinals) => {
      const output = privateOutput(ordinals);
      const fetch = vi.fn<DeepSeekAnalysisFetch>(async () =>
        simulatedProviderResponse(output, false),
      );
      const result = await model(fetch).analyze(command);
      expectPreserved(result.content, output);
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(result.billedCalls).toEqual([billedCall]);
    },
  );

  it("canonicalizes repair ordinals after an unrelated malformed first response within two calls", async () => {
    const output = privateOutput([1, 2, 1, 2]);
    const fetch = vi
      .fn<DeepSeekAnalysisFetch>()
      .mockResolvedValueOnce(simulatedProviderResponse({ candidates: [], result: {} }, false))
      .mockResolvedValueOnce(simulatedProviderResponse(output, false));
    const result = await model(fetch).analyze(command);
    expectPreserved(result.content, output);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(result.billedCalls).toEqual([billedCall, billedCall]);
    expect(result.usageCostMicroUsd).toBe(256);
  });

  it.each(["duplicate ids", "unknown reference", "wrong unit"])(
    "still rejects and bills %s",
    async (fault) => {
      const output = privateOutput([1, 2, 1, 2]);
      if (fault === "duplicate ids" && output.candidates[1] && output.candidates[0]) {
        output.candidates[1].id = output.candidates[0].id;
        const unit = output.result.sentences[0];
        if (unit) unit.candidateIds = [output.candidates[0].id];
      }
      if (fault === "unknown reference")
        output.result.sentences[0]?.candidateIds.push("candidate-unknown");
      if (fault === "wrong unit" && output.candidates[0])
        output.candidates[0].analysisUnitId = "u2";
      const fetch = vi.fn<DeepSeekAnalysisFetch>(async () =>
        simulatedProviderResponse(output, false),
      );
      await expect(model(fetch).analyze(command)).rejects.toMatchObject({
        code: "model_output_invalid",
        billedCalls: [billedCall, billedCall],
        usageCostMicroUsd: 256,
      });
      expect(fetch).toHaveBeenCalledTimes(2);
    },
  );

  it.each([undefined, -1, 0.5, 200])(
    "does not mask invalid private ordinal %s",
    async (ordinal) => {
      const output = privateOutput([0, 1, 2, 3]);
      const invalidOutput = {
        ...output,
        candidates: output.candidates.map((candidate, index) =>
          index === 0 ? { ...candidate, ordinal } : candidate,
        ),
      };
      const fetch = vi.fn<DeepSeekAnalysisFetch>(async () =>
        simulatedProviderResponse(invalidOutput, false),
      );
      await expect(model(fetch).analyze(command)).rejects.toMatchObject({
        code: "model_output_invalid",
        billedCalls: [billedCall, billedCall],
        usageCostMicroUsd: 256,
      });
      expect(fetch).toHaveBeenCalledTimes(2);
    },
  );
});
