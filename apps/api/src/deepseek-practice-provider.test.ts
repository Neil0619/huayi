import { describe, expect, it, vi } from "vitest";

import {
  createDeepSeekPracticeProvider,
  deepSeekPracticeMaximumUsage,
} from "./deepseek-practice-provider.js";
import type { DeepSeekAnalysisFetch } from "./deepseek-analysis-protocol.js";

const prices = {
  cachedInputMicroUsdPerMillionTokens: 500_000,
  inputMicroUsdPerMillionTokens: 1_000_000,
  outputMicroUsdPerMillionTokens: 2_000_000,
};
const input = {
  itemContent: {
    meaningZh: "坦率地说",
    text: "to be frank",
    type: "expression" as const,
    usageZh: "表达意见。",
  },
};

function response(content: unknown, inputTokens = 100, outputTokens = 50) {
  return new Response(
    JSON.stringify({
      choices: [
        {
          finish_reason: "stop",
          index: 0,
          message: {
            content: JSON.stringify(content),
            reasoning_content: "private",
            role: "assistant",
          },
        },
      ],
      model: "deepseek-v4-flash",
      usage: {
        completion_tokens: outputTokens,
        prompt_cache_hit_tokens: 0,
        prompt_tokens: inputTokens,
        total_tokens: inputTokens + outputTokens,
      },
    }),
    { headers: { "content-type": "application/json" }, status: 200 },
  );
}

describe("DeepSeek practice provider", () => {
  it("pins the provider request and sends only the bounded content input", async () => {
    const fetch = vi.fn<DeepSeekAnalysisFetch>(async () =>
      response({ kind: "sentence-prompt", prompt: "请用这个表达造句。" }),
    );
    const provider = createDeepSeekPracticeProvider({
      apiKey: "test-platform-key-that-is-never-logged",
      fetch,
      prices,
    });

    await expect(provider.generate({ input, kind: "sentence-prompt" })).resolves.toMatchObject({
      billedCalls: [{ costMicroUsd: 200 }],
      output: { kind: "sentence-prompt" },
    });
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe("https://api.deepseek.com/chat/completions");
    expect(init).toMatchObject({ credentials: "omit", method: "POST", redirect: "error" });
    const body = JSON.parse(init?.body ?? "{}") as Record<string, unknown>;
    expect(body).toMatchObject({
      max_tokens: 1_024,
      model: "deepseek-v4-flash",
      reasoning_effort: "high",
      response_format: { type: "json_object" },
      thinking: { type: "enabled" },
    });
    expect(init?.body).not.toContain("ownerUserId");
    expect(init?.body).not.toContain("generationId");
    expect(
      JSON.stringify(await provider.generate({ input, kind: "sentence-prompt" })),
    ).not.toContain("private");
  });

  it("repairs structure once and exposes every billed call on final failure", async () => {
    const fetch = vi.fn<DeepSeekAnalysisFetch>(async () => response({ wrong: true }));
    const provider = createDeepSeekPracticeProvider({
      apiKey: "test-platform-key-that-is-never-logged",
      fetch,
      prices,
    });

    await expect(provider.generate({ input, kind: "sentence-prompt" })).rejects.toMatchObject({
      billedCalls: [{ costMicroUsd: 200 }, { costMicroUsd: 200 }],
      stableErrorCode: "model_output_invalid",
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[1]?.[1].body).toContain("Repair structure only");
  });

  it("aborts a stalled provider at the configured deadline", async () => {
    let providerSignal: AbortSignal | undefined;
    const provider = createDeepSeekPracticeProvider({
      apiKey: "test-key",
      fetch: async (_url, init) => {
        providerSignal = init.signal;
        return new Promise<Response>((_resolve, reject) => {
          init.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        });
      },
      prices,
      timeoutMs: 1,
    });

    await expect(provider.generate({ input, kind: "sentence-prompt" })).rejects.toMatchObject({
      stableErrorCode: "model_unavailable",
    });
    expect(providerSignal?.aborted).toBe(true);
  });

  it("reserves for at most two bounded calls", () => {
    expect(deepSeekPracticeMaximumUsage("dialogue-final-feedback")).toEqual({
      inputTokens: 131_072,
      outputTokens: 8_192,
    });
  });
});
