import { afterEach, describe, expect, it, vi } from "vitest";
import { readStructuredAnalysisContent } from "./structured-analysis-output.js";
import {
  structuredProviderInput as input,
  structuredProviderUnits as units,
  structuredProviderOutput,
} from "./test-support/structured-provider-fixture.js";
const usage = { inputTokens: 1, outputTokens: 1, cachedInputTokens: 0 };
afterEach(() => vi.restoreAllMocks());
describe("complete pattern source evidence", () => {
  it("completes a real source quote missing the template's final period", () => {
    const output = structuredProviderOutput();
    const refs = output.result.sentences[0]?.candidates[0]?.learningAdvice.sourceRefs;
    if (!refs?.[0]) throw new Error("Missing fixture");
    refs[0].text = refs[0].text.slice(0, -1);
    const result = readStructuredAnalysisContent(
      JSON.stringify(output),
      input,
      units,
      usage,
      "first",
    );
    const expected = readStructuredAnalysisContent(
      JSON.stringify(structuredProviderOutput()),
      input,
      units,
      usage,
      "first",
    );
    expect(result.content).toEqual(expected.content);
  });
  it("still rejects a cross-unit quote and an inconsistent example", () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    for (const crossUnit of [false, true]) {
      const output = structuredProviderOutput();
      const advice = output.result.sentences[0]?.candidates[0]?.learningAdvice;
      if (!advice?.sourceRefs[0]) throw new Error("Missing fixture");
      advice.sourceRefs[0].text = crossUnit ? "We can." : "The book";
      if (!crossUnit) advice.generatedExample.sourceText = "The parcel is here.";
      const result = readStructuredAnalysisContent(
        JSON.stringify(output),
        input,
        units,
        usage,
        "first",
      );
      expect(result.content).toBeUndefined();
      expect(result.feedback?.issues[0]?.location?.slice(-2)).toEqual(
        crossUnit ? ["sourceRefs", 0] : ["learningAdvice", "generatedExample"],
      );
    }
  });
});
