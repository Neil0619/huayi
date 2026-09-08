import type { ExtensionQueryRequest, StoreAnalysisResult } from "@huayi/cloud-contracts";

const queryExamples = {
  "translate-word": {
    type: "translate-word",
    selectionKind: "word",
    dictionaryForm: "example",
    contextualSense: { meaningZh: "示例", partOfSpeech: "noun" },
    commonMeanings: [{ partOfSpeech: "noun", meaningsZh: ["示例"] }],
    commonPhrases: [{ text: "for example", meaningZh: "例如" }],
    confusableWords: [],
  },
  "explain-word": {
    type: "explain-word",
    selectionKind: "word",
    contextualAnalysisZh: "此处指用于说明问题的示例。",
    wordForm: { baseForm: "example", formTypeZh: "原形", sentenceRoleZh: "名词" },
    usageNotes: [{ titleZh: "常见搭配", descriptionZh: "常与介词 for 搭配表示例如。" }],
    synonyms: [],
  },
  "translate-lexical": {
    type: "translate-lexical",
    selectionKind: "phrase",
    contextualMeaningZh: "坦率地说",
    partOfSpeech: "phrase",
    collocations: [],
    similarTerms: [],
  },
  "explain-lexical": {
    type: "explain-lexical",
    selectionKind: "phrase",
    contextualMeaningZh: "用于引出坦率的意见。",
    coreMeanings: [{ meaningZh: "坦率地说", partOfSpeech: "phrase" }],
    collocations: [],
    synonyms: [],
  },
  "translate-passage": {
    type: "translate-passage",
    selectionKind: "sentence",
    translationZh: "坦率地说，这行得通。",
  },
  "explain-sentence": {
    type: "explain-sentence",
    selectionKind: "sentence",
    mainStructure: "句首插入语，随后为主语和谓语。",
    keyExpressions: [{ text: "to be frank", meaningZh: "坦率地说" }],
    translationZh: "坦率地说，这行得通。",
    contextRole: "表达说话人的坦率判断。",
  },
} satisfies {
  [Type in StoreAnalysisResult["type"]]: Omit<
    Extract<StoreAnalysisResult, { type: Type }>,
    "requestId" | "sourceText"
  >;
};

function exampleBlock(example: unknown): string {
  return [
    "EXAMPLE_JSON_OUTPUT",
    JSON.stringify(example),
    "END_EXAMPLE_JSON_OUTPUT",
    "Use this nested JSON shape, replacing example values with analysis of UNTRUSTED_INPUT. Never copy unrelated example content.",
    "Keep required arrays even when empty. Omit optional fields when unavailable; do not output null or extra keys.",
  ].join("\n");
}

export function deepSeekQueryExample(
  type: StoreAnalysisResult["type"],
  selectionKind: ExtensionQueryRequest["selectionKind"],
): string {
  return exampleBlock({ ...queryExamples[type], selectionKind });
}

export { deepSeekAnalysisExample } from "./deepseek-analysis-example.js";
