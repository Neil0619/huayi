import { describe, expect, it } from "vitest";

import { analysisResultSchema } from "./index.js";

const terms = [
  { meaningZh: "调查", partOfSpeech: "noun", text: "inquiry" },
  { meaningZh: "审查", partOfSpeech: "noun", text: "examination" },
  { meaningZh: "研究", partOfSpeech: "noun", text: "research" },
] as const;

const collocations = [
  { meaningZh: "刑事调查", text: "criminal investigation" },
  { meaningZh: "展开调查", text: "launch an investigation" },
  { meaningZh: "警方调查", text: "police investigation" },
] as const;

const coreMeanings = [
  { meaningZh: "受害者", partOfSpeech: "noun" },
  { meaningZh: "牺牲品", partOfSpeech: "noun" },
  { meaningZh: "受骗者", partOfSpeech: "noun" },
] as const;

const lexicalTranslation = {
  collocations,
  contextualMeaningZh: "受害者",
  partOfSpeech: "noun",
  selectionKind: "word",
  similarTerms: terms,
  sourceText: "victims",
  type: "translate-lexical",
} as const;

const lexicalExplanation = {
  collocations,
  contextualMeaningZh: "受到伤害的人",
  coreMeanings,
  selectionKind: "word",
  sourceText: "victims",
  synonyms: terms,
  type: "explain-lexical",
} as const;

