import type {
  ExtensionQueryRequest,
  StoreAnalysisResult,
  StartAnalysisRequest,
} from "@huayi/cloud-contracts";

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

const expressionCandidate = {
  id: "c1",
  analysisUnitId: "u1",
  ordinal: 0,
  type: "expression",
  payload: {
    type: "expression",
    text: "to be frank",
    meaningZh: "坦率地说",
    usageZh: "用来引出个人意见。",
  },
};
const teachingPoint = {
  label: "句首插入语",
  evidenceText: "To be frank",
  explanationZh: "不定式短语表达说话人的态度。",
};

export function deepSeekAnalysisExample(kind: StartAnalysisRequest["selectionKind"]): string {
  if (kind === "phrase")
    return exampleBlock({
      candidates: [expressionCandidate],
      result: {
        type: "phrase-analysis-v2",
        analysisUnitId: "u1",
        candidateIds: ["c1"],
        contextualMeaningZh: "用来引出坦率意见。",
        translationZh: "坦率地说",
        structureAndCollocationZh: ["to be + 形容词构成插入语。"],
        usageNotes: [teachingPoint],
      },
    });
  return [
    exampleBlock({
      candidates: [
        expressionCandidate,
        {
          id: "c2",
          analysisUnitId: "u1",
          ordinal: 1,
          type: "sentence-pattern",
          payload: {
            type: "sentence_pattern",
            template: "To be frank, {statement}.",
            slots: [{ name: "statement", descriptionZh: "要坦率表达的陈述" }],
            functionZh: "坦率表达观点",
            usageZh: "用于提出个人判断。",
          },
        },
      ],
      result: {
        type: "sentence-passage-analysis-v2",
        overall: {
          understandingZh: "说话人认为这个方法可行。",
          translationZh: "坦率地说，这行得通。",
        },
        sentences: [
          {
            analysisUnitId: "u1",
            ordinal: 0,
            sourceText: "To be frank, this works.",
            translationZh: "坦率地说，这行得通。",
            candidateIds: ["c1", "c2"],
            structure: [teachingPoint],
            grammar: [],
            expressions: [],
            languageNotes: [],
          },
        ],
      },
    }),
    "Repeat the sentence shape once per supplied unit, copying that unit's analysisUnitId, ordinal and sourceText exactly.",
    "Every teaching point uses label and explanationZh; optional evidenceText, commonMistakeZh and generatedExample {sourceText, translationZh} must follow that shape.",
    "A sentence-pattern candidate has payload.type sentence_pattern (underscore), and every {slot} in template must match a unique slots[].name.",
  ].join("\n");
}
