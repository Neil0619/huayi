import { structuredAnalysisContentSchema } from "@huayi/cloud-contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { simulatedProviderResponse } from "./acceptance-provider-response.js";
import {
  createDeepSeekAnalysisModel,
  type DeepSeekAnalysisFetch,
} from "./deepseek-analysis-model.js";
import { readStructuredAnalysisContent } from "./structured-analysis-output.js";
import {
  structuredProviderInput as input,
  structuredProviderUnits as sentences,
  structuredProviderOutput,
} from "./test-support/structured-provider-fixture.js";

const usage = { inputTokens: 100, outputTokens: 200, cachedInputTokens: 20 };
const prices = {
  cachedInputMicroUsdPerMillionTokens: 500_000,
  inputMicroUsdPerMillionTokens: 1_000_000,
  outputMicroUsdPerMillionTokens: 2_000_000,
};
function undersizedEvidence() {
  const output = structuredProviderOutput();
  const candidate = output.result.sentences[1]?.candidates[0];
  if (!candidate) throw new Error("Missing fixture");
  candidate.learningAdvice.sourceRefs = [{ text: "We", occurrence: 1 }];
  return output;
}
afterEach(() => vi.restoreAllMocks());

describe("structured expression advice source repair", () => {
  it("keeps all teaching and recommendations while fixing incomplete evidence without a second model call", async () => {
    const fetch = vi.fn<DeepSeekAnalysisFetch>(async () =>
      simulatedProviderResponse(undersizedEvidence(), false),
    );
    const result = await createDeepSeekAnalysisModel({
      apiKey: "offline-key",
      fetch,
      prices,
    }).analyze({ input, sentences });
    const content = structuredAnalysisContentSchema.parse(result.content);
    const expected = readStructuredAnalysisContent(
      JSON.stringify(structuredProviderOutput()),
      input,
      sentences,
      usage,
      "first",
    );
    expect(content.result).toEqual((expected.content as { result: unknown }).result);
    expect(content.result.recommendations).toHaveLength(2);
    expect(content.result.recommendations[0]?.sourceEvidence).toEqual([
      { text: "can", start: 3, end: 6 },
    ]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(result.billedCalls).toHaveLength(1);
  });

  it("still rejects a bad example after source evidence is corrected", () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const output = undersizedEvidence();
    const advice = output.result.sentences[1]?.candidates[0]?.learningAdvice;
    if (!advice) throw new Error("Missing fixture");
    advice.generatedExample.sourceText = "I will swim.";
    const result = readStructuredAnalysisContent(
      JSON.stringify(output),
      input,
      sentences,
      usage,
      "first",
    );
    expect(result.feedback?.issues[0]).toMatchObject({
      rule: "recommendation-example-expression",
      location: ["result", "sentences", 1, "candidates", 0, "learningAdvice", "generatedExample"],
    });
  });

  it("points an expression absent from its own source to private sourceRefs with a safe fixed rule", () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const output = undersizedEvidence();
    const candidate = output.result.sentences[1]?.candidates[0];
    if (!candidate || !("text" in candidate)) throw new Error("Missing fixture");
    candidate.text = "could";
    const result = readStructuredAnalysisContent(
      JSON.stringify(output),
      input,
      sentences,
      usage,
      "first",
    );
    expect(result.feedback?.issues[0]).toMatchObject({
      rule: "recommendation-source-expression",
      location: ["result", "sentences", 1, "candidates", 0, "learningAdvice", "sourceRefs"],
    });
  });
});
