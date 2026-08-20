import { describe, expect, it, vi } from "vitest";

import {
  createDeepSeekExtensionQueryModel,
  type DeepSeekExtensionQueryFetch,
} from "./deepseek-extension-query-model.js";
import { DeepSeekAnalysisModelError } from "./deepseek-analysis-protocol.js";

function response(content: unknown): Response {
  return new Response(
    JSON.stringify({
      choices: [
        {
          finish_reason: "stop",
          index: 0,
          message: { content: JSON.stringify(content), role: "assistant" },
        },
      ],
      model: "deepseek-v4-flash",
      usage: { completion_tokens: 5, prompt_tokens: 10, total_tokens: 15 },
    }),
    { headers: { "Content-Type": "application/json" }, status: 200 },
  );
}

describe("DeepSeek ExtensionQuery model", () => {
  it("assembles trusted compact fields and bills the strict provider usage", async () => {
    const fetch = vi.fn<DeepSeekExtensionQueryFetch>(async (_url, init) => {
      const body = JSON.parse(init.body) as { messages: { content: string }[] };
      expect(body.messages.at(-1)?.content).toContain("The plan fell through.");
      expect(body.messages.at(-1)?.content).not.toContain("userId");
      return response({
        contextRole: "谓语",
        keyExpressions: [{ meaningZh: "落空", text: "fell through" }],
        mainStructure: "主语 + 谓语",
        selectionKind: "sentence",
        translationZh: "计划落空了。",
        type: "explain-sentence",
      });
    });
    const model = createDeepSeekExtensionQueryModel({
      apiKey: "secret",
      fetch,
      prices: {
        cachedInputMicroUsdPerMillionTokens: 1,
        inputMicroUsdPerMillionTokens: 2,
        outputMicroUsdPerMillionTokens: 3,
      },
    });

    const generated = await model.run(
      {
        action: "explain",
        selectionKind: "sentence",
        sourceText: "The plan fell through.",
        sourceType: "web-selection",
      },
      "generation-1",
    );

    expect(generated.result).toMatchObject({
      requestId: "generation-1",
      sourceText: "The plan fell through.",
      type: "explain-sentence",
    });
    expect(generated.usage).toEqual({ cachedInputTokens: 0, inputTokens: 10, outputTokens: 5 });
    expect(generated.costMicroUsd).toBeGreaterThanOrEqual(0);
  });

  it("fails closed on invalid timeout configuration and aborts a stalled provider", async () => {
    const base = {
      apiKey: "test-key",
      prices: {
        cachedInputMicroUsdPerMillionTokens: 1,
        inputMicroUsdPerMillionTokens: 2,
        outputMicroUsdPerMillionTokens: 3,
      },
    };
    expect(() =>
      createDeepSeekExtensionQueryModel({
        ...base,
        timeoutMs: 90_001,
      }),
    ).toThrow(DeepSeekAnalysisModelError);

    let providerSignal: AbortSignal | undefined;
    const model = createDeepSeekExtensionQueryModel({
      ...base,
      fetch: async (_url, init) => {
        providerSignal = init.signal;
        return new Promise<Response>((_resolve, reject) => {
          init.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
        });
      },
      timeoutMs: 1,
    });

    await expect(
      model.run(
        {
          action: "explain",
          selectionKind: "sentence",
          sourceText: "The plan fell through.",
          sourceType: "web-selection",
        },
        "generation-timeout",
      ),
    ).rejects.toMatchObject({ code: "model_timeout" });
    expect(providerSignal?.aborted).toBe(true);
  });
});
