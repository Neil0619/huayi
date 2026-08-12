import { describe, expect, it } from "vitest";

import { analysisResultSchema } from "./analysis-results.js";

describe("Store analysis result contract", () => {
  it("preserves the strict trusted envelope and complete passage translation", () => {
    const result = {
      requestId: "request-1",
      selectionKind: "sentence",
      sourceText: "Hello world.",
      translationZh: "你好，世界。",
      type: "translate-passage",
    };
    expect(analysisResultSchema.parse(result)).toEqual(result);
    expect(() => analysisResultSchema.parse({ ...result, model: "remote-value" })).toThrow();
    expect(() => analysisResultSchema.parse({ ...result, requestId: undefined })).toThrow();
  });

  it("keeps word translation fields instead of flattening the product result", () => {
    const result = {
      commonMeanings: [{ meaningsZh: ["维持"], partOfSpeech: "verb" }],
      commonPhrases: [],
      confusableWords: [],
      contextualSense: { meaningZh: "维持", partOfSpeech: "verb" },
      dictionaryForm: "sustain",
      requestId: "request-2",
      selectionKind: "word",
      sourceText: "sustained",
      type: "translate-word",
    };
    expect(analysisResultSchema.parse(result)).toEqual(result);
  });
});
