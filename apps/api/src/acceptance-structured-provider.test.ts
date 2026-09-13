import { describe, expect, it, vi } from "vitest";
import { createDeepSeekAnalysisModel } from "./deepseek-analysis-model.js";
import { createDeepSeekExtensionQueryModel } from "./deepseek-extension-query-model.js";
import {
  acceptanceProviderFetch,
  LOCAL_ACCEPTANCE_PROVIDER_KEY,
} from "./acceptance-provider-fetch.js";
import { analysisSourceUnits } from "./analysis-segmentation.js";

const prices = {
  cachedInputMicroUsdPerMillionTokens: 1,
  inputMicroUsdPerMillionTokens: 2,
  outputMicroUsdPerMillionTokens: 3,
};
it.each(["phrase", "sentence", "passage"] as const)(
  "supports native %s Web generation offline with explicit simulation labels",
  async (selectionKind) => {
    const network = vi.fn();
    vi.stubGlobal("fetch", network);
    const provider = vi.fn(acceptanceProviderFetch);
    try {
      const input = {
        outputContract: "structured-teaching-v1" as const,
        selectionKind,
        source: { type: "manual" as const },
        sourceText: selectionKind === "phrase" ? "  to be frank  " : '  "Go now."\r\nWe can.  ',
      };
      const model = createDeepSeekAnalysisModel({
        apiKey: LOCAL_ACCEPTANCE_PROVIDER_KEY,
        fetch: provider,
        prices,
      });
      const generated = await model.analyze({ input, sentences: analysisSourceUnits(input) });
      expect(generated.content).toMatchObject({
        sourceText: input.sourceText,
        modelMetadata: { schemaVersion: 3 },
      });
      expect(JSON.stringify(generated.content)).toContain("【本机模拟】");
      expect(provider).toHaveBeenCalledTimes(1);
      expect(network).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  },
);
describe("native query simulated acceptance", () => {
  it("supports a long Unicode source unit within the public source limit", async () => {
    const provider = vi.fn(acceptanceProviderFetch);
    const model = createDeepSeekExtensionQueryModel({
      apiKey: LOCAL_ACCEPTANCE_PROVIDER_KEY,
      fetch: provider,
      prices,
    });
    const sourceText = `Words ${"😀".repeat(970)}`;
    const generated = await model.run(
      {
        action: "explain",
        outputContract: "structured-teaching-v1",
        selectionKind: "sentence",
        sourceType: "web-selection",
        sourceText,
      },
      "00000000-0000-4000-8000-000000000001",
    );
    expect(generated.result.sourceText).toBe(sourceText);
    expect(provider).toHaveBeenCalledTimes(1);
  });
  it.each(["sentence", "passage"] as const)(
    "supports native %s with exact units through the production model",
    async (selectionKind) => {
      const provider = vi.fn(acceptanceProviderFetch);
      const model = createDeepSeekExtensionQueryModel({
        apiKey: LOCAL_ACCEPTANCE_PROVIDER_KEY,
        fetch: provider,
        prices,
      });
      const input = {
        action: "explain" as const,
        outputContract: "structured-teaching-v1" as const,
        selectionKind,
        sourceType: "web-selection" as const,
        sourceText: '  "Go now."\r\nWe can.  ',
      };
      const generated = await model.run(input, "00000000-0000-4000-8000-000000000001");
      expect(generated.result).toMatchObject({
        type: "explain-sentence-v2",
        sourceText: input.sourceText,
      });
      expect(provider).toHaveBeenCalledTimes(1);
    },
  );
});
