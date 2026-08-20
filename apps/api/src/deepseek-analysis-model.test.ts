import { contractFixtures } from "@huayi/cloud-contracts";
import { describe, expect, it, vi } from "vitest";

import {
  createDeepSeekAnalysisModel,
  DEEPSEEK_PLATFORM_MODEL,
  DeepSeekAnalysisModelError,
  type DeepSeekAnalysisFetch,
} from "./deepseek-analysis-model.js";

const prices = {
  cachedInputMicroUsdPerMillionTokens: 500_000,
  inputMicroUsdPerMillionTokens: 1_000_000,
  outputMicroUsdPerMillionTokens: 2_000_000,
};

function providerResponse(
  content: unknown,
  options: {
    reasoning?: string;
    reasoningDetails?: boolean;
    reasoningTokens?: number;
    usage?: { cached: number; input: number; output: number };
  } = {},
): Response {
  const usage = options.usage ?? { cached: 20, input: 100, output: 200 };
  return new Response(
    JSON.stringify({
      choices: [
        {
          finish_reason: "stop",
          index: 0,
          message: {
            content: typeof content === "string" ? content : JSON.stringify(content),
            reasoning_content: options.reasoning ?? "private chain of thought",
            role: "assistant",
          },
        },
      ],
      created: 1,
      id: "provider-response",
      model: DEEPSEEK_PLATFORM_MODEL,
      object: "chat.completion",
      usage: {
        completion_tokens: usage.output,
        ...(options.reasoningTokens === undefined && options.reasoningDetails !== true
          ? {}
          : {
              completion_tokens_details:
                options.reasoningTokens === undefined
                  ? {}
                  : { reasoning_tokens: options.reasoningTokens },
            }),
        prompt_cache_hit_tokens: usage.cached,
        prompt_tokens: usage.input,
        total_tokens: usage.input + usage.output,
      },
    }),
    { headers: { "content-type": "application/json" }, status: 200 },
  );
}

function privateOutput() {
  return {
    candidates: contractFixtures.analysis.candidates,
    result: contractFixtures.analysis.result,
  };
}

function createFixture(fetch: DeepSeekAnalysisFetch) {
  return createDeepSeekAnalysisModel({
    apiKey: "test-platform-key-that-is-never-logged",
    fetch,
    prices,
  });
}

