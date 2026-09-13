import { z } from "zod/v3";
import { learningItemContentSchema } from "./domain-schemas.js";

const id = z.string().trim().min(1).max(128);
const instant = z.string().datetime({ offset: true });
const text = z.string().trim().min(1).max(1_000);
const feedbackFields = {
  mainPointZh: text,
  exampleSentence: text,
  usageNoteZh: text,
};
export const practiceTeachingFeedbackSchema = z.discriminatedUnion("assessment", [
  z.strictObject({ assessment: z.literal("ready"), ...feedbackFields }),
  z.strictObject({
    assessment: z.literal("needs-revision"),
    ...feedbackFields,
    answerExcerpt: z.string().trim().min(1).max(500),
  }),
]);
export type PracticeTeachingFeedback = z.infer<typeof practiceTeachingFeedbackSchema>;

/** One bounded model result also supplies the unchanged legacy string. */
export function formatPracticeTeachingFeedback(feedback: PracticeTeachingFeedback): string {
  const value = practiceTeachingFeedbackSchema.parse(feedback);
  return `${value.mainPointZh}\n示例：${value.exampleSentence}\n用法：${value.usageNoteZh}`;
}

const targetFields = { itemId: id, capturedAt: instant };
export const practiceTeachingTargetSchema = z.discriminatedUnion("state", [
  z.strictObject({
    state: z.literal("available"),
    ...targetFields,
    content: learningItemContentSchema,
  }),
  z.strictObject({ state: z.literal("deleted"), ...targetFields, deletedAt: instant }),
]);
export const practiceTeachingRoundSchema = z.strictObject({
  ordinal: z.number().int().min(0).max(4),
  parentAttemptId: id.nullable(),
  hintViewedAt: instant.nullable(),
});
export const practiceTeachingStateSchema = z.strictObject({
  contract: z.literal("practice-teaching-v1"),
  hintPolicy: z.enum(["shown", "on-demand"]),
  target: practiceTeachingTargetSchema,
  round: practiceTeachingRoundSchema,
});
export type PracticeTeachingState = z.infer<typeof practiceTeachingStateSchema>;

export const practiceAttemptTeachingSchema = z.strictObject({
  attemptId: id,
  ordinal: z.number().int().min(0).max(4),
  parentAttemptId: id.nullable(),
  hintViewedAt: instant.nullable(),
  feedback: practiceTeachingFeedbackSchema.nullable(),
  feedbackCompletedAt: instant.nullable(),
});
