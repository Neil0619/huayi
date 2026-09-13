import { structuredAnalysisRecordSchema } from "@huayi/cloud-contracts";

export function structuredAnalysisFixture() {
  return structuredAnalysisRecordSchema.parse({
    id: "10000000-0000-0000-0000-000000000001",
    createdAt: "2026-09-12T10:00:00.000Z",
    updatedAt: "2026-09-12T10:00:00.000Z",
    archivedAt: null,
    revision: 1,
    reviewState: "pendingReview",
    sourceText: "We can.",
    sourceNormalizedHash: "a".repeat(64),
    source: { type: "manual" },
    selectionKind: "sentence",
    modelMetadata: {
      provider: "deepseek",
      model: "offline",
      promptVersion: "structure-1",
      schemaVersion: 3,
    },
    candidates: [
      {
        id: "20000000-0000-0000-0000-000000000001",
        analysisUnitId: "u1",
        ordinal: 0,
        type: "expression",
        payload: { type: "expression", text: "can", meaningZh: "能够", usageZh: "表达能力。" },
      },
    ],
    result: {
      type: "sentence-passage-analysis-v3",
      overall: { translationZh: "我们能做到。", understandingZh: "肯定自己的能力。" },
      sentences: [
        {
          analysisUnitId: "u1",
          ordinal: 0,
          sourceText: "We can.",
          translationZh: "我们能做到。",
          candidateIds: ["20000000-0000-0000-0000-000000000001"],
          grammar: [],
          expressions: [],
          languageNotes: [],
          sentenceStructure: {
            kind: "sentence",
            coreClauses: [
              {
                fragments: [{ text: "We can", start: 0, end: 6 }],
                explanationZh: "省略语境中已知的动作。",
              },
            ],
            modifiers: [],
          },
        },
      ],
      recommendations: [
        {
          candidateId: "20000000-0000-0000-0000-000000000001",
          sourceEvidence: [{ text: "can", start: 3, end: 6 }],
          useWhenZh: "说明自己具备做事的能力。",
          reasonZh: "适合表达能力和信心。",
          generatedExample: { sourceText: "I can swim.", translationZh: "我会游泳。" },
        },
      ],
    },
  });
}

/** A domain-readable record with no remaining room for future mutable metadata. */
export function structuredAnalysisAtCharacterLimit() {
  const value = structuredAnalysisFixture();
  if (value.result.type !== "sentence-passage-analysis-v3") throw new Error("Expected sentence");
  const sentence = value.result.sentences[0];
  if (!sentence) throw new Error("Expected sentence");
  value.revision = 9;
  sentence.grammar = Array.from({ length: 20 }, () => ({ label: "说明", explanationZh: "中" }));
  sentence.expressions = Array.from({ length: 20 }, () => ({ label: "说明", explanationZh: "中" }));
  for (const point of [...sentence.grammar, ...sentence.expressions]) {
    const remaining = 48 * 1024 - JSON.stringify(value).length;
    point.explanationZh += "x".repeat(Math.min(1999, remaining));
  }
  if (JSON.stringify(value).length !== 48 * 1024) throw new Error("Expected exact boundary");
  return structuredAnalysisRecordSchema.parse(value);
}
