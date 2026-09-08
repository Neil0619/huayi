import { analysisContentSchema, contractFixtures } from "@huayi/cloud-contracts";
import { describe, expect, it, vi } from "vitest";
import { simulatedProviderResponse } from "./acceptance-provider-response.js";
import {
  createDeepSeekAnalysisModel,
  type DeepSeekAnalysisFetch,
} from "./deepseek-analysis-model.js";

const prices = {
  cachedInputMicroUsdPerMillionTokens: 500_000,
  inputMicroUsdPerMillionTokens: 1_000_000,
  outputMicroUsdPerMillionTokens: 2_000_000,
};
const units = ["We kept going.", "They gave up."].map((sourceText, ordinal) => ({
  sourceText,
  ordinal,
  analysisUnitId: `u${ordinal + 1}`,
}));
const command = {
  input: {
    ...contractFixtures.startAnalysisRequest,
    sourceText: units.map((u) => u.sourceText).join(" "),
  },
  sentences: units,
};
const payload = (text: string) => ({
  type: "expression",
  text,
  meaningZh: "例示含义",
  usageZh: "用于当前语境。",
});
function output() {
  return {
    previewZh: "看清两个动作的区别。",
    result: {
      overall: {
        translationZh: "我们坚持下去。他们放弃了。",
        understandingZh: "两句分别说明两组人的动作。",
      },
      sentences: units.map((u) => ({
        translationZh: "动作描述。",
        structure: [
          {
            label: "主语和动作",
            evidenceText: u.sourceText,
            explanationZh: "主语后跟过去式动词短语。",
            generatedExample: { sourceText: "She carried on.", translationZh: "她继续了下去。" },
          },
        ],
        grammar: [],
        expressions: [],
        languageNotes: [],
        candidates: [payload(u.sourceText)],
      })),
    },
  };
}
function fixture(content: unknown = output()) {
  const fetch = vi.fn<DeepSeekAnalysisFetch>(async () => simulatedProviderResponse(content, false));
  return {
    fetch,
    model: createDeepSeekAnalysisModel({ apiKey: "offline-test-key", fetch, prices }),
  };
}

describe("compact analysis boundary", () => {
  it("derives public identity and order from local arrays while preserving teaching and billed usage", async () => {
    const { model, fetch } = fixture();
    const generated = await model.analyze(command);
    const content = analysisContentSchema.parse(generated.content);
    expect(content.candidates.map((c) => [c.id, c.analysisUnitId, c.ordinal, c.payload])).toEqual([
      ["c1", "u1", 0, payload(units[0]?.sourceText ?? "")],
      ["c2", "u2", 1, payload(units[1]?.sourceText ?? "")],
    ]);
    expect(content.result).toMatchObject({
      type: "sentence-passage-analysis-v2",
      sentences: units.map((u, index) => {
        const row = output().result.sentences[index];
        if (!row) throw new Error("Missing unit.");
        const { candidates, ...teaching } = row;
        void candidates;
        return { ...u, candidateIds: [`c${index + 1}`], ...teaching };
      }),
    });
    expect(generated.billedCalls).toEqual([
      { costMicroUsd: 128, usage: { inputTokens: 64, cachedInputTokens: 0, outputTokens: 32 } },
    ]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(content.modelMetadata).toMatchObject({
      promptVersion: "web-deep-analysis-v2.7-compact",
      schemaVersion: 2,
      model: "deepseek-v4-flash",
    });
  });

  it.each(["unit quote", "candidate quote", "unicode", "whitespace"])(
    "rejects %s that is not an exact source fragment and retains both billed calls",
    async (fault) => {
      const invalid = output();
      const first = invalid.result.sentences[0];
      if (!first) throw new Error("Missing test unit.");
      if (fault === "candidate quote") first.candidates = [payload("They gave up.")];
      else
        first.structure[0] = {
          ...first.structure[0],
          evidenceText:
            fault === "unicode"
              ? "Ｗe kept going."
              : fault === "whitespace"
                ? "We  kept going."
                : "They gave up.",
        } as (typeof first.structure)[number];
      const { model, fetch } = fixture(invalid);
      await expect(model.analyze(command)).rejects.toMatchObject({
        code: "model_output_invalid",
        usageCostMicroUsd: 256,
      });
      expect(fetch).toHaveBeenCalledTimes(2);
    },
  );

  it.each(["analysisUnitId", "candidateIds", "sourceText", "ordinal"])(
    "does not silently strip provider-owned %s",
    async (key) => {
      const original = output();
      const invalid = {
        ...original,
        result: {
          ...original.result,
          sentences: original.result.sentences.map((s) => ({ ...s, [key]: "injected" })),
        },
      };
      const { model } = fixture(invalid);
      await expect(model.analyze(command)).rejects.toMatchObject({
        code: "model_output_invalid",
        usageCostMicroUsd: 256,
      });
    },
  );

  it("rejects repeated names for independently variable template values", async () => {
    const original = output();
    const invalid = {
      ...original,
      result: {
        ...original.result,
        sentences: original.result.sentences.map((s) => ({
          ...s,
          candidates: [
            {
              type: "sentence_pattern",
              template: "{subject} {verbPhrase}, but {subject} {verbPhrase}.",
              functionZh: "对比",
              usageZh: "对比两个动作。",
              slots: [
                { name: "subject", descriptionZh: "我们" },
                { name: "verbPhrase", descriptionZh: "坚持" },
                { name: "subject", descriptionZh: "他们" },
                { name: "verbPhrase", descriptionZh: "放弃" },
              ],
            },
          ],
        })),
      },
    };
    const { model } = fixture(invalid);
    await expect(model.analyze(command)).rejects.toMatchObject({
      code: "model_output_invalid",
      usageCostMicroUsd: 256,
    });
  });

  it.each(["omitted tail", "internal whitespace", "reordered units", "wrong alias"])(
    "rejects %s before quota-dispatch callback or provider I/O",
    async (fault) => {
      const sentences = structuredClone(units);
      if (fault === "omitted tail") sentences.pop();
      if (fault === "internal whitespace" && sentences[0])
        sentences[0].sourceText = "We  kept going.";
      if (fault === "reordered units") sentences.reverse();
      if (fault === "wrong alias" && sentences[0]) sentences[0].analysisUnitId = "u2";
      const beforeDispatch = vi.fn();
      const { model, fetch } = fixture();
      await expect(model.analyze({ ...command, sentences, beforeDispatch })).rejects.toMatchObject({
        usageCostMicroUsd: 0,
      });
      expect(beforeDispatch).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
    },
  );
});