describe("DeepSeek platform analysis model", () => {
  it("accepts bounded reasoning token usage without exposing it", async () => {
    const fetch = vi.fn<DeepSeekAnalysisFetch>(async () =>
      providerResponse(privateOutput(), { reasoningTokens: 120 }),
    );

    const result = await createFixture(fetch).analyze({
      input: contractFixtures.startAnalysisRequest,
      sentences: [{ analysisUnitId: "u1", ordinal: 0, sourceText: "To be frank, this works." }],
    });

    expect(result.usage).toEqual({ cachedInputTokens: 20, inputTokens: 100, outputTokens: 200 });
    expect(JSON.stringify(result)).not.toContain("reasoningTokens");
  });

  it("accepts an empty strict completion token details object", async () => {
    const fetch = vi.fn<DeepSeekAnalysisFetch>(async () =>
      providerResponse(privateOutput(), { reasoningDetails: true }),
    );

    await expect(
      createFixture(fetch).analyze({
        input: contractFixtures.startAnalysisRequest,
        sentences: [{ analysisUnitId: "u1", ordinal: 0, sourceText: "To be frank, this works." }],
      }),
    ).resolves.toMatchObject({
      usage: { cachedInputTokens: 20, inputTokens: 100, outputTokens: 200 },
    });
  });

  it("pins the request contract, discards reasoning, and prices trusted usage", async () => {
    const fetch = vi.fn<DeepSeekAnalysisFetch>(async () =>
      providerResponse(privateOutput(), { reasoning: "never expose this reasoning" }),
    );
    const result = await createFixture(fetch).analyze({
      input: contractFixtures.startAnalysisRequest,
      sentences: [{ analysisUnitId: "u1", ordinal: 0, sourceText: "To be frank, this works." }],
    });

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe("https://api.deepseek.com/chat/completions");
    expect(init?.credentials).toBe("omit");
    expect(init?.redirect).toBe("error");
    expect(init?.headers.Authorization).toBe("Bearer test-platform-key-that-is-never-logged");
    const body = JSON.parse(init?.body ?? "{}") as Record<string, unknown>;
    expect(body).toMatchObject({
      max_tokens: 8_192,
      model: DEEPSEEK_PLATFORM_MODEL,
      reasoning_effort: "high",
      response_format: { type: "json_object" },
      stream: false,
      temperature: 0,
      thinking: { type: "enabled" },
    });
    expect(JSON.stringify(result)).not.toContain("never expose this reasoning");
    expect(result.usageCostMicroUsd).toBe(490);
    expect(result.content).toMatchObject({
      modelMetadata: {
        inputTokens: 100,
        model: DEEPSEEK_PLATFORM_MODEL,
        outputTokens: 200,
        provider: "deepseek",
      },
      sourceText: contractFixtures.startAnalysisRequest.sourceText,
    });
  });

  it("makes exactly one structure-only repair and aggregates both calls", async () => {
    const fetch = vi
      .fn<DeepSeekAnalysisFetch>()
      .mockResolvedValueOnce(
        providerResponse({ candidates: [], result: {} }, { reasoning: "first reasoning" }),
      )
      .mockResolvedValueOnce(
        providerResponse(privateOutput(), {
          reasoning: "repair reasoning",
          usage: { cached: 0, input: 50, output: 100 },
        }),
      );

    const result = await createFixture(fetch).analyze({
      input: contractFixtures.startAnalysisRequest,
      sentences: [{ analysisUnitId: "u1", ordinal: 0, sourceText: "To be frank, this works." }],
    });

    expect(fetch).toHaveBeenCalledTimes(2);
    const repairBody = fetch.mock.calls[1]?.[1].body ?? "";
    expect(repairBody).toContain("Repair structure only");
    expect(repairBody).not.toContain("first reasoning");
    expect(repairBody).not.toContain("repair reasoning");
    expect(result.usageCostMicroUsd).toBe(740);
    expect(result.billedCalls).toEqual([
      {
        costMicroUsd: 490,
        usage: { cachedInputTokens: 20, inputTokens: 100, outputTokens: 200 },
      },
      {
        costMicroUsd: 250,
        usage: { cachedInputTokens: 0, inputTokens: 50, outputTokens: 100 },
      },
    ]);
    expect(result.content).toMatchObject({
      modelMetadata: { inputTokens: 150, outputTokens: 300 },
    });
  });

  it("fails closed after one invalid repair while preserving priced failure usage", async () => {
    const fetch = vi
      .fn<DeepSeekAnalysisFetch>()
      .mockImplementation(async () => providerResponse({ candidates: [], result: {} }));

    const promise = createFixture(fetch).analyze({
      input: contractFixtures.startAnalysisRequest,
      sentences: [{ analysisUnitId: "u1", ordinal: 0, sourceText: "To be frank, this works." }],
    });

    await expect(promise).rejects.toMatchObject({
      billedCalls: [
        {
          costMicroUsd: 490,
          usage: { cachedInputTokens: 20, inputTokens: 100, outputTokens: 200 },
        },
        {
          costMicroUsd: 490,
          usage: { cachedInputTokens: 20, inputTokens: 100, outputTokens: 200 },
        },
      ],
      code: "model_output_invalid",
      usageCostMicroUsd: 980,
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("preserves the first billed call when the repair request fails", async () => {
    const fetch = vi
      .fn<DeepSeekAnalysisFetch>()
      .mockResolvedValueOnce(providerResponse({ candidates: [], result: {} }))
      .mockResolvedValueOnce(new Response("provider unavailable", { status: 503 }));

    await expect(
      createFixture(fetch).analyze({
        input: contractFixtures.startAnalysisRequest,
        sentences: [{ analysisUnitId: "u1", ordinal: 0, sourceText: "To be frank, this works." }],
      }),
    ).rejects.toMatchObject({
      billedCalls: [
        {
          costMicroUsd: 490,
          usage: { cachedInputTokens: 20, inputTokens: 100, outputTokens: 200 },
        },
      ],
      code: "model_unavailable",
      usageCostMicroUsd: 490,
    });
  });

  it("does not repair HTTP failures, timeouts, or invalid provider envelopes", async () => {
    const httpFetch = vi.fn<DeepSeekAnalysisFetch>(
      async () => new Response("private provider error", { status: 429 }),
    );
    await expect(
      createFixture(httpFetch).analyze({
        input: contractFixtures.startAnalysisRequest,
        sentences: [{ analysisUnitId: "u1", ordinal: 0, sourceText: "To be frank, this works." }],
      }),
    ).rejects.toMatchObject({ code: "model_unavailable" });
    expect(httpFetch).toHaveBeenCalledTimes(1);

    const invalidFetch = vi.fn<DeepSeekAnalysisFetch>(
      async () =>
        new Response(JSON.stringify({ unexpected: true }), {
          headers: { "content-type": "application/json" },
          status: 200,
        }),
    );
    await expect(
      createFixture(invalidFetch).analyze({
        input: contractFixtures.startAnalysisRequest,
        sentences: [{ analysisUnitId: "u1", ordinal: 0, sourceText: "To be frank, this works." }],
      }),
    ).rejects.toMatchObject({ code: "model_response_invalid" });
    expect(invalidFetch).toHaveBeenCalledTimes(1);

    const timeoutFetch = vi.fn<DeepSeekAnalysisFetch>(async (_url, init) => {
      await new Promise((_resolve, reject) => {
        init.signal.addEventListener("abort", () =>
          reject(new DOMException("Aborted", "AbortError")),
        );
      });
      throw new Error("unreachable");
    });
    await expect(
      createDeepSeekAnalysisModel({
        apiKey: "test-platform-key-that-is-never-logged",
        fetch: timeoutFetch,
        prices,
        timeoutMs: 5,
      }).analyze({
        input: contractFixtures.startAnalysisRequest,
        sentences: [{ analysisUnitId: "u1", ordinal: 0, sourceText: "To be frank, this works." }],
      }),
    ).rejects.toMatchObject({ code: "model_timeout" });
    expect(timeoutFetch).toHaveBeenCalledTimes(1);
  });

  it("times out while a successful response body is stalled", async () => {
    const fetch = vi.fn<DeepSeekAnalysisFetch>(
      async () =>
        new Response(
          new ReadableStream({
            start() {
              // Keep the body open until the adapter's total deadline fires.
            },
          }),
          { headers: { "content-type": "application/json" }, status: 200 },
        ),
    );

    await expect(
      createDeepSeekAnalysisModel({
        apiKey: "test-platform-key-that-is-never-logged",
        fetch,
        prices,
        timeoutMs: 5,
      }).analyze({
        input: contractFixtures.startAnalysisRequest,
        sentences: [{ analysisUnitId: "u1", ordinal: 0, sourceText: "To be frank, this works." }],
      }),
    ).rejects.toMatchObject({ code: "model_timeout" });
  });

  it("rejects an oversized response before parsing it or retrying", async () => {
    const fetch = vi.fn<DeepSeekAnalysisFetch>(
      async () =>
        new Response("x".repeat(1_048_577), {
          headers: { "content-type": "application/json" },
          status: 200,
        }),
    );

    await expect(
      createFixture(fetch).analyze({
        input: contractFixtures.startAnalysisRequest,
        sentences: [{ analysisUnitId: "u1", ordinal: 0, sourceText: "To be frank, this works." }],
      }),
    ).rejects.toBeInstanceOf(DeepSeekAnalysisModelError);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
