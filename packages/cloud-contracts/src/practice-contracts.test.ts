import { describe, expect, it } from "vitest";

import {
  dailyPracticeQueueResponseSchema,
  practiceHttpRoutes,
  practiceCreateHeadersSchema,
  practiceMutationHeadersSchema,
  practiceRatingsRequestSchema,
  retryDialogueAssistantRequestSchema,
  retryPracticeFeedbackRequestSchema,
  startDialogueSessionRequestSchema,
  startSentenceSessionRequestSchema,
  submitDialogueTurnRequestSchema,
  submitPracticeAttemptRequestSchema,
} from "./index.js";

describe("minimal sentence practice contracts", () => {
  it("returns a source-free daily target view and fixed routes", () => {
    const queue = {
      currentItems: [],
      currentSession: null,
      dailyGoal: 2,
      date: "2026-08-13",
      items: [
        {
          item: {
            content: {
              meaningZh: "坦率地说",
              text: "to be frank",
              type: "expression",
              usageZh: "用于直接表达意见。",
            },
            id: "item-1",
            systemAttributes: ["spoken"],
            tags: ["Writing"],
            type: "expression",
          },
          schedule: { consecutiveMastered: 0, dueAt: null, level: -1 },
        },
      ],
      timezone: "Asia/Shanghai",
    };
    expect(dailyPracticeQueueResponseSchema.parse(queue)).toEqual(queue);
    expect(() =>
      dailyPracticeQueueResponseSchema.parse({
        ...queue,
        items: [{ ...queue.items[0], sourceExamples: [{ sourceText: "hidden" }] }],
      }),
    ).toThrow();
    expect(practiceHttpRoutes).toMatchObject({
      dailyQueue: "/v1/practice/daily-queue",
      finish: "/v1/practice/sessions/:id/finish",
      rate: "/v1/practice/sessions/:id/ratings",
      retryAssistant: "/v1/practice/sessions/:id/retry-assistant-turn",
      retryFeedback: "/v1/practice/sessions/:id/attempts/:attemptId/retry-feedback",
      startDialogue: "/v1/practice/dialogue-sessions",
      startSentence: "/v1/practice/sentence-sessions",
      submitAttempt: "/v1/practice/sessions/:id/attempts",
      submitTurn: "/v1/practice/sessions/:id/turns",
    });
    expect(() =>
      dailyPracticeQueueResponseSchema.parse({
        ...queue,
        currentItems: [queue.items[0]],
        currentSession: {
          createdAt: "2026-08-13T03:00:00.000Z",
          finalFeedback: "Good.",
          id: "session-1",
          items: [
            {
              itemId: "item-1",
              position: 0,
              rating: "mastered",
              scheduleAfter: {
                consecutiveMastered: 1,
                dueAt: "2026-08-16T03:00:00.000Z",
                lastRating: "mastered",
                level: 0,
              },
              scheduleBefore: queue.items[0]?.schedule,
            },
          ],
          prompt: "Write a sentence.",
          revision: 4,
          status: "completed",
          turns: [],
          type: "sentence-creation",
          updatedAt: "2026-08-13T03:01:00.000Z",
        },
      }),
    ).toThrow();
  });

  it("keeps start, attempt, feedback retry, and ratings strict and revisioned", () => {
    expect(startSentenceSessionRequestSchema.parse({ itemId: "item-1" })).toEqual({
      itemId: "item-1",
    });
    expect(
      submitPracticeAttemptRequestSchema.parse({ answer: "I used it.", expectedRevision: 1 }),
    ).toEqual({ answer: "I used it.", expectedRevision: 1 });
    expect(retryPracticeFeedbackRequestSchema.parse({ expectedRevision: 2 })).toEqual({
      expectedRevision: 2,
    });
    expect(
      practiceRatingsRequestSchema.parse({
        expectedRevision: 3,
        ratings: [{ itemId: "item-1", rating: "mastered" }],
      }),
    ).toBeDefined();
    expect(() =>
      practiceRatingsRequestSchema.parse({
        expectedRevision: 3,
        ratings: [
          { itemId: "item-1", rating: "mastered" },
          { itemId: "item-1", rating: "effortful" },
        ],
      }),
    ).toThrow();
    expect(() =>
      submitPracticeAttemptRequestSchema.parse({
        answer: "I used it.",
        expectedRevision: 1,
        feedback: "client authority",
      }),
    ).toThrow();
    expect(practiceCreateHeadersSchema.parse({ "idempotency-key": "start-1" })).toBeDefined();
    expect(
      practiceMutationHeadersSchema.parse({
        "idempotency-key": "attempt-1",
        "if-match": '"1"',
      }),
    ).toBeDefined();
  });

  it("keeps dialogue start, turns, retry, finish, and multi-item ratings strict", () => {
    expect(startDialogueSessionRequestSchema.parse({ itemIds: ["item-1", "item-2"] })).toEqual({
      itemIds: ["item-1", "item-2"],
    });
    expect(() =>
      startDialogueSessionRequestSchema.parse({ itemIds: ["item-1", "item-1"] }),
    ).toThrow();
    expect(
      submitDialogueTurnRequestSchema.parse({
        content: "To be frank, I prefer the second plan.",
        expectedRevision: 1,
      }),
    ).toBeDefined();
    expect(retryDialogueAssistantRequestSchema.parse({ expectedRevision: 2 })).toBeDefined();
    expect(() =>
      retryDialogueAssistantRequestSchema.parse({ expectedRevision: 2, content: "authority" }),
    ).toThrow();
  });
});
