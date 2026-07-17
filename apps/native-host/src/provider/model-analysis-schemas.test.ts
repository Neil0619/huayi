import { describe, expect, it } from "vitest";

import {
  modelAnalysisArrayItemSchemaFor,
  modelAnalysisFieldSchemaFor,
  modelAnalysisResultSchemaFor,
  modelLexicalExplanationSchema,
  modelLexicalTranslationSchema,
  modelPassageTranslationSchema,
  modelSentenceExplanationSchema,
  modelWordExplanationSchema,
  modelWordTranslationSchema,
  resultTypeFor,
} from "./model-analysis-schemas.js";

const relatedTerms = [
  { meaningZh: "数字四", partOfSpeech: "number", text: "four" },
  { meaningZh: "四个一组", partOfSpeech: "noun", text: "quartet" },
  { meaningZh: "第四", partOfSpeech: "number", text: "fourth" },
] as const;

const fourExplanation = {
  baseForm: null,
  collocations: [],
  contextualMeaningZh: "在这里表示数字四。",
  coreMeanings: [{ meaningZh: "数字四", partOfSpeech: "number" }],
  synonyms: [],
  wordFormation: null,
} as const;

const fourTranslation = {
  collocations: [],
  contextExampleTranslationZh: null,
  contextualMeaningZh: "在这里表示数字四。",
  partOfSpeech: "number",
  pronunciation: null,
  similarTerms: [],
} as const;

function jsonObjectWithOwnProperty(
  value: object,
  property: string,
  propertyValue: unknown,
): unknown {
  const source = JSON.stringify({ ...value, [property]: propertyValue });
  if (source === undefined) throw new Error("Expected JSON-serializable test object.");
  const parsed: unknown = JSON.parse(source);
  return parsed;
}

function jsonRoundTrip(value: unknown): unknown {
  const source = JSON.stringify(value);
  if (source === undefined) throw new Error("Expected JSON-serializable test value.");
  const parsed: unknown = JSON.parse(source);
  return parsed;
}

