import { analysisContentSchema } from "@huayi/cloud-contracts";
import { describe, expect, it, vi } from "vitest";
import { trustedDeepSeekAnalysisContent } from "./deepseek-analysis-private-output.js";
import { analysisSourceUnits } from "./analysis-segmentation.js";
import { createDeepSeekAnalysisModel } from "./deepseek-analysis-model.js";
import { simulatedProviderResponse } from "./acceptance-provider-response.js";
const sourceText = "The fire leaves at least 12 dead and 23 missing.";
const input = {
  selectionKind: "sentence" as const,
  sourceText,
  source: { type: "manual" as const },
};
const usage = { inputTokens: 64, outputTokens: 32, cachedInputTokens: 0 };
function pattern() {
  return {
    type: "sentence_pattern",
    template: "{event} leaves at least {deadCount} dead and {missingCount} missing.",
    slots: [
      { name: "event", descriptionZh: "造成后果的单数主体" },
      { name: "deadCount", descriptionZh: "死亡人数的下限" },
      { name: "missingCount", descriptionZh: "失踪人数" },
    ],
    sourceValues: [
      { name: "event", text: "The fire" },
      { name: "deadCount", text: "12" },
      { name: "missingCount", text: "23" },
    ],
    functionZh: "表达两项分别计数的结果",
    usageZh: "leaves 与单数主语搭配；at least 只限定死亡人数。",
  };
}
function output(candidate: unknown) {
  return {
    previewZh: "留意两个数量的范围。",
    result: {
      overall: {
        translationZh: "火灾导致至少12人死亡、23人失踪。",
        understandingZh: "两项数量分别对应不同后果。",
      },
      sentences: [
        {
          translationZh: "火灾导致至少12人死亡、23人失踪。",
          structure: [],
          grammar: [],
          expressions: [],
          languageNotes: [],
          candidates: [candidate],
        },
      ],
    },
  };
}
function validate(candidate: unknown, original = input) {
  return trustedDeepSeekAnalysisContent(
    JSON.stringify(output(candidate)),
    original,
    analysisSourceUnits(original),
    usage,
    "first",
  );
}
describe("source-backed analysis templates", () => {
  it("rejects the observed repeated-number template without source values", () => {
    const { sourceValues, ...candidate } = pattern();
    void sourceValues;
    candidate.template = "{event} leaves {deadCount} dead and {deadCount} missing.";
    candidate.slots = candidate.slots.slice(0, 2);
    expect(validate(candidate).feedback).toBeDefined();
  });
  it("accepts independent source values and removes private witness fields before publishing", () => {
    const checked = validate(pattern());
    expect(checked.feedback).toBeUndefined();
    const content = analysisContentSchema.parse(checked.content);
    const { sourceValues, ...payload } = pattern();
    void sourceValues;
    expect(content.candidates[0]?.payload).toEqual(payload);
    expect(JSON.stringify(content)).not.toContain("sourceValues");
  });
  it("allows a template sentence period after an unpunctuated source headline", () => {
    expect(
      validate(pattern(), { ...input, sourceText: sourceText.slice(0, -1) }).feedback,
    ).toBeUndefined();
  });
  it("does not remove internal punctuation or change terminal question marks", () => {
    expect(
      validate(pattern(), { ...input, sourceText: sourceText.replace("leaves", "leaves,") })
        .feedback,
    ).toBeDefined();
    expect(
      validate(pattern(), { ...input, sourceText: sourceText.slice(0, -1) + "?" }).feedback,
    ).toBeDefined();
  });
  it("does not turn a source prefix or an extra terminal period into a full pattern", () => {
    const prefix = pattern();
    prefix.template = "{event} leaves.";
    prefix.slots = prefix.slots.slice(0, 1);
    prefix.sourceValues = prefix.sourceValues.slice(0, 1);
    expect(
      validate(prefix, { ...input, sourceText: sourceText.slice(0, -1) }).feedback,
    ).toBeDefined();
    const repeated = pattern();
    repeated.template += ".";
    expect(validate(repeated).feedback).toBeDefined();
  });
  it("supports the public hyphenated slot-name contract during literal reconstruction", () => {
    const candidate = pattern();
    candidate.template = candidate.template.replaceAll("deadCount", "dead-count");
    candidate.slots[1] = { name: "dead-count", descriptionZh: "死亡人数" };
    candidate.sourceValues[1] = { name: "dead-count", text: "12" };
    expect(validate(candidate).feedback).toBeUndefined();
  });
  it.each([
    "repeated-number",
    "extra-verb",
    "reversed-values",
    "wrong-case",
    "duplicate-value-name",
    "missing-value",
    "unknown-value",
  ])("rejects %s without modifying the proposed template", (kind) => {
    const candidate = pattern();
    if (kind === "repeated-number") {
      candidate.template = "{event} leaves at least {deadCount} dead and {deadCount} missing.";
      candidate.slots.pop();
      candidate.sourceValues.pop();
    }
    if (kind === "extra-verb")
      candidate.template =
        "{event} leaves happened at least {deadCount} dead and {missingCount} missing.";
    if (kind === "reversed-values") {
      candidate.sourceValues[1] = { name: "deadCount", text: "23" };
      candidate.sourceValues[2] = { name: "missingCount", text: "12" };
    }
    if (kind === "wrong-case") candidate.sourceValues[0] = { name: "event", text: "the fire" };
    if (kind === "duplicate-value-name")
      candidate.sourceValues.push({ name: "event", text: "The fire" });
    if (kind === "missing-value") candidate.sourceValues.pop();
    if (kind === "unknown-value") candidate.sourceValues.push({ name: "extra", text: "anything" });
    const original = structuredClone(candidate);
    expect(validate(candidate).feedback).toBeDefined();
    expect(candidate).toEqual(original);
  });
  it("omits a mismatched-number pattern without losing the reading or buying another answer", async () => {
    const invalid = pattern();
    invalid.sourceValues[2] = { name: "missingCount", text: "12" };
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(simulatedProviderResponse(output(invalid), false))
      .mockResolvedValueOnce(simulatedProviderResponse(output(pattern()), false));
    const generated = await createDeepSeekAnalysisModel({
      apiKey: "offline",
      fetch,
      prices: {
        cachedInputMicroUsdPerMillionTokens: 500000,
        inputMicroUsdPerMillionTokens: 1000000,
        outputMicroUsdPerMillionTokens: 2000000,
      },
    }).analyze({ input, sentences: analysisSourceUnits(input) });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(generated.billedCalls).toHaveLength(1);
    expect(generated.usageCostMicroUsd).toBe(128);
    const content = analysisContentSchema.parse(generated.content);
    expect(content.candidates).toEqual([]);
    expect(content.result).toMatchObject({ overall: output(invalid).result.overall });
    expect(JSON.stringify(content)).not.toContain("sourceValues");
  });
});
