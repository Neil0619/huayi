import { describe, expect, it } from "vitest";

import {
  analysisRecordSchema,
  candidateSchema,
  studyCaptureSchema,
  webDeepAnalysisSchema,
} from "./index.js";

const now = "2026-08-13T10:00:00.000Z";

const expressionCandidate = {
  analysisUnitId: "u1",
  id: "candidate-1",
  ordinal: 0,
  payload: {
    meaningZh: "坦率地说",
    text: "to be frank",
    type: "expression",
    usageZh: "用于直接表达意见。",
  },
  type: "expression",
} as const;

const phraseResult = {
  analysisUnitId: "u1",
  candidateIds: ["candidate-1"],
  contextualMeaningZh: "这里用于引出坦率意见。",
  structureAndCollocationZh: ["to be + adjective 是固定不定式结构。"],
  translationZh: "坦率地说",
  type: "phrase-analysis-v2",
  usageNotes: [
    {
      explanationZh: "常放在句首作为话语标记。",
      generatedExample: {
        sourceText: "To be frank, I disagree.",
        translationZh: "坦率地说，我不同意。",
      },
      label: "位置",
    },
  ],
} as const;

describe("Phase 27 learning authority", () => {
  it("accepts phrase V2 with generic analysis units and rejects word candidates", () => {
    expect(webDeepAnalysisSchema.parse(phraseResult)).toEqual(phraseResult);
    expect(candidateSchema.parse(expressionCandidate)).toEqual(expressionCandidate);
    expect(() =>
      candidateSchema.parse({
        analysisUnitId: "u1",
        id: "candidate-word",
        ordinal: 0,
        payload: { headword: "frank", type: "word" },
        type: "word",
      }),
    ).toThrow();
  });

  it("keeps generated examples educational and requires each candidate exactly once", () => {
    const record = {
      archivedAt: null,
      candidates: [expressionCandidate],
      createdAt: now,
      id: "analysis-1",
      modelMetadata: {
        model: "deepseek-chat",
        promptVersion: "web-deep-analysis-v2",
        provider: "deepseek",
        schemaVersion: 2,
      },
      result: phraseResult,
      reviewState: "pendingReview",
      revision: 1,
      selectionKind: "phrase",
      source: { type: "manual", userContext: "写作语境" },
      sourceNormalizedHash: "a".repeat(64),
      sourceText: "to be frank",
      updatedAt: now,
    } as const;
    expect(analysisRecordSchema.parse(record)).toEqual(record);
    expect(() =>
      analysisRecordSchema.parse({
        ...record,
        result: { ...phraseResult, candidateIds: [] },
      }),
    ).toThrow();
    expect(() =>
      analysisRecordSchema.parse({
        ...record,
        selectionKind: "word",
      }),
    ).toThrow();
  });

  it("models StudyCapture as original intent without compact results", () => {
    const capture = {
      captureCount: 2,
      createdAt: now,
      firstCapturedAt: now,
      id: "capture-1",
      kind: "sentence",
      lastCapturedAt: now,
      normalizedTextHash: "b".repeat(64),
      revision: 2,
      sourceText: "This is a complete line",
      status: "pending",
      updatedAt: now,
      userContext: "我想学习无标点台词。",
    } as const;
    expect(studyCaptureSchema.parse(capture)).toEqual(capture);
    expect(() => studyCaptureSchema.parse({ ...capture, result: phraseResult })).toThrow();
  });
});
