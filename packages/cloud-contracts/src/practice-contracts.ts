import {
  learningItemContentSchema,
  practiceRatingSchema,
  practiceSessionSchema,
  scheduleStateSchema,
} from "@huayi/learning-domain";
import { z } from "zod/v3";

import {
  paginationQueryFields,
  resourceIdSchema,
  revisionWriteHeadersSchema,
  writeHeadersSchema,
} from "./common-contracts.js";

export { rateSchedule, scheduleStateSchema } from "@huayi/learning-domain";
export type { PracticeSession } from "@huayi/learning-domain";

const calendarDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/u)
  .refine((value) => {
    const [yearText, monthText, dayText] = value.split("-");
    const year = Number(yearText);
    const month = Number(monthText);
    const day = Number(dayText);
    const date = new Date(Date.UTC(year, month - 1, day));
    return (
      date.getUTCFullYear() === year &&
      date.getUTCMonth() === month - 1 &&
      date.getUTCDate() === day
    );
  }, "Expected a valid calendar date.");
export const dailyQueueQuerySchema = z.strictObject({});
export const dailyPracticeQueueItemSchema = z.strictObject({
  item: z.strictObject({
    content: learningItemContentSchema,
    id: resourceIdSchema,
    systemAttributes: z.array(z.string().trim().min(1).max(100)).max(50),
    tags: z.array(z.string().trim().min(1).max(100)).max(50),
    type: z.enum(["expression", "sentence-pattern"]),
  }),
  schedule: scheduleStateSchema,
});
export const dailyPracticeQueueResponseSchema = z
  .strictObject({
    currentItems: z.array(dailyPracticeQueueItemSchema).max(3),
    currentSession: practiceSessionSchema.nullable(),
    dailyGoal: z.number().int().min(1).max(100),
    date: calendarDateSchema,
    items: z.array(dailyPracticeQueueItemSchema).max(100),
    timezone: z.string().trim().min(1).max(100),
  })
  .refine(
    (queue) =>
      (queue.currentSession === null && queue.currentItems.length === 0) ||
      (queue.currentSession !== null &&
        queue.currentItems.length === queue.currentSession.items.length &&
        queue.currentSession.items.every(
          (item, index) => item.itemId === queue.currentItems[index]?.item.id,
        )),
    { message: "Current practice session and item must match." },
  )
  .refine(
    (queue) =>
      queue.currentSession === null ||
      queue.currentSession.status === "active" ||
      queue.currentSession.status === "awaiting-feedback" ||
      (queue.currentSession.status === "completed" &&
        queue.currentSession.items.some((item) => item.rating === undefined)),
    { message: "Daily queue may restore only an unfinished practice session." },
  )
  .refine((queue) => queue.items.length <= queue.dailyGoal, {
    message: "Daily queue cannot exceed the daily goal.",
  })
  .refine((queue) => new Set(queue.items.map((item) => item.item.id)).size === queue.items.length, {
    message: "Daily queue item ids must be unique.",
  });
