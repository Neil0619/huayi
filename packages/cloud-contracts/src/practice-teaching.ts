import { z } from "zod/v3";
import {
  practiceAttemptTeachingSchema,
  practiceTeachingStateSchema,
  formatPracticeTeachingFeedback,
} from "@huayi/learning-domain";
import { practiceSessionResponseSchema } from "./practice-contracts.js";

export const practiceTeachingActionSchema = z.discriminatedUnion("action", [
  z.strictObject({
    action: z.literal("rewrite"),
    expectedRevision: z.number().int().positive(),
    expectedControlRevision: z.number().int().nonnegative(),
    expectedDraftRevision: z.number().int().nonnegative(),
  }),
  z.strictObject({
    action: z.literal("reveal-hint"),
    expectedRevision: z.number().int().positive(),
    expectedControlRevision: z.number().int().nonnegative(),
    ordinal: z.number().int().min(0).max(4),
  }),
]);
export type PracticeTeachingAction = z.infer<typeof practiceTeachingActionSchema>;

export const practiceTeachingDetailSchema = z
  .strictObject({
    version: z.literal(1),
    session: practiceSessionResponseSchema,
    teaching: practiceTeachingStateSchema
      .extend({
        attempts: z.array(practiceAttemptTeachingSchema).max(5),
      })
      .nullable(),
  })
  .superRefine(({ session, teaching }, context) => {
    if (teaching === null) return;
    const invalid = (message: string) => context.addIssue({ code: z.ZodIssueCode.custom, message });
    if (session.type !== "sentence-creation" || !session.workspace)
      invalid("Teaching belongs to a sentence workspace.");
    const item = session.items[0];
    if (session.items.length !== 1 || item?.itemId !== teaching.target.itemId)
      invalid("Teaching target must belong to the session.");
    if (
      teaching.target.state === "deleted"
        ? teaching.target.deletedAt !== item?.learningItemDeletedAt
        : item?.learningItemDeletedAt !== undefined
    )
      invalid("Teaching target deletion must match the session.");
    const answers = session.attempts ?? [];
    if (answers.length !== teaching.attempts.length)
      invalid("Every answer must have exactly one teaching entry.");
    teaching.attempts.forEach((metadata, index) => {
      const answer = answers[index];
      if (
        metadata.attemptId !== answer?.id ||
        metadata.ordinal !== index ||
        metadata.parentAttemptId !== (answers[index - 1]?.id ?? null)
      )
        invalid("Teaching answer identity and order must match.");
      if (metadata.feedback) {
        if (!answer || formatPracticeTeachingFeedback(metadata.feedback) !== answer.feedback)
          invalid("Structured feedback must match its answer's saved feedback.");
        if (
          metadata.feedback.assessment === "needs-revision" &&
          !answer?.answer.includes(metadata.feedback.answerExcerpt)
        )
          invalid("Feedback evidence must come from this answer.");
      }
      if (metadata.feedbackCompletedAt !== null && answer?.feedback === undefined)
        invalid("Feedback completion requires saved feedback.");
    });
    const round = teaching.round;
    if (
      round.parentAttemptId !== (answers[round.ordinal - 1]?.id ?? null) ||
      (answers.length !== round.ordinal && answers.length !== round.ordinal + 1)
    )
      invalid("The current round must follow the saved answers.");
    const current = teaching.attempts[round.ordinal];
    if (current && current.hintViewedAt !== round.hintViewedAt)
      invalid("Submitted hint facts are immutable within their round.");
    if (
      session.status === "completed" &&
      (!current || answers[round.ordinal]?.feedback === undefined)
    )
      invalid("Completed teaching needs feedback on the current round.");
  });
export type PracticeTeachingDetail = z.infer<typeof practiceTeachingDetailSchema>;

export {
  practiceTeachingStateSchema,
  practiceTeachingFeedbackSchema,
  formatPracticeTeachingFeedback,
  type PracticeTeachingState,
  type PracticeTeachingFeedback,
} from "@huayi/learning-domain";
