import { describe, expect, it } from "vitest";

import {
  analysisRecordSchema,
  candidateSchema,
  contextObservationSchema,
  learningItemSchema,
  sentencePassageAnalysisSchema,
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
  analysisUnitId: "u1",
  type: "expression",
} as const;

describe("strict learning schemas", () => {
  it("accepts the two learning candidate variants and rejects word or mismatched fields", () => {
    expect(candidateSchema.parse(expressionCandidate)).toEqual(expressionCandidate);
    expect(() =>
      candidateSchema.parse({
        id: "candidate-2",
        ordinal: 1,
        payload: { headword: "sustain", type: "word" },
        analysisUnitId: "u1",
        type: "word",
      }),
    ).toThrow();
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
        analysisUnitId: "u1",
        type: "sentence-pattern",
      }),
    ).toBeTruthy();
    expect(() => candidateSchema.parse({ ...expressionCandidate, userId: "attacker" })).toThrow();
    expect(() =>
      candidateSchema.parse({ ...expressionCandidate, type: "sentence-pattern" }),
    ).toThrow();
  });

  it("checks analysis unit ordering and candidate references", () => {
    const passage = {
      overall: { translationZh: "总译文", understandingZh: "整体理解" },
      sentences: [
        {
          analysisUnitId: "u1",
          candidateIds: ["candidate-1"],
          expressions: [],
          grammar: [{ explanationZh: "不定式短语", label: "结构" }],
          languageNotes: [],
          ordinal: 0,
          sourceText: "To be frank, this works.",
          structure: [{ explanationZh: "插入语加主句。", label: "主干" }],
          translationZh: "坦率地说，这很有效。",
        },
      ],
      type: "sentence-passage-analysis-v2",
    } as const;
    expect(sentencePassageAnalysisSchema.parse(passage)).toEqual(passage);
    expect(() =>
      sentencePassageAnalysisSchema.parse({
        ...passage,
        sentences: [{ ...passage.sentences[0], analysisUnitId: "u2" }],
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
      sourceNormalizedHash: "a".repeat(64),
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
        sourceType: "study-capture",
      }),
    ).toBeTruthy();
    expect(
      contextObservationSchema.parse({
        id: "observation-2",
        observedAt: "2026-08-12T10:00:00.000Z",
        sourceText: "Imported without a contextual meaning.",
        sourceType: "extension-local-import",
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
        dialoguePlan: {
          endConditionZh: "完成一次礼貌的意见交换。",
          roleZh: "你是项目成员，对方是同事。",
          taskZh: "表达不同意见并达成下一步。",
        },
        itemFeedbacks: [{ feedback: "表达使用准确。", itemId: "item-1" }],
        turns: [...twoRounds, turn(5, "user"), turn(6, "assistant")],
      }),
    ).toBeTruthy();
    expect(() =>
      practiceSessionSchema.parse({
        ...common,
        dialoguePlan: {
          endConditionZh: "完成一次礼貌的意见交换。",
          roleZh: "你是项目成员，对方是同事。",
          taskZh: "表达不同意见并达成下一步。",
        },
        itemFeedbacks: [],
        turns: [...twoRounds, turn(5, "user"), turn(6, "assistant")],
      }),
    ).toThrow();
  });

  it("models dialogue generation state without treating a user turn as feedback", () => {
    const pending = {
      createdAt: "2026-08-12T10:00:00.000Z",
      dialoguePlan: {
        endConditionZh: "完成一次礼貌的意见交换。",
        roleZh: "你是项目成员，对方是同事。",
        taskZh: "表达不同意见并达成下一步。",
      },
      id: "session-1",
      items: [
        {
          itemId: "item-1",
          position: 0,
          scheduleBefore: { consecutiveMastered: 0, dueAt: null, level: -1 },
        },
      ],
      pendingGeneration: "assistant-turn",
      prompt: "完成一次受约束对话。",
      revision: 2,
      status: "awaiting-feedback",
      turns: [
        {
          content: "What do you think?",
          createdAt: "2026-08-12T10:00:00.000Z",
          id: "turn-0",
          ordinal: 0,
          role: "assistant",
        },
        {
          content: "To be frank, I disagree.",
          createdAt: "2026-08-12T10:01:00.000Z",
          id: "turn-1",
          ordinal: 1,
          role: "user",
        },
      ],
      type: "dialogue",
      updatedAt: "2026-08-12T10:01:00.000Z",
    } as const;
    expect(practiceSessionSchema.parse(pending)).toBeTruthy();
    expect(() =>
      practiceSessionSchema.parse({ ...pending, pendingGeneration: undefined }),
    ).toThrow();
    expect(
      practiceSessionSchema.parse({
        ...pending,
        dialoguePlan: undefined,
        pendingGeneration: "dialogue-start",
        prompt: undefined,
        revision: 1,
        turns: [],
      }),
    ).toBeTruthy();
  });

  it("models a durable pending sentence prompt without fabricating prompt text", () => {
    const pendingSentence = {
      createdAt: "2026-08-13T10:00:00.000Z",
      id: "sentence-session-1",
      items: [
        {
          itemId: "item-1",
          position: 0,
          scheduleBefore: { consecutiveMastered: 0, dueAt: null, level: -1 },
        },
      ],
      pendingGeneration: "sentence-prompt",
      revision: 1,
      status: "awaiting-feedback",
      turns: [],
      type: "sentence-creation",
      updatedAt: "2026-08-13T10:00:00.000Z",
    } as const;

    expect(practiceSessionSchema.parse(pendingSentence)).toBeTruthy();
    expect(() =>
      practiceSessionSchema.parse({
        ...pendingSentence,
        pendingGeneration: undefined,
        status: "active",
      }),
    ).toThrow();
    expect(() =>
      practiceSessionSchema.parse({
        ...pendingSentence,
        type: "dialogue",
      }),
    ).toThrow();
  });
});
