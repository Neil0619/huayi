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
] as const;

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

  it("requires three to five similar terms and synonyms", () => {
    const invalid = {
      collocations,
      contextualMeaningZh: "调查",
      partOfSpeech: "noun",
      selectionKind: "word",
      similarTerms: terms.slice(0, 2),
      sourceText: "investigation",
      type: "translate-lexical",
    } as const;

    expect(analysisResultSchema.safeParse(invalid).success).toBe(false);
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
