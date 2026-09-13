import { sentenceExplanationV2ResultSchema } from "@huayi/cloud-contracts";
import { structuredAnalysisFixture } from "./structured-analysis-fixture.js";

export function structuredQueryFixture(requestId = "generation-1") {
  const analysis = structuredAnalysisFixture();
  if (analysis.result.type !== "sentence-passage-analysis-v3") throw new Error("Expected sentence");
  return sentenceExplanationV2ResultSchema.parse({
    type: "explain-sentence-v2",
    requestId,
    selectionKind: "sentence",
    sourceText: analysis.sourceText,
    translationZh: "我们能做到。",
    contextRole: "肯定自己的能力。",
    keyExpressions: [{ text: "can", meaningZh: "能够" }],
    sentenceStructures: analysis.result.sentences.map(
      ({ analysisUnitId, ordinal, sourceText, sentenceStructure }) => ({
        analysisUnitId,
        ordinal,
        sourceText,
        sentenceStructure,
      }),
    ),
  });
}
