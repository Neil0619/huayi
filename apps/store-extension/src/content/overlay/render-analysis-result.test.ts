import { beforeEach, describe, expect, it } from "vitest";

import type { AnalysisResult } from "@huayi/store-domain";
import { STORE_MESSAGE_VERSION } from "@huayi/store-domain";

import { parseContentAnalysisMessage } from "../content-analysis-parser.js";
import { renderAnalysisResult } from "./render-analysis-result.js";

const trusted = { requestId: "request-1", sourceText: "selected text" } as const;
const results: readonly AnalysisResult[] = [
  {
    ...trusted,
    commonMeanings: [{ meaningsZh: ["调查"], partOfSpeech: "noun" }],
    commonPhrases: [],
    confusableWords: [],
    contextualSense: { meaningZh: "调查", partOfSpeech: "noun" },
    dictionaryForm: "investigation",
    selectionKind: "word",
    type: "translate-word",
  },
  {
    ...trusted,
    contextualAnalysisZh: "这里表示调查。",
    selectionKind: "word",
    synonyms: [],
    type: "explain-word",
    usageNotes: [],
    wordForm: { baseForm: "investigate", formTypeZh: "名词形式" },
  },
  {
    ...trusted,
    collocations: [],
    contextualMeaningZh: "早期阶段",
    partOfSpeech: "phrase",
    selectionKind: "phrase",
    similarTerms: [],
    type: "translate-lexical",
  },
  {
    ...trusted,
    collocations: [],
    contextualMeaningZh: "早期阶段",
    coreMeanings: [{ meaningZh: "开始时期", partOfSpeech: "phrase" }],
    selectionKind: "phrase",
    synonyms: [],
    type: "explain-lexical",
  },
  {
    ...trusted,
    selectionKind: "sentence",
    translationZh: "调查仍处于早期阶段。",
    type: "translate-passage",
  },
  {
    ...trusted,
    contextRole: "说明调查进度。",
    keyExpressions: [{ meaningZh: "处于早期", text: "in its early stages" }],
    mainStructure: "主语 + 系动词 + 表语",
    selectionKind: "sentence",
    translationZh: "调查仍处于早期阶段。",
    type: "explain-sentence",
  },
];

function resultOf<Type extends AnalysisResult["type"]>(
  type: Type,
): Extract<AnalysisResult, { type: Type }> {
  const result = results.find((candidate) => candidate.type === type);
  if (result === undefined) throw new Error(`Missing ${type} fixture.`);
  return result as Extract<AnalysisResult, { type: Type }>;
}

const expectedSections: Readonly<Record<AnalysisResult["type"], readonly string[]>> = {
  "translate-word": ["语境义", "常见释义"],
  "explain-word": ["语境解析", "词形解析"],
  "translate-lexical": ["语境义", "词性"],
  "explain-lexical": ["语境义", "核心词义"],
  "translate-passage": ["译文"],
  "explain-sentence": ["句子主干", "关键表达", "句意翻译", "语境作用"],
};

describe("Store analysis result rendering", () => {
  beforeEach(() => {
    document.body.textContent = "";
  });

  it.each(results)("renders $type with the Classic structured section order", (result) => {
    const container = document.createElement("div");
    const parsed = parseContentAnalysisMessage({
      messageVersion: STORE_MESSAGE_VERSION,
      result,
      type: "store/analysis-result",
    });
    if (parsed.type !== "store/analysis-result") throw new Error("Expected result message.");
    renderAnalysisResult(container, parsed.result);

    expect(container.dataset.resultType).toBe(result.type);
    if (result.selectionKind !== "phrase") {
      expect(container.textContent).not.toContain(result.sourceText);
    }
    expect(container.textContent).not.toContain("原文");
    expect(
      Array.from(container.querySelectorAll("[data-result-section] > h3"), (heading) =>
        heading.textContent?.trim(),
      ),
    ).toEqual(expectedSections[result.type]);
  });

  it("uses a semantic headword for words and the selected phrase only as a phrase title", () => {
    const word = document.createElement("div");
    renderAnalysisResult(word, resultOf("translate-word"));
    expect(word.querySelector("[data-result-heading]")?.textContent).toBe("investigation");
    expect(word.textContent).not.toContain("selected text");

    const phrase = document.createElement("div");
    renderAnalysisResult(phrase, { ...resultOf("translate-lexical"), sourceText: "early stages" });
    expect(phrase.querySelector("[data-result-heading]")?.textContent).toBe("early stages");

    const sentence = document.createElement("div");
    renderAnalysisResult(sentence, {
      ...resultOf("translate-passage"),
      sourceText: "Do not repeat this sentence.",
    });
    expect(sentence.querySelector("[data-result-heading]")).toBeNull();
    expect(sentence.textContent).not.toContain("Do not repeat this sentence.");
  });

  it("renders definition, pair, detail, and comparison layouts instead of flattened prose", () => {
    const container = document.createElement("div");
    renderAnalysisResult(container, {
      ...resultOf("translate-word"),
      commonPhrases: [{ meaningZh: "开展调查", text: "conduct an investigation" }],
      confusableWords: [
        {
          distinctionZh: "强调正式查询",
          meaningZh: "询问",
          partOfSpeech: "noun",
          text: "inquiry",
        },
      ],
    });

    expect(container.querySelector("[data-result-layout='definitions']")).not.toBeNull();
    expect(container.querySelector("[data-result-layout='pairs']")).not.toBeNull();
    expect(container.querySelector("[data-result-layout='comparisons']")).not.toBeNull();
    expect(container.querySelector("[data-result-callout]")).not.toBeNull();
  });

  it("keeps a bounded model-provided example but never creates a source-context block", () => {
    const container = document.createElement("div");
    renderAnalysisResult(container, {
      ...resultOf("translate-lexical"),
      contextExample: {
        english: "It is in its early stages.",
        translationZh: "它尚处于早期阶段。",
      },
      sourceText: "early stages",
    });

    expect(
      container.querySelector("[data-result-section='context-example']")?.textContent,
    ).toContain("It is in its early stages.");
    expect(container.querySelector("[data-result-section='source-context']")).toBeNull();
    expect(container.textContent).not.toContain("原句语境");
  });

  it("rejects unknown fields before rendering", () => {
    expect(() =>
      parseContentAnalysisMessage({
        messageVersion: STORE_MESSAGE_VERSION,
        result: { ...results[4], html: "<img src=x>" },
        type: "store/analysis-result",
      }),
    ).toThrow();
  });

  it("rejects inherited model fields at the content boundary", () => {
    const result = Object.assign(Object.create({ html: "<img src=x>" }), results[4]);
    expect(() =>
      parseContentAnalysisMessage({
        messageVersion: STORE_MESSAGE_VERSION,
        result,
        type: "store/analysis-result",
      }),
    ).toThrow();
  });

  it("does not display source context and treats model strings as text, never markup", () => {
    const hostile = '<img src=x onerror="globalThis.pwned=true">';
    const container = document.createElement("div");
    renderAnalysisResult(container, {
      requestId: "request-xss",
      selectionKind: "sentence",
      sourceText: hostile,
      translationZh: hostile,
      type: "translate-passage",
    });

    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toBe(`译文${hostile}`);
  });
});
