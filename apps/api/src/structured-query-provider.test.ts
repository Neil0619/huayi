import { sentenceExplanationV2ResultSchema } from "@huayi/cloud-contracts";
import { describe, expect, it, vi } from "vitest";
import { simulatedProviderResponse } from "./acceptance-provider-response.js";
import {
  createDeepSeekExtensionQueryModel,
  type DeepSeekExtensionQueryFetch,
} from "./deepseek-extension-query-model.js";

const input = {
  outputContract: "structured-teaching-v1" as const,
  action: "explain" as const,
  selectionKind: "passage" as const,
  sourceType: "web-selection" as const,
  sourceText: '  "Go now."\r\nWe can.\t',
};
function output() {
  return {
    translationZh: "现在出发。我们能做到。",
    contextRole: "鼓励行动。",
    keyExpressions: [{ text: "can", meaningZh: "能够" }],
    sentenceStructures: ['"Go now."', "We can."].map((text) => ({
      kind: "sentence",
      coreClauses: [{ fragments: [{ text, occurrence: 1 }], explanationZh: "主要动作。" }],
      modifiers: [],
    })),
  };
}
function fixture(value: unknown = output()) {
  const fetch = vi.fn<DeepSeekExtensionQueryFetch>(async () =>
    simulatedProviderResponse(value, false),
  );
  const model = createDeepSeekExtensionQueryModel({
    apiKey: "offline-key",
    fetch,
    prices: {
      cachedInputMicroUsdPerMillionTokens: 500_000,
      inputMicroUsdPerMillionTokens: 1_000_000,
      outputMicroUsdPerMillionTokens: 2_000_000,
    },
  });
  return { model, fetch };
}
describe("native query provider", () => {
  it("assembles exact native source units without accepting provider identity fields", async () => {
    const f = fixture();
    const generated = await f.model.run(input, "generation-1");
    const result = sentenceExplanationV2ResultSchema.parse(generated.result);
    expect(result.sourceText).toBe(input.sourceText);
    expect(result.requestId).toBe("generation-1");
    expect(
      result.sentenceStructures.map((u) => [u.analysisUnitId, u.ordinal, u.sourceText]),
    ).toEqual([
      ["u1", 0, '"Go now."'],
      ["u2", 1, "We can."],
    ]);
    expect(result.sentenceStructures[1]?.sentenceStructure.coreClauses[0]?.fragments).toEqual([
      { text: "We can.", start: 0, end: 7 },
    ]);
    expect(f.fetch).toHaveBeenCalledTimes(1);
    expect(f.fetch.mock.calls[0]?.[1].body).toContain("occurrence");
    expect(generated.costMicroUsd).toBe(128);
  });
  it.each(["type", "sourceText", "selectionKind", "requestId"])(
    "rejects model-owned %s with one native repair",
    async (key) => {
      const f = fixture({ ...output(), [key]: "injected" });
      await expect(f.model.run(input, "generation-1")).rejects.toMatchObject({
        code: "model_output_invalid",
        usageCostMicroUsd: 256,
      });
      expect(f.fetch).toHaveBeenCalledTimes(2);
    },
  );
  it("rejects omitted or cross-unit structures without silently switching to old generation", async () => {
    const bad = output();
    bad.sentenceStructures.pop();
    const f = fixture(bad);
    await expect(f.model.run(input, "generation-1")).rejects.toMatchObject({
      code: "model_output_invalid",
    });
    expect(f.fetch).toHaveBeenCalledTimes(2);
    for (const [, init] of f.fetch.mock.calls) expect(init.body).toContain("sentenceStructures");
  });
});
