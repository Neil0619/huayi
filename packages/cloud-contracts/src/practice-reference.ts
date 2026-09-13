import { z } from "zod/v3";
import { resourceIdSchema } from "./common-contracts.js";

export const practiceReferenceRequestSchema = z.strictObject({
  expectedRevision: z.number().int().positive(),
  expectedControlRevision: z.number().int().nonnegative(),
  ordinal: z.number().int().min(0).max(4),
});
export type PracticeReferenceRequest = z.infer<typeof practiceReferenceRequestSchema>;

export const practiceReferenceResultSchema = z.strictObject({
  sentence: z
    .string()
    .trim()
    .min(1)
    .max(500)
    .refine((value) => /\p{Script=Latin}/u.test(value) && !/[{}\p{Script=Han}]/u.test(value)),
  translationZh: z
    .string()
    .trim()
    .min(1)
    .max(1000)
    .regex(/\p{Script=Han}/u),
  usageNoteZh: z
    .string()
    .trim()
    .min(1)
    .max(500)
    .regex(/\p{Script=Han}/u),
});
export type PracticeReferenceResult = z.infer<typeof practiceReferenceResultSchema>;

export const practiceReferenceArchiveSchema = z.strictObject({
  version: z.literal(1),
  result: practiceReferenceResultSchema,
  views: z
    .array(
      z.strictObject({
        ordinal: z.number().int().min(0).max(4),
        viewedAt: z.string().datetime({ offset: true }),
      }),
    )
    .max(5),
});

export const practiceReferenceDetailSchema = z.strictObject({
  version: z.literal(1),
  sessionId: resourceIdSchema,
  revision: z.number().int().positive(),
  controlRevision: z.number().int().nonnegative(),
  ordinal: z.number().int().min(0).max(4),
  availability: z.enum(["available", "pending-prompt", "inactive", "target-unavailable"]),
  ready: z.boolean(),
  viewedAt: z.string().datetime({ offset: true }).nullable(),
  reference: practiceReferenceResultSchema.nullable(),
});
export type PracticeReferenceDetail = z.infer<typeof practiceReferenceDetailSchema>;
