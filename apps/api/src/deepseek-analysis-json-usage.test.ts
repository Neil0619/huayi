import { compactAnalysisFixture } from "./test-support/compact-analysis-fixture.js";
import { contractFixtures } from "@huayi/cloud-contracts";
import { describe, expect, it, vi } from "vitest";

import {
  createDeepSeekAnalysisModel,
  DEEPSEEK_PLATFORM_MODEL,
  type DeepSeekAnalysisFetch,
} from "./deepseek-analysis-model.js";

const prices = {
  cachedInputMicroUsdPerMillionTokens: 500_000,
  inputMicroUsdPerMillionTokens: 1_000_000,
  outputMicroUsdPerMillionTokens: 2_000_000,
};
const providerUsage = {
  completion_tokens: 200,
  prompt_cache_hit_tokens: 20,
  prompt_cache_miss_tokens: 80,
  prompt_tokens: 100,
  prompt_tokens_details: { cached_tokens: 20 },
  total_tokens: 300,
};
const usage = { cachedInputTokens: 20, inputTokens: 100, outputTokens: 200 };
// 20 cached + 80 uncached input tokens and 200 output tokens cost 10 + 80 + 400.
const billedCall = { costMicroUsd: 490, usage };
const validContent = JSON.stringify(compactAnalysisFixture());

function response(
  finishReason: string,
  content: string,
  overrides: { model?: string; usage?: object } = {},
) {
  return Response.json({
    choices: [
      {
        finish_reason: finishReason,
        index: 0,
        message: { content, role: "assistant" },
      },
    ],
    model: overrides.model ?? DEEPSEEK_PLATFORM_MODEL,
    usage: { ...providerUsage, ...overrides.usage },
  });
}

function analyze(fetch: DeepSeekAnalysisFetch) {
  return createDeepSeekAnalysisModel({ apiKey: "test-key", fetch, prices }).analyze({
    input: contractFixtures.startAnalysisRequest,
    sentences: [{ analysisUnitId: "u1", ordinal: 0, sourceText: "To be frank, this works." }],
  });
}

describe("DeepSeek JSON failure usage at the analysis model boundary", () => {
  it("accepts and prices the same provider identity and usage with a successful stop", async () => {
    const fetch = vi.fn<DeepSeekAnalysisFetch>(async () => response("stop", validContent));

    await expect(analyze(fetch)).resolves.toMatchObject({
      billedCalls: [billedCall],
      usage,
      usageCostMicroUsd: 490,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["nonempty", '{"previewZh":"partial', "model_output_invalid"],
    ["empty", "", "model_response_invalid"],
  ])(
    "preserves billed usage for length termination with %s content",
    async (_name, content, code) => {
      const fetch = vi.fn<DeepSeekAnalysisFetch>(async () => response("length", content));

      await expect(analyze(fetch)).rejects.toMatchObject({
        billedCalls: [billedCall],
        code,
        usage,
        usageCostMicroUsd: 490,
      });
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );

  it("rejects a non-stop finish despite valid output and retains its priced receipt", async () => {
    const fetch = vi.fn<DeepSeekAnalysisFetch>(async () =>
      response("content_filter", validContent),
    );

    await expect(analyze(fetch)).rejects.toMatchObject({
      billedCalls: [billedCall],
      code: "model_output_invalid",
      usage,
      usageCostMicroUsd: 490,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("retains usage for an empty stop response without attempting a content repair", async () => {
    const fetch = vi.fn<DeepSeekAnalysisFetch>(async () => response("stop", ""));

    await expect(analyze(fetch)).rejects.toMatchObject({
      billedCalls: [billedCall],
      code: "model_response_invalid",
      usage,
      usageCostMicroUsd: 490,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("preserves both receipts exactly once when the one repair ends at the token limit", async () => {
    const fetch = vi
      .fn<DeepSeekAnalysisFetch>()
      .mockResolvedValueOnce(response("stop", "{"))
      .mockResolvedValueOnce(
        response("length", '{"previewZh":"partial', {
          usage: {
            completion_tokens: 100,
            prompt_cache_hit_tokens: 0,
            prompt_cache_miss_tokens: 50,
            prompt_tokens: 50,
            prompt_tokens_details: { cached_tokens: 0 },
            total_tokens: 150,
          },
        }),
      );

    await expect(analyze(fetch)).rejects.toMatchObject({
      billedCalls: [
        billedCall,
        {
          costMicroUsd: 250,
          usage: { cachedInputTokens: 0, inputTokens: 50, outputTokens: 100 },
        },
      ],
      code: "model_output_invalid",
      usage: { cachedInputTokens: 20, inputTokens: 150, outputTokens: 300 },
      usageCostMicroUsd: 740,
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["provider model", { model: "another-provider-model" }],
    ["total tokens", { usage: { total_tokens: 301 } }],
    ["cache representations", { usage: { prompt_tokens_details: { cached_tokens: 19 } } }],
    ["cache miss total", { usage: { prompt_cache_miss_tokens: 81 } }],
    ["cache exceeds input", { usage: { prompt_cache_hit_tokens: 101 } }],
  ])("rejects untrusted %s before attaching a billing receipt", async (_name, overrides) => {
    const fetch = vi.fn<DeepSeekAnalysisFetch>(async () =>
      response("length", validContent, overrides),
    );
    const promise = analyze(fetch);

    await expect(promise).rejects.toMatchObject({
      billedCalls: undefined,
      code: "model_response_invalid",
      usage: undefined,
      usageCostMicroUsd: undefined,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
