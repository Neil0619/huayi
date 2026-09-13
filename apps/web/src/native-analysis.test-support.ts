import {
  assembleSentenceStructure,
  segmentSentenceSource,
  structuredAnalysisRecordSchema,
} from "@huayi/cloud-contracts";

export function nativeWebAnalysis() {
  const sourceText =
    "  The cafe\u0301, which Maya recommended, opens early.\r\nWe can meet there.  ";
  const units = segmentSentenceSource(sourceText);
  const candidates = ["recommended", "opens early", "can", "meet there"].map((text, ordinal) => ({
    id: `20000000-0000-4000-8000-00000000000${ordinal + 1}`,
    analysisUnitId: ordinal < 2 ? "u1" : "u2",
    ordinal,
    type: "expression",
    payload: {
      type: "expression",
      text,
      meaningZh: `表达 ${ordinal + 1}`,
      usageZh: "在日常安排中使用。",
    },
  }));
  const span = (source: string, text: string) => ({
    text,
    start: source.indexOf(text),
    end: source.indexOf(text) + text.length,
  });
  return structuredAnalysisRecordSchema.parse({
    id: "10000000-0000-4000-8000-000000000001",
    createdAt: "2026-09-13T00:00:00Z",
    updatedAt: "2026-09-13T00:00:00Z",
    archivedAt: null,
    revision: 1,
    reviewState: "pendingReview",
    sourceText,
    sourceNormalizedHash: "a".repeat(64),
    source: { type: "manual" },
    selectionKind: "passage",
    modelMetadata: {
      provider: "deepseek",
      model: "offline",
      promptVersion: "native-web-fixture",
      schemaVersion: 3,
    },
    candidates,
    result: {
      type: "sentence-passage-analysis-v3",
      overall: {
        translationZh: "咖啡馆很早开门，我们可以在那里见面。",
        understandingZh: "安排一次见面。",
      },
      sentences: units.map((unit) => ({
        ...unit,
        translationZh: unit.ordinal === 0 ? "玛雅推荐的咖啡馆很早开门。" : "我们可以在那里见面。",
        candidateIds: candidates
          .filter((candidate) => candidate.analysisUnitId === unit.analysisUnitId)
          .map((candidate) => candidate.id),
        grammar: [],
        expressions: [],
        languageNotes: [],
        sentenceStructure: assembleSentenceStructure(unit.sourceText, {
          kind: "sentence",
          coreClauses: [
            {
              fragments: (unit.ordinal === 0
                ? ["The cafe\u0301", "opens early"]
                : ["We can meet there"]
              ).map((text) => ({ text, occurrence: 1 })),
              explanationZh: "主语与谓语说明营业时间和见面安排。",
            },
          ],
          modifiers:
            unit.ordinal === 0
              ? [
                  {
                    fragments: [{ text: "which Maya recommended", occurrence: 1 }],
                    explanationZh: "定语从句说明这家咖啡馆由玛雅推荐。",
                    relation: "relative-clause",
                    target: { kind: "core", index: 0 },
                  },
                ]
              : [],
        }),
      })),
      recommendations: [3, 1].map((index) => {
        const candidate = candidates[index];
        const unit = units.find((unit) => unit.analysisUnitId === candidate?.analysisUnitId);
        if (!candidate || !unit) throw new Error("Missing native recommendation fixture.");
        return {
          candidateId: candidate.id,
          sourceEvidence: [span(unit.sourceText, candidate.payload.text)],
          useWhenZh: index === 3 ? "约定见面地点时使用。" : "向朋友介绍营业时间时使用。",
          reasonZh: "日常安排可以直接复用。",
          generatedExample: {
            sourceText: index === 3 ? "We can meet there tomorrow." : "This shop opens early.",
            translationZh: "可用于日常安排。",
          },
        };
      }),
    },
  });
}
