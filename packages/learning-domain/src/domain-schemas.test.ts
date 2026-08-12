import { describe, expect, it } from "vitest";

import {
  analysisRecordSchema,
  candidateSchema,
  contextObservationSchema,
  learningItemSchema,
  passageAnalysisSchema,
  practiceSessionSchema,
  scheduleStateSchema,
  wordEntrySchema,
} from "./index.js";

const expressionCandidate = {
  id: "candidate-1",
  ordinal: 0,
  payload: {
    meaningZh: "坦率地说",
    text: "to be frank",
    type: "expression",
    usageZh: "用于直接表达个人意见。",
  },
  sentenceId: "s1",
  type: "expression",
} as const;

describe("strict learning schemas", () => {
  it("accepts the three candidate variants and rejects unknown or mismatched fields", () => {
    expect(candidateSchema.parse(expressionCandidate)).toEqual(expressionCandidate);
    expect(
      candidateSchema.parse({
        id: "candidate-2",
        ordinal: 1,
        payload: {
          contextualMeaningZh: "维持",
          headword: "sustain",
          type: "word",
        },
        sentenceId: "s1",
        type: "word",
      }),
    ).toBeTruthy();
    expect(
      candidateSchema.parse({
        id: "candidate-3",
        ordinal: 2,
        payload: {
          functionZh: "表达让步",
          slots: [{ descriptionZh: "让步内容", name: "clause" }],
          template: "Even though {clause}, ...",
          type: "sentence_pattern",
          usageZh: "用于承认事实后给出相反结论。",
        },
        sentenceId: "s1",
        type: "sentence-pattern",
      }),
    ).toBeTruthy();
    expect(() => candidateSchema.parse({ ...expressionCandidate, userId: "attacker" })).toThrow();
    expect(() =>
      candidateSchema.parse({ ...expressionCandidate, type: "sentence-pattern" }),
    ).toThrow();
  });

  it("checks passage sentence ordering, ids, and candidate references", () => {
    const passage = {
      overall: { translationZh: "总译文", understandingZh: "整体理解" },
      schemaVersion: 1,
      sentences: [
        {
          candidateIds: ["candidate-1"],
          grammarNotes: [{ explanationZh: "不定式短语", label: "结构" }],
          id: "s1",
          ordinal: 0,
          sourceText: "To be frank, this works.",
          structureZh: "插入语加主句。",
          translationZh: "坦率地说，这很有效。",
        },
      ],
    } as const;
    expect(passageAnalysisSchema.parse(passage)).toEqual(passage);
    expect(() =>
      passageAnalysisSchema.parse({
        ...passage,
        sentences: [{ ...passage.sentences[0], id: "s2" }],
      }),
    ).toThrow();

    const record = {
      archivedAt: null,
      candidates: [expressionCandidate],
      createdAt: "2026-08-12T10:00:00.000Z",
      id: "analysis-1",
      modelMetadata: {
        model: "deepseek-chat",
        promptVersion: "1",
        provider: "deepseek",
        schemaVersion: 1,
      },
      result: passage,
      reviewState: "pendingReview",
      revision: 1,
      selectionKind: "passage",
      source: { title: "Notes", type: "manual" },
      sourceText: "To be frank, this works.",
      updatedAt: "2026-08-12T10:00:00.000Z",
    } as const;
    expect(analysisRecordSchema.parse(record)).toEqual(record);
    expect(() =>
      analysisRecordSchema.parse({
        ...record,
        candidates: [{ ...expressionCandidate, id: "unreferenced" }],
      }),
    ).toThrow();
  });

  it("enforces learning, word, observation, schedule, and practice boundaries", () => {
    const common = {
      createdAt: "2026-08-12T10:00:00.000Z",
      id: "item-1",
      revision: 1,
      updatedAt: "2026-08-12T10:00:00.000Z",
    };
    expect(
      learningItemSchema.parse({
        ...common,
        canonicalKey: "to be frank",
        content: expressionCandidate.payload,
        sourceExamples: [],
        systemAttributes: ["discourse-marker"],
        tags: ["writing"],
        type: "expression",
      }),
    ).toBeTruthy();
    expect(() =>
      learningItemSchema.parse({
        ...common,
        canonicalKey: "to be frank",
        content: expressionCandidate.payload,
        sourceExamples: [],
        systemAttributes: [],
        tags: [],
        type: "sentence-pattern",
      }),
    ).toThrow();
    expect(
      wordEntrySchema.parse({
        ...common,
        canonicalKey: "sustain",
        contexts: [],
        headword: "sustain",
      }),
    ).toBeTruthy();
    expect(
      contextObservationSchema.parse({
        contextualMeaningZh: "维持",
        id: "observation-1",
        observedAt: "2026-08-12T10:00:00.000Z",
        sourceText: "The effort cannot be sustained.",
        sourceType: "web-selection",
      }),
    ).toBeTruthy();
    expect(
      scheduleStateSchema.parse({ consecutiveMastered: 0, dueAt: null, level: -1 }),
    ).toBeTruthy();
    expect(() =>
      scheduleStateSchema.parse({ consecutiveMastered: 0, dueAt: null, level: 0 }),
    ).toThrow();
    expect(() =>
      scheduleStateSchema.parse({ consecutiveMastered: 2, dueAt: null, level: -1 }),
    ).toThrow();
    expect(() =>
      practiceSessionSchema.parse({
        ...common,
        items: [],
        prompt: "Write one sentence.",
        status: "active",
        turns: [],
        type: "sentence-creation",
      }),
    ).toThrow();
  });

  it("requires completed dialogues to contain three to five user-assistant rounds", () => {
    const common = {
      createdAt: "2026-08-12T10:00:00.000Z",
      id: "session-1",
      finalFeedback: "整体反馈。",
      items: [
        {
          itemId: "item-1",
          position: 0,
          scheduleBefore: { consecutiveMastered: 0, dueAt: null, level: -1 },
        },
      ],
      prompt: "Discuss the topic.",
      revision: 1,
      status: "completed",
      type: "dialogue",
      updatedAt: "2026-08-12T10:00:00.000Z",
    } as const;
    const turn = (ordinal: number, role: "assistant" | "user") => ({
      content: role === "assistant" ? "Please continue." : "Here is my answer.",
      createdAt: "2026-08-12T10:00:00.000Z",
      id: `turn-${ordinal}`,
      ordinal,
      role,
    });
    const twoRounds = [
      turn(0, "assistant"),
      turn(1, "user"),
      turn(2, "assistant"),
      turn(3, "user"),
      turn(4, "assistant"),
    ];
    expect(() => practiceSessionSchema.parse({ ...common, turns: twoRounds })).toThrow();
    expect(
      practiceSessionSchema.parse({
        ...common,
        turns: [...twoRounds, turn(5, "user"), turn(6, "assistant")],
      }),
    ).toBeTruthy();
  });
});
