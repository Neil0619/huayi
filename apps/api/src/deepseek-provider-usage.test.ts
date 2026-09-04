import { contractFixtures } from "@huayi/cloud-contracts";
import { describe, expect, it, vi } from "vitest";

import { createDeepSeekAnalysisModel } from "./deepseek-analysis-model.js";
import { createDeepSeekExtensionQueryModel } from "./deepseek-extension-query-model.js";
import { parseDeepSeekAnalysisResponse } from "./deepseek-analysis-protocol.js";

const prices = {
  cachedInputMicroUsdPerMillionTokens: 10,
  inputMicroUsdPerMillionTokens: 100,
  outputMicroUsdPerMillionTokens: 200,
};
const usage = {
  completion_tokens: 30,
  completion_tokens_details: { reasoning_tokens: 20 },
  prompt_cache_hit_tokens: 40,
  prompt_cache_miss_tokens: 60,
  prompt_tokens: 100,
  prompt_tokens_details: { cached_tokens: 40 },
  total_tokens: 130,
};

function response(content: unknown, overrides: object = {}) {
  return Response.json({
    choices: [
      {
        finish_reason: "stop",
        index: 0,
        logprobs: null,
        message: { content: JSON.stringify(content), role: "assistant" },
      },
    ],
    model: "deepseek-v4-flash",
    usage: { ...usage, ...overrides },
  });
}

describe("DeepSeek provider usage compatibility", () => {
  it.each([{ prompt_cache_hit_tokens: undefined }, { prompt_tokens_details: undefined }])(
    "accounts for cache usage when only one supported representation is returned",
    async (overrides) => {
      await expect(
        parseDeepSeekAnalysisResponse(response({}, overrides), new AbortController().signal),
      ).resolves.toMatchObject({
        usage: { cachedInputTokens: 40, inputTokens: 100, outputTokens: 30 },
      });
    },
  );

  it("returns an extension translation when the provider includes cached token details", async () => {
    const fetch = vi.fn(async () =>
      response({
        selectionKind: "sentence",
        translationZh: "这值得学习。",
        type: "translate-passage",
      }),
    );
    const model = createDeepSeekExtensionQueryModel({ apiKey: "test-key", fetch, prices });
    const generated = await model.run(
      {
        action: "translate",
        selectionKind: "sentence",
        sourceText: "This is worth learning.",
        sourceType: "web-selection",
      },
      "query-1",
    );

    expect(generated.result).toMatchObject({ translationZh: "这值得学习。" });
    expect(generated.usage).toEqual({ cachedInputTokens: 40, inputTokens: 100, outputTokens: 30 });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(generated)).not.toContain("reasoning_tokens");
  });

  it("returns a deep analysis with the same provider usage envelope", async () => {
    const fetch = vi.fn(async () =>
      response({
        candidates: contractFixtures.analysis.candidates,
        result: contractFixtures.analysis.result,
      }),
    );
    const model = createDeepSeekAnalysisModel({ apiKey: "test-key", fetch, prices });
    const generated = await model.analyze({
      input: contractFixtures.startAnalysisRequest,
      sentences: [{ analysisUnitId: "u1", ordinal: 0, sourceText: "To be frank, this works." }],
    });

    expect(generated.content).toMatchObject({ result: contractFixtures.analysis.result });
    expect(generated.usage).toEqual({ cachedInputTokens: 40, inputTokens: 100, outputTokens: 30 });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    { prompt_tokens_details: { cached_tokens: -1 } },
    { prompt_tokens_details: { cached_tokens: 101 } },
    { prompt_tokens_details: { cached_tokens: 39 } },
    { prompt_tokens_details: { cached_tokens: 40, unexpected: 1 } },
    { prompt_cache_miss_tokens: 61 },
  ])("rejects inconsistent or unknown cache usage: %j", async (overrides) => {
    await expect(
      parseDeepSeekAnalysisResponse(response({}, overrides), new AbortController().signal),
    ).rejects.toMatchObject({ code: "model_response_invalid" });
  });
});
