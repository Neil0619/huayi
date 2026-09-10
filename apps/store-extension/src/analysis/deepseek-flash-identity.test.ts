import type { AnalysisRequest, DeviceVault } from "@huayi/store-domain";
import { describe, expect, it, vi } from "vitest";

import { BrowserAnalysisEngine } from "./browser-analysis-engine.js";
import type { ProviderFetch } from "./bounded-provider-stream.js";

// Keep the observed provider identity independent of the implementation constant.
// On 2026-09-10, both Flash request aliases returned this model in their SSE frames.
function frame(delta: object, finishReason: string | null = null, model = "deepseek-flash") {
  return `data: ${JSON.stringify({
    id: "observed-flash-response",
    object: "chat.completion.chunk",
    created: 1_788_920_000,
    model,
    system_fingerprint: "test-fingerprint",
    choices: [{ index: 0, delta, logprobs: null, finish_reason: finishReason }],
  })}\n\n`;
}

function stream(models: { first?: string; middle?: string } = {}) {
  return [
    frame({ role: "assistant", content: "" }, null, models.first),
    frame(
      { content: JSON.stringify({ translationZh: "这是一段测试译文。" }) },
      null,
      models.middle,
    ),
    frame({ content: "" }, "stop"),
    "data: [DONE]\n\n",
  ].join("");
}

const vault: DeviceVault = {
  deleteCredential: async () => undefined,
  ensureReady: async () => undefined,
  getDek: async () => new Uint8Array(32),
  getCredential: async () => "test-deepseek-key",
  getReadiness: async () => "ready",
  migrateLegacy: async () => undefined,
  setCredential: async () => undefined,
};

function setup(source: string) {
  const fetch = vi.fn<ProviderFetch>(async () => ({
    status: 200,
    headers: new Headers({ "Content-Type": "text/event-stream" }),
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(source));
        controller.close();
      },
    }),
  }));
  const engine = new BrowserAnalysisEngine({ deviceVault: vault, fetch });
  return {
    fetch,
    analyze(selectionKind: AnalysisRequest["selectionKind"] = "sentence") {
      return engine.analyze(
        {
          action: "translate",
          providerId: "deepseek",
          requestId: "flash-translation",
          selection: "The first sentence is here. Another sentence follows.",
          selectionKind,
          sentenceContext: "The first sentence is here. Another sentence follows.",
          targetLanguage: "zh-CN",
        },
        new AbortController().signal,
        () => undefined,
      );
    },
  };
}

describe("Store BYOK DeepSeek Flash provider identity", () => {
  it.each(["sentence", "passage"] as const)(
    "translates a %s from the provider's current Flash response",
    async (selectionKind) => {
      const { analyze, fetch } = setup(stream());

      await expect(analyze(selectionKind)).resolves.toMatchObject({
        type: "translate-passage",
        translationZh: "这是一段测试译文。",
      });
      expect(fetch).toHaveBeenCalledTimes(1);
      const call = fetch.mock.calls[0];
      if (!call) throw new Error("Expected a DeepSeek request.");
      const [endpoint, init] = call;
      expect(endpoint).toBe("https://api.deepseek.com/chat/completions");
      expect(JSON.parse(init.body)).toMatchObject({
        model: "deepseek-flash",
        thinking: { type: "disabled" },
        stream: true,
      });
    },
  );

  it("rejects a different model instead of accepting an arbitrary identity", async () => {
    await expect(setup(stream({ first: "deepseek-pro" })).analyze()).rejects.toMatchObject({
      code: "invalid-response",
    });
  });

  it("rejects a model change after the accepted opening frame", async () => {
    await expect(setup(stream({ middle: "deepseek-v4-flash" })).analyze()).rejects.toMatchObject({
      code: "invalid-response",
    });
  });
});
