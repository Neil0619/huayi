import {
  analysisResultSchema,
  type AnalysisRequest,
  type AnalysisResult,
} from "@huayi/store-domain";
import { describe, expect, it } from "vitest";

import {
  assemblePublicResult,
  jsonSchemaFor,
  parseModelResult,
  resultTypeFor,
} from "./model-contracts.js";

function request(
  action: AnalysisRequest["action"],
  selectionKind: AnalysisRequest["selectionKind"],
): AnalysisRequest {
  return {
    action,
    context: "The selected expression appears here.",
    providerId: "openai",
    requestId: "request-1",
    selection: selectionKind === "word" ? "selected" : "selected expression",
    selectionKind,
    sentenceContext: "The selected expression appears here.",
    targetLanguage: "zh-CN",
  };
}

function assemble(requestValue: AnalysisRequest, modelValue: unknown): AnalysisResult {
  const type = resultTypeFor(requestValue);
  const result = assemblePublicResult(requestValue, type, parseModelResult(type, modelValue));
  return analysisResultSchema.parse(result);
}

function undefinedOwnProperties(value: unknown, path = "$", result: string[] = []): string[] {
  if (typeof value !== "object" || value === null) return result;
  for (const [key, child] of Object.entries(value)) {
    const childPath = `${path}.${key}`;
    if (child === undefined) result.push(childPath);
    else undefinedOwnProperties(child, childPath, result);
  }
  return result;
}

describe("assemblePublicResult", () => {
  it("publishes static strict JSON schemas for every fixed model result", () => {
    for (const type of [
      "explain-lexical",
      "explain-sentence",
      "explain-word",
      "translate-lexical",
      "translate-passage",
      "translate-word",
    ] as const) {
      const schema = jsonSchemaFor(type);
      expect(schema).toMatchObject({
        $schema: "http://json-schema.org/draft-07/schema#",
        additionalProperties: false,
        type: "object",
      });
      expect(JSON.stringify(schema)).not.toMatch(/function|undefined/iu);
    }
  });

  it("omits absent translate-word pronunciation", () => {
    const result = assemble(request("translate", "word"), {
      commonMeanings: [{ meaningsZh: ["选择的"], partOfSpeech: "adjective" }],
      commonPhrases: [],
      confusableWords: [],
      contextualSense: { meaningZh: "选中的", partOfSpeech: "adjective" },
      dictionaryForm: "select",
      pronunciation: null,
    });

    expect(result).not.toHaveProperty("pronunciation");
    expect(Object.hasOwn(result, "pronunciation")).toBe(false);
    expect(undefinedOwnProperties(result)).toEqual([]);
  });

  it("omits absent explain-lexical optional fields", () => {
    const result = assemble(request("explain", "phrase"), {
      baseForm: null,
      collocations: [],
      contextualMeaningZh: "语境释义",
      coreMeanings: [{ meaningZh: "核心义", partOfSpeech: "phrase" }],
      synonyms: [],
      wordFormation: null,
    });

    expect(result).not.toHaveProperty("baseForm");
    expect(result).not.toHaveProperty("wordFormation");
    expect(undefinedOwnProperties(result)).toEqual([]);
  });

  it("omits absent explain-word optional fields", () => {
    const result = assemble(request("explain", "word"), {
      contextualAnalysisZh: "语境分析",
      synonyms: [],
      usageNotes: [],
      wordForm: { baseForm: "select", formTypeZh: "过去分词", sentenceRoleZh: null },
      wordFormationZh: null,
    });

    expect(result.type).toBe("explain-word");
    if (result.type !== "explain-word") throw new Error("Unexpected analysis result type.");
    expect(result).not.toHaveProperty("wordFormationZh");
    expect(result.wordForm).not.toHaveProperty("sentenceRoleZh");
    expect(undefinedOwnProperties(result)).toEqual([]);
  });
});
