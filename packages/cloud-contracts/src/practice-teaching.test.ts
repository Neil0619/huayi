import { expect, it } from "vitest";
import {
  practiceTeachingActionSchema,
  practiceTeachingDetailSchema,
  practiceWorkspaceControlSchema,
  practiceWorkspaceStartSchema,
} from "./index.js";

const now = "2026-09-13T00:00:00.000Z";
const session = {
  id: "session-1",
  type: "sentence-creation",
  status: "completed",
  revision: 3,
  createdAt: now,
  updatedAt: now,
  prompt: "向同事说明你至少需要两天。",
  finalFeedback: "表达准确。",
  items: [
    {
      itemId: "item-1",
      position: 0,
      scheduleBefore: { level: -1, dueAt: null, consecutiveMastered: 0 },
    },
  ],
  attempts: [
    {
      id: "answer-1",
      itemIds: ["item-1"],
      answer: "I need at least two days.",
      feedback: "表达准确。",
      submittedAt: now,
    },
  ],
  turns: [],
  workspace: { phase: "active", mode: "guided", draft: "", draftRevision: 0 },
};
const teaching = {
  contract: "practice-teaching-v1",
  hintPolicy: "on-demand",
  target: {
    state: "available",
    itemId: "item-1",
    capturedAt: now,
    content: { type: "expression", text: "at least", meaningZh: "至少", usageZh: "说明最小数量。" },
  },
  round: { ordinal: 0, parentAttemptId: null, hintViewedAt: null },
  attempts: [
    {
      attemptId: "answer-1",
      ordinal: 0,
      parentAttemptId: null,
      hintViewedAt: null,
      feedback: null,
      feedbackCompletedAt: null,
    },
  ],
};

it("opts into teaching explicitly and keeps existing start/control requests valid", () => {
  expect(practiceWorkspaceStartSchema.parse({ itemId: "item-1", mode: "guided" })).toEqual({
    itemId: "item-1",
    mode: "guided",
  });
  expect(
    practiceWorkspaceStartSchema.safeParse({
      itemId: "item-1",
      mode: "guided",
      teachingContract: "practice-teaching-v1",
      hintPolicy: "on-demand",
    }).success,
  ).toBe(true);
  for (const invalid of [
    { mode: "free", teachingContract: "practice-teaching-v1", hintPolicy: "on-demand" },
    { mode: "guided", hintPolicy: "on-demand" },
  ])
    expect(practiceWorkspaceStartSchema.safeParse({ itemId: "item-1", ...invalid }).success).toBe(
      false,
    );
  expect(
    practiceWorkspaceControlSchema.safeParse({ action: "pause", expectedRevision: 1, draft: "old" })
      .success,
  ).toBe(true);
  expect(
    practiceWorkspaceControlSchema.safeParse({
      action: "pause",
      expectedRevision: 1,
      draft: "new",
      expectedDraftRevision: 2,
    }).success,
  ).toBe(true);
});

it("requires three rewrite versions and never lets the client choose a parent or timestamp", () => {
  const rewrite = {
    action: "rewrite",
    expectedRevision: 3,
    expectedControlRevision: 0,
    expectedDraftRevision: 0,
  };
  expect(practiceTeachingActionSchema.parse(rewrite)).toEqual(rewrite);
  expect(
    practiceTeachingActionSchema.safeParse({ ...rewrite, expectedDraftRevision: undefined })
      .success,
  ).toBe(false);
  expect(
    practiceTeachingActionSchema.safeParse({ ...rewrite, parentAttemptId: "foreign" }).success,
  ).toBe(false);
  const hint = {
    action: "reveal-hint",
    expectedRevision: 3,
    expectedControlRevision: 0,
    ordinal: 0,
  };
  expect(practiceTeachingActionSchema.parse(hint)).toEqual(hint);
  expect(practiceTeachingActionSchema.safeParse({ ...hint, hintViewedAt: now }).success).toBe(
    false,
  );
});

it("reads legacy sessions without inventing teaching facts and binds all side metadata", () => {
  expect(
    practiceTeachingDetailSchema.parse({ version: 1, session, teaching: null }).teaching,
  ).toBeNull();
  expect(practiceTeachingDetailSchema.safeParse({ version: 1, session, teaching }).success).toBe(
    true,
  );
  for (const changed of [
    { ...teaching, attempts: [] },
    { ...teaching, target: { ...teaching.target, itemId: "foreign" } },
    { ...teaching, attempts: [{ ...teaching.attempts[0], attemptId: "foreign" }] },
    {
      ...teaching,
      attempts: [{ ...teaching.attempts[0], ordinal: 1, parentAttemptId: "foreign" }],
    },
    { ...teaching, round: { ...teaching.round, ordinal: 1, parentAttemptId: "foreign" } },
  ])
    expect(
      practiceTeachingDetailSchema.safeParse({ version: 1, session, teaching: changed }).success,
    ).toBe(false);
});

it("rejects feedback referring to another answer and target text on a deleted item", () => {
  const feedback = {
    assessment: "needs-revision",
    mainPointZh: "检查动词形式。",
    exampleSentence: "I need two days.",
    usageNoteZh: "主语与动词搭配。",
    answerExcerpt: "She needs",
  };
  expect(
    practiceTeachingDetailSchema.safeParse({
      version: 1,
      session,
      teaching: { ...teaching, attempts: [{ ...teaching.attempts[0], feedback }] },
    }).success,
  ).toBe(false);
  const deleted = { ...session, items: [{ ...session.items[0], learningItemDeletedAt: now }] };
  expect(
    practiceTeachingDetailSchema.safeParse({ version: 1, session: deleted, teaching }).success,
  ).toBe(false);
  expect(
    practiceTeachingDetailSchema.safeParse({
      version: 1,
      session: deleted,
      teaching: {
        ...teaching,
        target: { state: "deleted", itemId: "item-1", capturedAt: now, deletedAt: now },
      },
    }).success,
  ).toBe(true);
});
