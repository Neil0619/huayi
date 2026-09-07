import type { AnalysisResult } from "@huayi/store-domain";

export const wordQueryResult = {
  type: "translate-word",
  requestId: "offline-word",
  selectionKind: "word",
  sourceText: "reasoning",
  dictionaryForm: "reasoning",
  contextualSense: { meaningZh: "推理", partOfSpeech: "noun" },
  commonMeanings: [{ meaningsZh: ["推理；论证；理性思考"], partOfSpeech: "noun" }],
  commonPhrases: [
    { text: "reasoning ability", meaningZh: "推理能力" },
    { text: "logical reasoning", meaningZh: "逻辑推理" },
  ],
  confusableWords: [
    {
      text: "reason",
      meaningZh: "原因；理由",
      partOfSpeech: "noun",
      distinctionZh: "reason 指原因或理由，而 reasoning 指推理的过程。",
    },
    {
      text: "seasoning",
      meaningZh: "调味料",
      partOfSpeech: "noun",
      distinctionZh: "seasoning 拼写接近，但表示烹饪用的调味料。",
    },
  ],
} satisfies AnalysisResult;
