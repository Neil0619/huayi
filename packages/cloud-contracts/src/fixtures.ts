const now = "2026-08-12T10:00:00.000Z";

const expressionCandidate = {
  analysisUnitId: "u1",
  id: "candidate-1",
  ordinal: 0,
  payload: {
    meaningZh: "坦率地说",
    text: "to be frank",
    type: "expression",
    usageZh: "用于直接表达个人意见。",
  },
  type: "expression",
} as const;

const passage = {
  overall: { translationZh: "坦率地说，这很有效。", understandingZh: "说话者直接肯定效果。" },
  sentences: [
    {
      analysisUnitId: "u1",
      candidateIds: ["candidate-1"],
      expressions: [],
      grammar: [{ explanationZh: "句首插入语。", label: "插入语" }],
      languageNotes: [],
      ordinal: 0,
      sourceText: "To be frank, this works.",
      structure: [{ explanationZh: "插入语加主句。", label: "主干" }],
      translationZh: "坦率地说，这很有效。",
    },
  ],
  type: "sentence-passage-analysis-v2",
} as const;

const analysis = {
  archivedAt: null,
  candidates: [expressionCandidate],
  createdAt: now,
  id: "analysis-1",
  modelMetadata: {
    inputTokens: 100,
    model: "deepseek-chat",
    outputTokens: 200,
    promptVersion: "1",
    provider: "deepseek",
    schemaVersion: 1,
  },
  result: passage,
  reviewState: "pendingReview",
  revision: 1,
  selectionKind: "passage",
  source: { title: "Writing notes", type: "manual" },
  sourceNormalizedHash: "a".repeat(64),
  sourceText: "To be frank, this works.",
  updatedAt: now,
} as const;

const quota = {
  availableMicroUsd: 700_000,
  limitMicroUsd: 1_000_000,
  percentUsed: 20,
  periodEnd: "2026-09-01T00:00:00.000Z",
  periodStart: "2026-08-01T00:00:00.000Z",
  reservedMicroUsd: 100_000,
  usedMicroUsd: 200_000,
  warning: "available",
} as const;

export const contractFixtures = {
  analysisRequestStatus: {
    analysisId: "analysis-1",
    requestId: "request-1",
    state: "completed",
  },
  analysis,
  completedEvent: { analysis, quota, type: "analysis.completed" },
  confirmCandidatesRequest: {
    analysisRevision: 1,
    confirmations: [
      {
        candidateId: "candidate-1",
        decision: "create",
        payload: expressionCandidate.payload,
        systemAttributes: ["discourse-marker"],
        tags: ["writing"],
        targetType: "expression",
      },
    ],
  },
  confirmCandidatesResponse: {
    analysis: { ...analysis, reviewState: "reviewed", revision: 2 },
    results: [
      {
        action: "created",
        candidateId: "candidate-1",
        item: {
          canonicalKey: "to be frank",
          content: expressionCandidate.payload,
          createdAt: now,
          id: "item-1",
          revision: 1,
          sourceExamples: [
            {
              analysisId: "analysis-1",
              id: "source-1",
              analysisUnitId: "u1",
              sourceText: "To be frank, this works.",
              sourceTitle: "Writing notes",
              sourceType: "manual",
              translationZh: "坦率地说，这很有效。",
            },
          ],
          systemAttributes: ["discourse-marker"],
          tags: ["writing"],
          type: "expression",
          updatedAt: now,
        },
        type: "learning-item",
      },
    ],
  },
  createLearningItemRequest: {
    content: expressionCandidate.payload,
    systemAttributes: ["discourse-marker"],
    tags: ["writing"],
  },
  error: {
    error: {
      code: "quota_exhausted",
      message: "Platform model quota is exhausted.",
      requestId: "request-1",
    },
  },
  practiceRatingsRequest: {
    expectedRevision: 2,
    ratings: [{ itemId: "item-1", rating: "mastered" }],
  },
  quota,
  startAnalysisRequest: {
    selectionKind: "passage",
    source: analysis.source,
    sourceText: analysis.sourceText,
  },
  upsertWordRequest: {
    context: {
      contextualMeaningZh: "有效",
      observedAt: now,
      sourceText: "This works.",
      sourceType: "manual",
    },
    headword: "work",
    notes: "Irregular usage note.",
  },
} as const;