export type DailyPracticeQueueResponse = z.infer<typeof dailyPracticeQueueResponseSchema>;
export const startSentenceSessionRequestSchema = z.strictObject({ itemId: resourceIdSchema });
export const startDialogueSessionRequestSchema = z.strictObject({
  itemIds: z
    .array(resourceIdSchema)
    .min(1)
    .max(3)
    .refine((itemIds) => new Set(itemIds).size === itemIds.length, {
      message: "Dialogue learning item ids must be unique.",
    }),
});
export const submitDialogueTurnRequestSchema = z.strictObject({
  content: z.string().trim().min(1).max(4_000),
  expectedRevision: z.number().int().min(1),
});
export const retryDialogueAssistantRequestSchema = z.strictObject({
  expectedRevision: z.number().int().min(1),
});
export const submitPracticeAttemptRequestSchema = z.strictObject({
  answer: z.string().trim().min(1).max(4_000),
  expectedRevision: z.number().int().min(1),
});
export const retryPracticeFeedbackRequestSchema = z.strictObject({
  expectedRevision: z.number().int().min(1),
});
export const finishPracticeSessionRequestSchema = z.strictObject({
  expectedRevision: z.number().int().min(1),
});
export const practiceRatingsRequestSchema = z.strictObject({
  expectedRevision: z.number().int().min(1),
  ratings: z
    .array(z.strictObject({ itemId: resourceIdSchema, rating: practiceRatingSchema }))
    .min(1)
    .max(3)
    .refine((ratings) => new Set(ratings.map((rating) => rating.itemId)).size === ratings.length, {
      message: "Each learning item may be rated only once per session.",
    }),
});
export const listPracticeSessionsQuerySchema = z.strictObject({
  ...paginationQueryFields,
  status: z.enum(["active", "awaiting-feedback", "completed", "failed"]).optional(),
  type: z.enum(["sentence-creation", "dialogue"]).optional(),
});
export type ListPracticeSessionsQuery = z.infer<typeof listPracticeSessionsQuerySchema>;
export const practiceHistorySummarySchema = z
  .strictObject({
    completedAt: z.string().datetime({ offset: true }).nullable(),
    createdAt: z.string().datetime({ offset: true }),
    id: resourceIdSchema,
    items: z
      .array(
        z.strictObject({
          itemId: resourceIdSchema,
          learningItemDeletedAt: z.string().datetime({ offset: true }).optional(),
          rating: practiceRatingSchema.optional(),
        }),
      )
      .min(1)
      .max(3),
    revision: z.number().int().min(1),
    status: z.enum(["active", "awaiting-feedback", "completed", "failed"]),
    type: z.enum(["sentence-creation", "dialogue"]),
    updatedAt: z.string().datetime({ offset: true }),
  })
  .refine((summary) => (summary.status === "completed") === (summary.completedAt !== null), {
    message: "Only completed sessions have a completion time.",
  });
export type PracticeHistorySummary = z.infer<typeof practiceHistorySummarySchema>;
export const practiceHistoryListResponseSchema = z.strictObject({
  items: z.array(practiceHistorySummarySchema).max(100),
  nextCursor: z.string().nullable(),
});
export type PracticeHistoryListResponse = z.infer<typeof practiceHistoryListResponseSchema>;
export const practiceHistoryDetailResponseSchema = z
  .strictObject({
    completedAt: z.string().datetime({ offset: true }).nullable(),
    itemLabels: z
      .array(
        z.strictObject({
          itemId: resourceIdSchema,
          label: z.string().trim().min(1).max(2_000),
        }),
      )
      .max(3),
    session: practiceSessionSchema,
  })
  .superRefine((detail, context) => {
    const expectedItemIds = detail.session.items
      .filter((item) => item.learningItemDeletedAt === undefined)
      .map((item) => item.itemId);
    if (
      detail.itemLabels.length !== expectedItemIds.length ||
      detail.itemLabels.some((item, index) => item.itemId !== expectedItemIds[index])
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Practice history labels must match retained session items in order.",
        path: ["itemLabels"],
      });
    }
  })
  .refine((detail) => (detail.session.status === "completed") === (detail.completedAt !== null), {
    message: "Practice session and completion time must agree.",
  });
export type PracticeHistoryDetailResponse = z.infer<typeof practiceHistoryDetailResponseSchema>;
export const deletePracticeSessionRequestSchema = z.strictObject({
  expectedRevision: z.number().int().min(1),
});
export type DeletePracticeSessionRequest = z.infer<typeof deletePracticeSessionRequestSchema>;
export const deletePracticeSessionResponseSchema = z.strictObject({
  deleted: z.literal(true),
  id: resourceIdSchema,
});
export type DeletePracticeSessionResponse = z.infer<typeof deletePracticeSessionResponseSchema>;
export const practiceSessionResponseSchema = practiceSessionSchema;
export const practiceCreateHeadersSchema = writeHeadersSchema;
export const practiceMutationHeadersSchema = revisionWriteHeadersSchema;
export const practiceHttpRoutes = Object.freeze({
  dailyQueue: "/v1/practice/daily-queue",
  finish: "/v1/practice/sessions/:id/finish",
  historyDelete: "/v1/practice/sessions/:id",
  historyDetail: "/v1/practice/sessions/:id",
  historyList: "/v1/practice/sessions",
  rate: "/v1/practice/sessions/:id/ratings",
  retryAssistant: "/v1/practice/sessions/:id/retry-assistant-turn",
  retryFeedback: "/v1/practice/sessions/:id/attempts/:attemptId/retry-feedback",
  startDialogue: "/v1/practice/dialogue-sessions",
  startSentence: "/v1/practice/sentence-sessions",
  submitAttempt: "/v1/practice/sessions/:id/attempts",
  submitTurn: "/v1/practice/sessions/:id/turns",
});
