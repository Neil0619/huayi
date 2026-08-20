import {
  canonicalKeyForContent,
  confirmCandidatesRequestSchema,
  createLearningItemRequestSchema,
  createLearningItemResponseSchema,
  learningItemDetailResponseSchema,
  type AnalysisRecord,
  type LearningItemDetailResponse,
} from "@huayi/cloud-contracts";

export function createCloudBrowserManualLearningItem(
  body: unknown,
  createdAt: string,
  id: string,
): LearningItemDetailResponse {
  const request = createLearningItemRequestSchema.parse(body);
  return createLearningItemResponseSchema.parse({
    archivedAt: null,
    hasPracticeHistory: false,
    item: {
      canonicalKey: canonicalKeyForContent(request.content),
      content: request.content,
      createdAt,
      id,
      revision: 1,
      sourceExamples: [],
      systemAttributes: request.systemAttributes,
      tags: request.tags,
      type: request.content.type === "expression" ? "expression" : "sentence-pattern",
      updatedAt: createdAt,
    },
    recentPractice: null,
    schedule: { consecutiveMastered: 0, dueAt: null, level: -1 },
  });
}

export function createCloudBrowserLearningItem(
  analysis: AnalysisRecord,
  body: unknown,
  createdAt: string,
): LearningItemDetailResponse {
  const request = confirmCandidatesRequestSchema.parse(body);
  const confirmation = request.confirmations[0];
  if (request.confirmations.length !== 1 || confirmation?.targetType !== "expression") {
    throw new TypeError("Cloud browser fixture accepts one expression candidate.");
  }
  const candidate = analysis.candidates.find((value) => value.id === confirmation.candidateId);
  if (candidate?.type !== "expression" || !("sentences" in analysis.result)) {
    throw new TypeError("Cloud browser expression candidate is missing.");
  }
  const sentence = analysis.result.sentences.find(
    (value) => value.analysisUnitId === candidate.analysisUnitId,
  );
  if (sentence === undefined) throw new TypeError("Cloud browser candidate sentence is missing.");
  return learningItemDetailResponseSchema.parse({
    archivedAt: null,
    hasPracticeHistory: false,
    item: {
      canonicalKey: canonicalKeyForContent(confirmation.payload),
      content: confirmation.payload,
      createdAt,
      id: "item-1",
      revision: 1,
      sourceExamples: [
        {
          analysisId: analysis.id,
          id: "source-1",
          analysisUnitId: sentence.analysisUnitId,
          sourceText: sentence.sourceText,
          ...(analysis.source.title === undefined ? {} : { sourceTitle: analysis.source.title }),
          sourceType: analysis.source.type,
          translationZh: sentence.translationZh,
        },
      ],
      systemAttributes: confirmation.systemAttributes,
      tags: confirmation.tags,
      type: "expression",
      updatedAt: createdAt,
    },
    recentPractice: null,
    schedule: { consecutiveMastered: 0, dueAt: null, level: -1 },
  });
}
