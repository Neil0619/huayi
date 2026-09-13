import { structuredAnalysisContentSchema } from "@huayi/cloud-contracts";
import { describe, expect, it, vi } from "vitest";
import { simulatedProviderResponse } from "./acceptance-provider-response.js";
import {
  createDeepSeekAnalysisModel,
  type DeepSeekAnalysisFetch,
} from "./deepseek-analysis-model.js";
import { replaceCandidateAliases } from "./analysis-candidate-ids.js";
import {
  structuredProviderInput as input,
  structuredProviderUnits as sentences,
  structuredProviderOutput,
} from "./test-support/structured-provider-fixture.js";

function fixture(output: unknown = structuredProviderOutput()) {
  const fetch = vi.fn<DeepSeekAnalysisFetch>(async () => simulatedProviderResponse(output, false));
  const model = createDeepSeekAnalysisModel({
    apiKey: "offline-key",
    fetch,
    prices: {
      cachedInputMicroUsdPerMillionTokens: 500_000,
      inputMicroUsdPerMillionTokens: 1_000_000,
      outputMicroUsdPerMillionTokens: 2_000_000,
    },
  });
  return { fetch, model };
}

describe("native structured analysis provider", () => {
  it("locates native fragments and recommendation witnesses, then remaps every candidate reference", async () => {
    const { model, fetch } = fixture();
    const generated = await model.analyze({ input, sentences });
    const content = structuredAnalysisContentSchema.parse(generated.content);
    expect(content.sourceText).toBe(input.sourceText);
    expect(content.result.recommendations.map((r) => r.candidateId)).toEqual(["c2", "c1"]);
    expect(content.modelMetadata).toMatchObject({
      provider: "deepseek",
      model: "deepseek-flash",
      promptVersion: "web-deep-analysis-v3.0-structured",
      schemaVersion: 3,
    });
    expect(content.result).toMatchObject({
      sentences: [
        {
          sentenceStructure: {
            coreClauses: [
              {
                fragments: [
                  { text: "The book", start: 0, end: 8 },
                  { text: "arrived", start: 23, end: 30 },
                ],
              },
            ],
          },
        },
        {},
      ],
    });
    const remapped = replaceCandidateAliases(
      content,
      (() => {
        let next = 0;
        return () => `20000000-0000-4000-8000-${String(++next).padStart(12, "0")}`;
      })(),
    );
    expect(remapped.result).toMatchObject({
      recommendations: [
        { candidateId: "20000000-0000-4000-8000-000000000002" },
        { candidateId: "20000000-0000-4000-8000-000000000001" },
      ],
      sentences: [
        { candidateIds: [remapped.candidates[0]?.id] },
        { candidateIds: [remapped.candidates[1]?.id] },
      ],
    });
    expect(JSON.stringify(content)).not.toMatch(
      /sourceValues|exampleValues|learningAdvice|occurrence|priority/,
    );
    expect(fetch).toHaveBeenCalledTimes(1);
    const body = fetch.mock.calls[0]?.[1].body ?? "";
    expect(body).toContain("sentenceStructure");
    expect(body).toContain("learningAdvice");
    expect(body).toContain("occurrence");
    expect(generated.usageCostMicroUsd).toBe(128);
  });

  it.each([
    "wrong occurrence",
    "cross-unit quote",
    "bad template example",
    "duplicate priority",
    "trusted offset",
  ])("rejects %s and keeps a single bounded repair on the native contract", async (fault) => {
    const value = structuredProviderOutput();
    const first = value.result.sentences[0];
    const second = value.result.sentences[1];
    if (!first || !second) throw new Error("Missing fixture sentence.");
    const ref = first.sentenceStructure.coreClauses[0]?.fragments[0];
    const candidate = first.candidates[0];
    if (!ref || !candidate?.learningAdvice) throw new Error("Missing fixture detail.");
    if (fault === "wrong occurrence") ref.occurrence = 2;
    if (fault === "cross-unit quote") ref.text = "We can";
    if (fault === "trusted offset") Object.assign(ref, { start: 0, end: 8 });
    if (fault === "duplicate priority") candidate.learningAdvice.priority = 1;
    if (fault === "bad template example")
      candidate.learningAdvice.generatedExample.sourceText = "My parcel left.";
    const { model, fetch } = fixture(value);
    await expect(model.analyze({ input, sentences })).rejects.toMatchObject({
      code: "model_output_invalid",
      usageCostMicroUsd: 256,
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    for (const [, init] of fetch.mock.calls) expect(init.body).toContain("sentenceStructure");
  });

  it("keeps legacy selection explicit and rejects native model output for an old request", async () => {
    const { outputContract, ...legacy } = input;
    void outputContract;
    const { model, fetch } = fixture();
    await expect(model.analyze({ input: legacy, sentences })).rejects.toMatchObject({
      code: "model_output_invalid",
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
