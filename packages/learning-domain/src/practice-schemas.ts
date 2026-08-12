import { z } from "zod/v3";

const idSchema = z.string().trim().min(1).max(128);
const instantSchema = z.string().datetime({ offset: true });
const textSchema = z.string().trim().min(1).max(4_000);
const resourceFields = {
  createdAt: instantSchema,
  id: idSchema,
  revision: z.number().int().min(1),
  updatedAt: instantSchema,
};

export const practiceRatingSchema = z.enum(["forgot", "effortful", "mastered"]);
export type PracticeRating = z.infer<typeof practiceRatingSchema>;
export const scheduleStateSchema = z
  .strictObject({
    consecutiveMastered: z.number().int().nonnegative(),
    dueAt: instantSchema.nullable(),
    lastRating: practiceRatingSchema.optional(),
    level: z.number().int().min(-1).max(5),
  })
  .refine((state) => (state.level === -1) === (state.dueAt === null), {
    message: "Only new schedule states may have no due date.",
  })
  .refine((state) => state.level !== -1 || state.lastRating === undefined, {
    message: "New schedule states cannot have a last rating.",
  })
  .refine((state) => state.level !== -1 || state.consecutiveMastered === 0, {
    message: "New schedule states cannot have a mastered streak.",
  });
export type ScheduleState = z.infer<typeof scheduleStateSchema>;

export const practiceTurnSchema = z.strictObject({
  content: textSchema,
  createdAt: instantSchema,
  id: idSchema,
  ordinal: z.number().int().min(0).max(10),
  role: z.enum(["user", "assistant"]),
});
export const practiceAttemptSchema = z.strictObject({
  answer: textSchema,
  feedback: textSchema.optional(),
  id: idSchema,
  itemIds: z.array(idSchema).min(1).max(3),
  submittedAt: instantSchema,
});
export const practiceSessionItemSchema = z
  .strictObject({
    itemId: idSchema,
    position: z.number().int().min(0).max(2),
    rating: practiceRatingSchema.optional(),
    scheduleAfter: scheduleStateSchema.optional(),
    scheduleBefore: scheduleStateSchema,
  })
  .refine((item) => (item.rating === undefined) === (item.scheduleAfter === undefined), {
    message: "A rated practice item must include its resulting schedule.",
  });
export type PracticeSessionItem = z.infer<typeof practiceSessionItemSchema>;

export const practiceSessionSchema = z
  .strictObject({
    ...resourceFields,
    attempts: z.array(practiceAttemptSchema).max(5).optional(),
    finalFeedback: textSchema.optional(),
    items: z.array(practiceSessionItemSchema).min(1).max(3),
    prompt: textSchema,
    status: z.enum(["active", "awaiting-feedback", "completed", "failed"]),
    turns: z.array(practiceTurnSchema).max(11),
    type: z.enum(["sentence-creation", "dialogue"]),
  })
  .superRefine((session, context) => {
    const itemIds = session.items.map((item) => item.itemId);
    if (new Set(itemIds).size !== itemIds.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Practice item ids must be unique.",
      });
    }
    session.items.forEach((item, index) => {
      if (item.position !== index) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Practice item positions must be contiguous and ordered.",
        });
      }
    });
    for (const attempt of session.attempts ?? []) {
      if (new Set(attempt.itemIds).size !== attempt.itemIds.length) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Attempt item ids must be unique.",
        });
      }
      if (attempt.itemIds.some((itemId) => !itemIds.includes(itemId))) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Attempt items must belong to the practice session.",
        });
      }
    }
    session.turns.forEach((turn, index) => {
      if (turn.ordinal !== index) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Practice turn ordinals must be contiguous and ordered.",
        });
      }
    });
    if (session.type === "sentence-creation") {
      if (session.items.length !== 1) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Sentence creation uses exactly one learning item.",
        });
      }
    } else {
      session.turns.forEach((turn, index) => {
        const expectedRole = index % 2 === 0 ? "assistant" : "user";
        if (turn.role !== expectedRole) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Dialogue turns must be an opener followed by user-assistant rounds.",
          });
        }
      });
      if (session.status === "completed") {
        const rounds = (session.turns.length - 1) / 2;
        if (!Number.isInteger(rounds) || rounds < 3 || rounds > 5) {
          context.addIssue({
            code: z.ZodIssueCode.custom,
            message: "Completed dialogues require three to five rounds.",
          });
        }
      }
    }
    if (session.status === "completed" && session.finalFeedback === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Completed practice sessions require final feedback.",
      });
    }
  });
export type PracticeSession = z.infer<typeof practiceSessionSchema>;
