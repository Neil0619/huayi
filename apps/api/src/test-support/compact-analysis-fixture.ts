import { contractFixtures } from "@huayi/cloud-contracts";

export function compactAnalysisFixture() {
  return {
    previewZh: "先看句首的坦率表达。",
    result: {
      overall: contractFixtures.analysis.result.overall,
      sentences: contractFixtures.analysis.result.sentences.map((s) => ({
        translationZh: s.translationZh,
        structure: s.structure,
        grammar: s.grammar,
        expressions: s.expressions,
        languageNotes: s.languageNotes,
        candidates: [{ ...contractFixtures.analysis.candidates[0].payload, text: "To be frank" }],
      })),
    },
  };
}

export function compactPhraseFixture(text = "to be frank") {
  return {
    previewZh: "先看这个短语的整体含义。",
    result: {
      candidates: [
        { type: "expression", text, meaningZh: "坦率地说", usageZh: "用于直接表达个人意见。" },
      ],
      contextualMeaningZh: "这里用于引出坦率意见。",
      structureAndCollocationZh: ["固定表达。"],
      translationZh: "坦率地说",
      usageNotes: [],
    },
  };
}
