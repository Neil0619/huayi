import { segmentSentenceSource, type StartAnalysisGenerationRequest } from "@huayi/cloud-contracts";

export const structuredProviderInput = {
  outputContract: "structured-teaching-v1",
  selectionKind: "passage",
  sourceText: "The book that I bought arrived.\r\nWe can.",
  source: { type: "manual" },
} satisfies StartAnalysisGenerationRequest;
export const structuredProviderUnits = segmentSentenceSource(structuredProviderInput.sourceText);

export function structuredProviderOutput() {
  return {
    previewZh: "先找到两个主干，再看书的限定信息。",
    result: {
      overall: {
        translationZh: "我买的书到了。我们能做到。",
        understandingZh: "先陈述，再表达能力。",
      },
      sentences: [
        {
          translationZh: "我买的书到了。",
          sentenceStructure: {
            kind: "sentence",
            coreClauses: [
              {
                fragments: [
                  { text: "The book", occurrence: 1 },
                  { text: "arrived", occurrence: 1 },
                ],
                explanationZh: "书是主语，到了是主要动作。",
              },
            ],
            modifiers: [
              {
                fragments: [{ text: "that I bought", occurrence: 1 }],
                explanationZh: "限定是哪一本书。",
                relation: "relative-clause",
                target: { kind: "core", index: 0 },
              },
            ],
          },
          grammar: [],
          expressions: [],
          languageNotes: [],
          candidates: [
            {
              type: "sentence_pattern",
              template: "{subject} arrived.",
              slots: [{ name: "subject", descriptionZh: "到达的人或物。" }],
              sourceValues: [{ name: "subject", text: "The book that I bought" }],
              functionZh: "说明人或物已到达。",
              usageZh: "过去式描述已经到达。",
              learningAdvice: {
                priority: 2,
                sourceRefs: [{ text: "The book that I bought arrived.", occurrence: 1 }],
                useWhenZh: "告知别人某人或物已经到达。",
                reasonZh: "主语可替换，适合报告到达情况。",
                generatedExample: {
                  sourceText: "My parcel arrived.",
                  translationZh: "我的包裹到了。",
                },
                exampleValues: [{ name: "subject", text: "My parcel" }],
              },
            },
          ],
        },
        {
          translationZh: "我们能做到。",
          sentenceStructure: {
            kind: "sentence",
            coreClauses: [
              { fragments: [{ text: "We can", occurrence: 1 }], explanationZh: "省略已知动作。" },
            ],
            modifiers: [],
          },
          grammar: [],
          expressions: [],
          languageNotes: [],
          candidates: [
            {
              type: "expression",
              text: "can",
              meaningZh: "能够",
              usageZh: "表达能力。",
              learningAdvice: {
                priority: 1,
                sourceRefs: [{ text: "can", occurrence: 1 }],
                useWhenZh: "说明自己具备某种能力。",
                reasonZh: "适合日常说明能力。",
                generatedExample: { sourceText: "I can swim.", translationZh: "我会游泳。" },
              },
            },
          ],
        },
      ],
    },
  };
}
