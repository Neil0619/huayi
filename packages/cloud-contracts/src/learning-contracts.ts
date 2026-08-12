import {
  contextObservationSchema,
  expressionSchema,
  learningItemContentSchema,
  learningItemSchema,
  sentencePatternSchema,
  wordEntrySchema,
} from "@huayi/learning-domain";
import { z } from "zod/v3";

import { paginationQueryFields, resourceIdSchema } from "./common-contracts.js";

const tagsSchema = z.array(z.string().trim().min(1).max(100)).max(50);
const systemAttributesSchema = z.array(z.string().trim().min(1).max(100)).max(50);
const decisionSchema = z.union([z.literal("create"), z.string().regex(/^merge:[^\s]{1,128}$/u)]);
const confirmationCommon = {
  candidateId: resourceIdSchema,
  decision: decisionSchema,
  tags: tagsSchema,
};
export const candidateConfirmationSchema = z.discriminatedUnion("targetType", [
  z.strictObject({
    ...confirmationCommon,
    payload: z.strictObject({
      contextualMeaningZh: z.string().trim().min(1).max(4_000).optional(),
      headword: z.string().trim().min(1).max(200),
      notes: z.string().max(4_000).optional(),
      type: z.literal("word"),
    }),
    targetType: z.literal("word"),
  }),
  z.strictObject({
    ...confirmationCommon,
    payload: expressionSchema,
    systemAttributes: systemAttributesSchema,
    targetType: z.literal("expression"),
  }),
  z.strictObject({
    ...confirmationCommon,
    payload: sentencePatternSchema,
    systemAttributes: systemAttributesSchema,
    targetType: z.literal("sentence-pattern"),
  }),
]);
export const confirmCandidatesRequestSchema = z.strictObject({
  analysisRevision: z.number().int().min(1),
  confirmations: z.array(candidateConfirmationSchema).min(1).max(200),
});

export const createLearningItemRequestSchema = z.strictObject({
  content: learningItemContentSchema,
  systemAttributes: systemAttributesSchema,
  tags: tagsSchema,
});
export const patchLearningItemRequestSchema = createLearningItemRequestSchema.extend({
  expectedRevision: z.number().int().min(1),
});
export const mergeLearningItemsRequestSchema = z.strictObject({
  expectedRevision: z.number().int().min(1),
  sourceItemId: resourceIdSchema,
  sourceRevision: z.number().int().min(1),
});
export const learningItemResponseSchema = learningItemSchema;
export const listLearningItemsQuerySchema = z.strictObject({
  ...paginationQueryFields,
  due: z.enum(["due", "new"]).optional(),
  query: z.string().trim().min(1).max(200).optional(),
  systemAttribute: z.string().trim().min(1).max(100).optional(),
  tag: z.string().trim().min(1).max(100).optional(),
  type: z.enum(["expression", "sentence-pattern"]).optional(),
});

export const upsertWordRequestSchema = z.strictObject({
  context: contextObservationSchema.omit({ id: true }).optional(),
  headword: z.string().trim().min(1).max(200),
  notes: z.string().max(4_000).optional(),
});
export const patchWordRequestSchema = z.strictObject({
  expectedRevision: z.number().int().min(1),
  notes: z.string().max(4_000).nullable(),
});
export const wordEntryResponseSchema = wordEntrySchema;

export const tagResourceSchema = z.strictObject({
  createdAt: z.string().datetime({ offset: true }),
  displayName: z.string().trim().min(1).max(100),
  id: resourceIdSchema,
  normalizedName: z.string().trim().min(1).max(100),
  revision: z.number().int().min(1),
  updatedAt: z.string().datetime({ offset: true }),
});
export const createTagRequestSchema = z.strictObject({
  displayName: z.string().trim().min(1).max(100),
});
export const patchTagRequestSchema = z.strictObject({
  displayName: z.string().trim().min(1).max(100),
  expectedRevision: z.number().int().min(1),
});
export const duplicateSuggestionsRequestSchema = z.strictObject({
  content: learningItemContentSchema,
});
export const duplicateSuggestionsResponseSchema = z.strictObject({
  exactItemId: resourceIdSchema.nullable(),
  exactOnly: z.boolean(),
  semantic: z
    .array(
      z.strictObject({ itemId: resourceIdSchema, reasonZh: z.string().trim().min(1).max(500) }),
    )
    .max(10),
});
