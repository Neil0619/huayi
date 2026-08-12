import { practiceRatingSchema, practiceSessionSchema } from "@huayi/learning-domain";
import { z } from "zod/v3";

import { paginationQueryFields, resourceIdSchema } from "./common-contracts.js";

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
export const dailyQueueQuerySchema = z.strictObject({ date: calendarDateSchema });
export const startSentenceSessionRequestSchema = z.strictObject({ itemId: resourceIdSchema });
export const startDialogueSessionRequestSchema = z.strictObject({
  itemIds: z.array(resourceIdSchema).min(1).max(3),
});
export const submitPracticeTurnRequestSchema = z.strictObject({
  content: z.string().trim().min(1).max(4_000),
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
export const practiceSessionResponseSchema = practiceSessionSchema;
