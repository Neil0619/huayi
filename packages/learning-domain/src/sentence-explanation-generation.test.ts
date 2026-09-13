import { expect, it } from "vitest";
import { assembleSentenceStructure } from "./teaching-structure.js";
import { sentenceExplanationV2ResultSchema } from "./structured-store-results.js";
import {
  assembleSentenceExplanationResult,
  validateSentenceExplanationSource,
} from "./sentence-explanation-generation.js";
const sourceText = "We can. They wait.";
const draft = {
  kind: "sentence",
  coreClauses: [{ fragments: [{ text: "We can", occurrence: 1 }], explanationZh: "说明能力。" }],
  modifiers: [],
};
const combined = sentenceExplanationV2ResultSchema.parse({
  type: "explain-sentence-v2",
  requestId: "test",
  sourceText,
  selectionKind: "passage",
  translationZh: "我们可以。他们等待。",
  contextRole: "分别陈述。",
  keyExpressions: [{ text: "can", meaningZh: "可以" }],
  sentenceStructures: [
    {
      analysisUnitId: "u1",
      ordinal: 0,
      sourceText,
      sentenceStructure: assembleSentenceStructure(sourceText, draft),
    },
  ],
});
it("rejects a source-covering but different unit partition at the request binding boundary", () => {
  expect(() => validateSentenceExplanationSource(combined, sourceText)).toThrow();
});
it("rejects source substitution and model-supplied identity before publishing a generated result", () => {
  const value = {
    translationZh: "我们可以。",
    contextRole: "说明能力。",
    keyExpressions: [{ text: "can", meaningZh: "可以" }],
    sentenceStructures: [draft],
  };
  const input = { sourceText: "  We can.\r\n", requestId: "local", selectionKind: "sentence" };
  const result = assembleSentenceExplanationResult(value, input);
  expect(result.sourceText).toBe(input.sourceText);
  expect(result.sentenceStructures[0]?.sourceText).toBe("We can.");
  expect(() => validateSentenceExplanationSource(result, "They can.")).toThrow();
  expect(() =>
    assembleSentenceExplanationResult({ ...value, sourceText: "invented" }, input),
  ).toThrow();
  expect(() => assembleSentenceExplanationResult(value, { ...input, sourceText })).toThrow();
});
