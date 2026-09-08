import { analysisContentSchema, contractFixtures } from "@huayi/cloud-contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDeepSeekAnalysisModel } from "./deepseek-analysis-model.js";
import { simulatedProviderResponse } from "./acceptance-provider-response.js";
import { compactAnalysisFixture } from "./test-support/compact-analysis-fixture.js";
import { analysisSourceUnits } from "./analysis-segmentation.js";
const input = contractFixtures.startAnalysisRequest;
const prices = {
  cachedInputMicroUsdPerMillionTokens: 500_000,
  inputMicroUsdPerMillionTokens: 1_000_000,
  outputMicroUsdPerMillionTokens: 2_000_000,
};
function firstRow(output: ReturnType<typeof compactAnalysisFixture>) {
  const row = output.result.sentences[0];
  if (!row) throw new Error("Missing fixture row.");
  return row;
}
function firstCandidate(output: ReturnType<typeof compactAnalysisFixture>) {
  const candidate = firstRow(output).candidates[0];
  if (!candidate) throw new Error("Missing fixture candidate.");
  return candidate;
}
function run(output: unknown) {
  const fetch = vi.fn().mockImplementation(async () => {
    const response = simulatedProviderResponse(output, false);
    if (typeof output !== "string") return response;
    const envelope = await response.json();
    envelope.choices[0].message.content = output;
    return Response.json(envelope);
  });
  const result = createDeepSeekAnalysisModel({ apiKey: "offline", fetch, prices }).analyze({
    input,
    sentences: analysisSourceUnits(input),
  });
  return { fetch, result };
}
afterEach(() => vi.restoreAllMocks());
describe("bounded optional analysis recovery", () => {
  it("keeps the verified reading and valid suggestion without paying for a second whole answer", async () => {
    const output = compactAnalysisFixture();
    const row = firstRow(output);
    row.candidates.push({ ...firstCandidate(output), text: "a foreign source fragment" });
    const before = structuredClone(output);
    const { fetch, result } = run(output);
    const generated = await result;
    const content = analysisContentSchema.parse(generated.content);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(generated.billedCalls).toHaveLength(1);
    expect(generated.usageCostMicroUsd).toBe(128);
    expect(content.result).toMatchObject({ overall: output.result.overall });
    expect(content.candidates.map((c) => c.id)).toEqual(["c1"]);
    expect(content.candidates[0]?.payload).toMatchObject({ text: "To be frank" });
    expect(JSON.stringify(content)).not.toContain("a foreign source fragment");
    expect(output).toEqual(before);
  });
  it("omits only the teaching point with a discontinuous quote, preserving source and translation", async () => {
    const output = compactAnalysisFixture();
    const raw = {
      ...output,
      result: {
        ...output.result,
        sentences: output.result.sentences.map((row) => ({
          ...row,
          grammar: [
            ...row.grammar,
            {
              label: "discard this point",
              evidenceText: "To be ... this works",
              explanationZh: "discard this unsupported explanation",
            },
          ],
        })),
      },
    };
    const content = analysisContentSchema.parse((await run(raw).result).content);
    expect(content.sourceText).toBe(input.sourceText);
    expect(content.result).toMatchObject({ overall: output.result.overall });
    expect(JSON.stringify(content)).not.toContain("discard this");
    expect(content.candidates).toHaveLength(1);
  });
  it("can return a valid reading without learning suggestions instead of fabricating a replacement", async () => {
    const output = compactAnalysisFixture();
    firstCandidate(output).text = "absent quote";
    const { fetch, result } = run(output);
    const content = analysisContentSchema.parse((await result).content);
    expect(content.candidates).toEqual([]);
    expect(content.result).toMatchObject({
      overall: output.result.overall,
      sentences: [{ candidateIds: [], translationZh: firstRow(output).translationZh }],
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("isolates an optional explanation with a misspelled field instead of regenerating the reading", async () => {
    const output = compactAnalysisFixture();
    const raw = {
      ...output,
      result: {
        ...output.result,
        sentences: output.result.sentences.map((row) => ({
          ...row,
          expressions: [
            { label: "unpublished", evidenceText: "To be frank", explanation: "wrong property" },
          ],
        })),
      },
    };
    const { fetch, result } = run(raw);
    const content = analysisContentSchema.parse((await result).content);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(content.result).toMatchObject({
      overall: output.result.overall,
      sentences: [{ expressions: [] }],
    });
    expect(content.candidates).toHaveLength(1);
    expect(JSON.stringify(content)).not.toContain("unpublished");
  });
  it("omits an incomplete optional template while preserving another usable expression", async () => {
    const output = compactAnalysisFixture();
    const raw = {
      ...output,
      result: {
        ...output.result,
        sentences: output.result.sentences.map((row) => ({
          ...row,
          candidates: [
            ...row.candidates,
            { type: "sentence_pattern", template: "{subject} works." },
          ],
        })),
      },
    };
    const { fetch, result } = run(raw);
    const content = analysisContentSchema.parse((await result).content);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(content.candidates).toHaveLength(1);
    expect(content.candidates[0]?.payload).toMatchObject({ text: "To be frank" });
  });
  it("does not evade array bounds by dropping an oversized set of invalid optional points", async () => {
    const output = compactAnalysisFixture();
    const raw = {
      ...output,
      result: {
        ...output.result,
        sentences: output.result.sentences.map((row) => ({
          ...row,
          grammar: Array.from({ length: 100 }, () => ({ broken: true })),
        })),
      },
    };
    const { fetch, result } = run(raw);
    await expect(result).rejects.toMatchObject({ code: "model_output_invalid" });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it.each(["missing-translation", "missing-unit", "unknown-root-field", "invalid-json"])(
    "does not salvage %s or fabricate a complete result after the bounded repair fails",
    async (kind) => {
      const output = compactAnalysisFixture();
      let raw: unknown = output;
      if (kind === "missing-translation")
        raw = {
          ...output,
          result: { ...output.result, overall: { understandingZh: "existing note" } },
        };
      if (kind === "missing-unit") output.result.sentences = [];
      if (kind === "unknown-root-field") raw = { ...output, execute: "untrusted" };
      if (kind === "invalid-json") raw = '{"previewZh":"unfinished"';
      const { fetch, result } = run(raw);
      await expect(result).rejects.toMatchObject({ code: "model_output_invalid" });
      expect(fetch).toHaveBeenCalledTimes(2);
    },
  );
});