describe("analysisResultSchema", () => {
  it("accepts a lexical translation", () => {
    const result = {
      collocations,
      contextExample: {
        english: "The investigation was in its early stages.",
        translationZh: "调查仍处于早期阶段。",
      },
      contextualMeaningZh: "对案件进行系统查证的调查",
      partOfSpeech: "noun",
      pronunciation: { uk: "/ɪnˌvestɪˈɡeɪʃn/", us: "/ɪnˌvestɪˈɡeɪʃn/" },
      selectionKind: "word",
      similarTerms: terms,
      sourceText: "investigation",
      type: "translate-lexical",
    } as const;

    expect(analysisResultSchema.parse(result)).toEqual(result);
  });

  it("accepts a sentence or paragraph translation and preserves line breaks", () => {
    const result = {
      selectionKind: "paragraph",
      sourceText: "First sentence.\nSecond sentence.",
      translationZh: "第一句。\n第二句。",
      type: "translate-passage",
    } as const;

    expect(analysisResultSchema.parse(result)).toEqual(result);
  });

  it("accepts a lexical explanation", () => {
    const result = {
      baseForm: "sustain",
      collocations: [
        { meaningZh: "持续高温", text: "sustained high temperatures" },
        { meaningZh: "持续努力", text: "sustained effort" },
      ],
      contextualMeaningZh: "持续的、长时间延续的",
      coreMeanings: [
        { meaningZh: "维持；使持续", partOfSpeech: "verb" },
        { meaningZh: "持续的", partOfSpeech: "adjective" },
      ],
      selectionKind: "phrase",
      sourceText: "sustained heatwave",
      synonyms: [
        { meaningZh: "持续的", partOfSpeech: "adjective", text: "continuous" },
        { meaningZh: "持久的", partOfSpeech: "adjective", text: "prolonged" },
        { meaningZh: "不间断的", partOfSpeech: "adjective", text: "uninterrupted" },
      ],
      type: "explain-lexical",
      wordFormation: "sustain + -ed",
    } as const;

    expect(analysisResultSchema.parse(result)).toEqual(result);
  });

  it("accepts a sentence explanation", () => {
    const result = {
      contextRole: "说明调查阶段并发出征集线索的呼吁。",
      keyExpressions: [
        { meaningZh: "处于早期阶段", text: "in its early stages" },
        { meaningZh: "敦促某人做某事", text: "urge someone to do something" },
      ],
      mainStructure: "He said ... and urged anyone ...",
      selectionKind: "sentence",
      sourceText: "He said the investigation was in its early stages.",
      translationZh: "他说调查仍处于早期阶段。",
      type: "explain-sentence",
    } as const;

    expect(analysisResultSchema.parse(result)).toEqual(result);
  });

  it.each([0, 3])("accepts %i related items", (count) => {
    expect(
      analysisResultSchema.safeParse({
        ...lexicalTranslation,
        similarTerms: terms.slice(0, count),
      }).success,
    ).toBe(true);
    expect(
      analysisResultSchema.safeParse({
        ...lexicalExplanation,
        synonyms: terms.slice(0, count),
      }).success,
    ).toBe(true);
  });

  it("rejects four related items", () => {
    const fourTerms = [...terms, terms[0]];

    expect(
      analysisResultSchema.safeParse({
        ...lexicalTranslation,
        similarTerms: fourTerms,
      }).success,
    ).toBe(false);
    expect(
      analysisResultSchema.safeParse({
        ...lexicalExplanation,
        synonyms: fourTerms,
      }).success,
    ).toBe(false);
  });

  it.each([0, 3])("accepts %i collocations", (count) => {
    expect(
      analysisResultSchema.safeParse({
        ...lexicalTranslation,
        collocations: collocations.slice(0, count),
      }).success,
    ).toBe(true);
    expect(
      analysisResultSchema.safeParse({
        ...lexicalExplanation,
        collocations: collocations.slice(0, count),
      }).success,
    ).toBe(true);
  });

  it("rejects four collocations", () => {
    const fourCollocations = [...collocations, collocations[0]];

    expect(
      analysisResultSchema.safeParse({
        ...lexicalTranslation,
        collocations: fourCollocations,
      }).success,
    ).toBe(false);
    expect(
      analysisResultSchema.safeParse({
        ...lexicalExplanation,
        collocations: fourCollocations,
      }).success,
    ).toBe(false);
  });

  it.each([1, 3])("accepts %i core meanings", (count) => {
    expect(
      analysisResultSchema.safeParse({
        ...lexicalExplanation,
        coreMeanings: coreMeanings.slice(0, count),
      }).success,
    ).toBe(true);
  });

  it.each([0, 4])("rejects %i core meanings", (count) => {
    const meanings = [...coreMeanings, coreMeanings[0]].slice(0, count);

    expect(
      analysisResultSchema.safeParse({
        ...lexicalExplanation,
        coreMeanings: meanings,
      }).success,
    ).toBe(false);
  });

  it("allows optional single-value lexical fields to be absent", () => {
    expect(analysisResultSchema.parse(lexicalTranslation)).toEqual(lexicalTranslation);
    expect(analysisResultSchema.parse(lexicalExplanation)).toEqual(lexicalExplanation);
  });

  it("rejects non-English term text", () => {
    const invalid = {
      collocations,
      contextualMeaningZh: "调查",
      partOfSpeech: "noun",
      selectionKind: "word",
      similarTerms: [{ meaningZh: "调查", partOfSpeech: "noun", text: "调查" }, ...terms.slice(1)],
      sourceText: "investigation",
      type: "translate-lexical",
    } as const;

    expect(analysisResultSchema.safeParse(invalid).success).toBe(false);
  });

  it("rejects unknown result fields", () => {
    const invalid = {
      collocations,
      contextualMeaningZh: "调查",
      partOfSpeech: "noun",
      selectionKind: "word",
      similarTerms: terms,
      sourceText: "investigation",
      type: "translate-lexical",
      unsafeHtml: "<img src=x onerror=alert(1)>",
    } as const;

    expect(analysisResultSchema.safeParse(invalid).success).toBe(false);
  });

  it("rejects unknown fields in nested lexical objects", () => {
    expect(
      analysisResultSchema.safeParse({
        ...lexicalTranslation,
        pronunciation: { uk: "/ˈvɪktɪm/", unsafeHtml: "<b>victim</b>" },
      }).success,
    ).toBe(false);
    expect(
      analysisResultSchema.safeParse({
        ...lexicalTranslation,
        contextExample: {
          english: "The victims were taken to safety.",
          translationZh: "受害者已被转移到安全地点。",
          unsafeHtml: "<b>victims</b>",
        },
      }).success,
    ).toBe(false);
    expect(
      analysisResultSchema.safeParse({
        ...lexicalExplanation,
        coreMeanings: [{ ...coreMeanings[0], unsafeHtml: "<b>victim</b>" }],
      }).success,
    ).toBe(false);
  });

  it("requires text, part of speech, and a Chinese meaning for related terms", () => {
    const invalid = {
      collocations,
      contextualMeaningZh: "调查",
      partOfSpeech: "noun",
      selectionKind: "word",
      similarTerms: [
        { meaningZh: "调查", partOfSpeech: "noun", text: "inquiry" },
        { meaningZh: "审查", text: "examination" },
        { meaningZh: "研究", partOfSpeech: "noun", text: "research" },
      ],
      sourceText: "investigation",
      type: "translate-lexical",
    } as const;

    expect(analysisResultSchema.safeParse(invalid).success).toBe(false);
  });

  it("rejects a result type with the wrong selection kind", () => {
    expect(
      analysisResultSchema.safeParse({
        contextRole: "语境作用",
        keyExpressions: [{ meaningZh: "短语", text: "an expression" }],
        mainStructure: "Subject + verb",
        selectionKind: "phrase",
        sourceText: "an expression",
        translationZh: "一个表达",
        type: "explain-sentence",
      }).success,
    ).toBe(false);
  });
});