describe("private model analysis schemas", () => {
  it("accepts lexical content whose naturally absent fields use null and empty arrays", () => {
    expect(modelLexicalExplanationSchema.safeParse(fourExplanation).success).toBe(true);
    expect(modelLexicalTranslationSchema.safeParse(fourTranslation).success).toBe(true);
    expect(
      modelLexicalTranslationSchema.safeParse({
        ...fourTranslation,
        pronunciation: { uk: null, us: null },
      }).success,
    ).toBe(true);
  });

  it.each(["sourceText", "selectionKind", "type"])("rejects public metadata field %s", (field) => {
    expect(
      modelLexicalExplanationSchema.safeParse({ ...fourExplanation, [field]: "untrusted" }).success,
    ).toBe(false);
  });

  it("rejects unknown fields at root and nested object boundaries", () => {
    expect(
      modelLexicalTranslationSchema.safeParse({ ...fourTranslation, unsafeHtml: "<img>" }).success,
    ).toBe(false);
    expect(
      modelLexicalTranslationSchema.safeParse({
        ...fourTranslation,
        collocations: [{ meaningZh: "数字四", text: "number four", unsafe: true }],
      }).success,
    ).toBe(false);
    expect(
      modelLexicalExplanationSchema.safeParse({
        ...fourExplanation,
        coreMeanings: [{ meaningZh: "数字四", partOfSpeech: "number", unsafe: true }],
      }).success,
    ).toBe(false);
  });

  it.each(["__proto__", "constructor", "toString"])(
    "rejects JSON-parsed own prototype-like field %s at the root",
    (field) => {
      const value = jsonObjectWithOwnProperty(fourTranslation, field, { unsafe: true });

      expect(modelLexicalTranslationSchema.safeParse(value).success).toBe(false);
    },
  );

  it.each(["__proto__", "constructor", "toString"])(
    "rejects JSON-parsed own prototype-like field %s in a reused child schema",
    (field) => {
      const collocation = jsonObjectWithOwnProperty(
        { meaningZh: "数字四", text: "number four" },
        field,
        { unsafe: true },
      );
      const value = jsonRoundTrip({ ...fourTranslation, collocations: [collocation] });

      expect(modelLexicalTranslationSchema.safeParse(value).success).toBe(false);
      expect(
        modelAnalysisFieldSchemaFor("translate-lexical", "collocations")?.safeParse([collocation])
          .success,
      ).toBe(false);
    },
  );

  it("enforces lexical collection limits without fabricating minimum counts", () => {
    expect(
      modelLexicalExplanationSchema.safeParse({
        ...fourExplanation,
        synonyms: relatedTerms,
      }).success,
    ).toBe(true);
    expect(
      modelLexicalExplanationSchema.safeParse({
        ...fourExplanation,
        synonyms: [...relatedTerms, relatedTerms[0]],
      }).success,
    ).toBe(false);
    expect(
      modelLexicalExplanationSchema.safeParse({ ...fourExplanation, coreMeanings: [] }).success,
    ).toBe(false);
  });

  it("requires both nullable pronunciation keys whenever pronunciation is non-null", () => {
    expect(
      modelLexicalTranslationSchema.safeParse({
        ...fourTranslation,
        pronunciation: { uk: null },
      }).success,
    ).toBe(false);
    expect(
      modelLexicalTranslationSchema.safeParse({
        ...fourTranslation,
        pronunciation: { uk: null, us: null, ipa: null },
      }).success,
    ).toBe(false);
  });

  it("accepts only a Chinese translation string or null for the trusted context example", () => {
    expect(
      modelLexicalTranslationSchema.safeParse({
        ...fourTranslation,
        contextExampleTranslationZh: "四名受害者接受了采访。",
      }).success,
    ).toBe(true);
    expect(
      modelLexicalTranslationSchema.safeParse({
        ...fourTranslation,
        contextExampleTranslationZh: {
          english: "Four victims were interviewed.",
          translationZh: "四名受害者接受了采访。",
        },
      }).success,
    ).toBe(false);
  });

  it("keeps passage and sentence model content free of public metadata", () => {
    expect(modelPassageTranslationSchema.parse({ translationZh: "第一段。" })).toEqual({
      translationZh: "第一段。",
    });
    expect(
      modelSentenceExplanationSchema.safeParse({
        contextRole: "说明人数。",
        keyExpressions: [{ meaningZh: "四名受害者", text: "Four victims" }],
        mainStructure: "主语 + 谓语",
        translationZh: "四名受害者接受了采访。",
      }).success,
    ).toBe(true);
    expect(
      modelSentenceExplanationSchema.safeParse({
        contextRole: "说明人数。",
        keyExpressions: [{ meaningZh: "四名受害者", text: "Four victims" }],
        mainStructure: "主语 + 谓语",
        sourceText: "Four victims were interviewed.",
        translationZh: "四名受害者接受了采访。",
      }).success,
    ).toBe(false);
  });

  it("looks up result and field schemas without exposing them through the protocol", () => {
    expect(resultTypeFor({ action: "translate", selectionKind: "word" })).toBe("translate-word");
    expect(resultTypeFor({ action: "translate", selectionKind: "paragraph" })).toBe(
      "translate-passage",
    );
    expect(resultTypeFor({ action: "explain", selectionKind: "phrase" })).toBe("explain-lexical");
    expect(resultTypeFor({ action: "explain", selectionKind: "sentence" })).toBe(
      "explain-sentence",
    );
    expect(() => resultTypeFor({ action: "explain", selectionKind: "paragraph" })).toThrow();

    expect(modelAnalysisResultSchemaFor("explain-lexical")).toBe(modelLexicalExplanationSchema);
    expect(modelAnalysisResultSchemaFor("translate-word")).toBe(modelWordTranslationSchema);
    expect(modelAnalysisResultSchemaFor("explain-word")).toBe(modelWordExplanationSchema);
    expect(
      modelAnalysisFieldSchemaFor("translate-lexical", "collocations")?.safeParse([]).success,
    ).toBe(true);
    expect(modelAnalysisFieldSchemaFor("translate-lexical", "sourceText")).toBeUndefined();
    expect(modelAnalysisFieldSchemaFor("translate-passage", "translationZh")).toBeDefined();
  });

  it.each([
    ["explain-lexical", "collocations", { meaningZh: "持续努力", text: "sustained effort" }],
    ["explain-lexical", "coreMeanings", { meaningZh: "维持", partOfSpeech: "verb" }],
    ["explain-lexical", "synonyms", relatedTerms[0]],
    ["translate-lexical", "collocations", { meaningZh: "刑事调查", text: "investigation" }],
    ["translate-lexical", "similarTerms", relatedTerms[1]],
  ] as const)("looks up the %s %s item schema", (resultType, field, item) => {
    const schema = modelAnalysisArrayItemSchemaFor(resultType, field);

    expect(schema?.safeParse(item).success).toBe(true);
    expect(schema?.safeParse({ ...item, unsafe: true }).success).toBe(false);
  });

  it("does not expose array item schemas for final-only or non-array fields", () => {
    expect(modelAnalysisArrayItemSchemaFor("explain-sentence", "keyExpressions")).toBeUndefined();
    expect(
      modelAnalysisArrayItemSchemaFor("translate-lexical", "contextualMeaningZh"),
    ).toBeUndefined();
    expect(modelAnalysisArrayItemSchemaFor("translate-passage", "translationZh")).toBeUndefined();
  });

  it.each(["__proto__", "constructor", "toString"])(
    "does not expose inherited field schema %s",
    (field) => {
      expect(modelAnalysisFieldSchemaFor("translate-lexical", field)).toBeUndefined();
    },
  );
});
