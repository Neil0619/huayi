import { describe, expect, it } from "vitest";

import {
  deletePracticeSessionRequestSchema,
  deletePracticeSessionResponseSchema,
  listPracticeSessionsQuerySchema,
  practiceHistoryDetailResponseSchema,
  practiceHistoryListResponseSchema,
  practiceHistorySummarySchema,
  practiceHttpRoutes,
  practiceMutationHeadersSchema,
  practiceSessionResponseSchema,
} from "./index.js";

const completed = practiceSessionResponseSchema.parse({
  attempts: [
    {
      answer: "I wrote a sentence.",
      feedback: "表达自然。",
      id: "attempt-1",
      itemIds: ["item-1"],
      submittedAt: "2026-08-13T05:05:00.000Z",
    },
  ],
  createdAt: "2026-08-13T05:00:00.000Z",
  finalFeedback: "表达自然。",
  id: "session-1",
  items: [
    {
      itemId: "item-1",
      learningItemDeletedAt: "2026-08-14T05:00:00.000Z",
      position: 0,
      rating: "mastered",
      scheduleAfter: {
        consecutiveMastered: 1,
        dueAt: "2026-08-14T05:06:00.000Z",
        lastRating: "mastered",
        level: 0,
      },
      scheduleBefore: { consecutiveMastered: 0, dueAt: null, level: -1 },
    },
  ],
  prompt: "Write a sentence.",
  revision: 3,
  status: "completed",
  turns: [],
  type: "sentence-creation",
  updatedAt: "2026-08-13T05:06:00.000Z",
});

describe("practice history contracts", () => {
  it("defines strict safe list/detail projections and a nullable completion cursor", () => {
    const summary = {
      completedAt: "2026-08-13T05:05:30.000Z",
      createdAt: completed.createdAt,
      id: completed.id,
      items: [
        {
          itemId: "item-1",
          learningItemDeletedAt: "2026-08-14T05:00:00.000Z",
          rating: "mastered" as const,
        },
      ],
      revision: completed.revision,
      status: completed.status,
      type: completed.type,
      updatedAt: completed.updatedAt,
    };
    expect(practiceHistorySummarySchema.parse(summary)).toEqual(summary);
    expect(practiceHistoryListResponseSchema.parse({ items: [summary], nextCursor: null })).toEqual(
      { items: [summary], nextCursor: null },
    );
    expect(
      practiceHistoryDetailResponseSchema.parse({
        completedAt: "2026-08-13T05:05:30.000Z",
        session: completed,
      }),
    ).toMatchObject({ session: { attempts: [{ answer: "I wrote a sentence." }] } });
    expect(() =>
      practiceHistorySummarySchema.parse({ ...summary, ownerUserId: "user-a" }),
    ).toThrow();
    expect(() => practiceHistorySummarySchema.parse({ ...summary, completedAt: null })).toThrow();
    expect(() =>
      practiceHistorySummarySchema.parse({
        ...summary,
        items: [{ itemId: "item-1", learningItemDeletedAt: "not-an-instant" }],
      }),
    ).toThrow();
    expect(() =>
      practiceHistoryDetailResponseSchema.parse({
        completedAt: null,
        generationLeaseToken: "secret",
        session: completed,
      }),
    ).toThrow();
    expect(listPracticeSessionsQuerySchema.parse({ status: "active", type: "dialogue" })).toEqual({
      status: "active",
      type: "dialogue",
    });
  });

  it("defines fixed history routes and strict revision delete", () => {
    expect(practiceHttpRoutes).toMatchObject({
      historyDelete: "/v1/practice/sessions/:id",
      historyDetail: "/v1/practice/sessions/:id",
      historyList: "/v1/practice/sessions",
    });
    expect(deletePracticeSessionRequestSchema.parse({ expectedRevision: 3 })).toEqual({
      expectedRevision: 3,
    });
    expect(deletePracticeSessionResponseSchema.parse({ deleted: true, id: "session-1" })).toEqual({
      deleted: true,
      id: "session-1",
    });
    expect(
      practiceMutationHeadersSchema.parse({
        "idempotency-key": "delete-session-1",
        "if-match": '"3"',
      }),
    ).toMatchObject({ "if-match": '"3"' });
  });
});
