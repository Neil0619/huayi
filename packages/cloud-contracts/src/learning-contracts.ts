import {
  analysisRecordSchema,
  canonicalKeyForContent,
  expressionSchema,
  learningItemContentSchema,
  learningItemSchema,
  normalizeHeadword,
  normalizeTagName,
  practiceRatingSchema,
  scheduleStateSchema,
  sentencePatternSchema,
} from "@huayi/learning-domain";
import { z } from "zod/v3";

import {
  paginationQueryFields,
  queryBoolean,
  resourceIdSchema,
  revisionWriteHeadersSchema,
  writeHeadersSchema,
} from "./common-contracts.js";

export { canonicalKeyForContent, normalizeHeadword, normalizeTagName };
export type { LearningItemContent } from "@huayi/learning-domain";

const tagsSchema = z.array(z.string().trim().min(1).max(100)).max(50);
const systemAttributesSchema = z.array(z.string().trim().min(1).max(100)).max(50);
const decisionSchema = z.union([
  z.literal("create"),
  z.string().regex(/^merge:[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$/u),
]);
const confirmationCommon = {
  candidateId: resourceIdSchema,
  decision: decisionSchema,
  tags: tagsSchema,
};
export const candidateConfirmationSchema = z.discriminatedUnion("targetType", [
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
export const confirmCandidatesRequestSchema = z
  .strictObject({
    analysisRevision: z.number().int().min(1),
    confirmations: z.array(candidateConfirmationSchema).min(1).max(200),
  })
  .refine(
    (request) =>
      new Set(request.confirmations.map((confirmation) => confirmation.candidateId)).size ===
      request.confirmations.length,
    { message: "Each candidate can be confirmed only once." },
  )
  .superRefine((request, context) => {
    for (const [index, confirmation] of request.confirmations.entries()) {
      const normalizedTags = confirmation.tags.map(normalizeTagName);
      if (new Set(normalizedTags).size !== normalizedTags.length) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Confirmation tags must be unique after normalization.",
          path: ["confirmations", index, "tags"],
        });
      }
      if (
        "systemAttributes" in confirmation &&
        new Set(confirmation.systemAttributes).size !== confirmation.systemAttributes.length
      ) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: "System attributes must be unique.",
          path: ["confirmations", index, "systemAttributes"],
        });
      }
    }
  });
export type ConfirmCandidatesRequest = z.infer<typeof confirmCandidatesRequestSchema>;

const confirmationResultCommon = {
  action: z.enum(["created", "merged"]),
  candidateId: resourceIdSchema,
};
export const candidateConfirmationResultSchema = z.discriminatedUnion("type", [
  z.strictObject({
    ...confirmationResultCommon,
    item: learningItemSchema,
    type: z.literal("learning-item"),
  }),
]);
export const confirmCandidatesResponseSchema = z.strictObject({
  analysis: analysisRecordSchema,
  results: z.array(candidateConfirmationResultSchema).min(1).max(200),
});
export type ConfirmCandidatesResponse = z.infer<typeof confirmCandidatesResponseSchema>;

const learningItemWriteFields = {
  content: learningItemContentSchema,
  systemAttributes: systemAttributesSchema,
  tags: tagsSchema,
};
function requireUniqueLearningMetadata(
  request: { systemAttributes: string[]; tags: string[] },
  context: z.RefinementCtx,
) {
  if (new Set(request.tags.map(normalizeTagName)).size !== request.tags.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Tags must be unique after normalization.",
      path: ["tags"],
    });
  }
  if (new Set(request.systemAttributes).size !== request.systemAttributes.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "System attributes must be unique.",
      path: ["systemAttributes"],
    });
  }
}
export const createLearningItemRequestSchema = z
  .strictObject(learningItemWriteFields)
  .superRefine((request, context) => {
    requireUniqueLearningMetadata(request, context);
  });
export type CreateLearningItemRequest = z.infer<typeof createLearningItemRequestSchema>;
export const patchLearningItemRequestSchema = z
  .strictObject({
    ...learningItemWriteFields,
    expectedRevision: z.number().int().min(1),
  })
  .superRefine((request, context) => requireUniqueLearningMetadata(request, context));
export type PatchLearningItemRequest = z.infer<typeof patchLearningItemRequestSchema>;
export const deleteLearningItemRequestSchema = z.strictObject({
  expectedRevision: z.number().int().min(1),
});
export type DeleteLearningItemRequest = z.infer<typeof deleteLearningItemRequestSchema>;
export const learningItemArchiveRequestSchema = z.strictObject({
  expectedRevision: z.number().int().min(1),
});
export type LearningItemArchiveRequest = z.infer<typeof learningItemArchiveRequestSchema>;
export const mergeLearningItemsRequestSchema = z.strictObject({
  sourceRevision: z.number().int().min(1),
  targetItemId: resourceIdSchema,
  targetRevision: z.number().int().min(1),
});
export type MergeLearningItemsRequest = z.infer<typeof mergeLearningItemsRequestSchema>;
export const learningItemResponseSchema = learningItemSchema;
export const recentPracticeSummarySchema = z.strictObject({
  completedAt: z.string().datetime({ offset: true }),
  rating: practiceRatingSchema,
  sessionId: resourceIdSchema,
  type: z.enum(["sentence-creation", "dialogue"]),
});
export const learningItemDetailResponseSchema = z.strictObject({
  archivedAt: z.string().datetime({ offset: true }).nullable(),
  hasPracticeHistory: z.boolean(),
  item: learningItemSchema,
  recentPractice: recentPracticeSummarySchema.nullable(),
  schedule: scheduleStateSchema,
});
export type LearningItemDetailResponse = z.infer<typeof learningItemDetailResponseSchema>;
export const createLearningItemResponseSchema = learningItemDetailResponseSchema;
export type CreateLearningItemResponse = z.infer<typeof createLearningItemResponseSchema>;
export const createLearningItemWriteHeadersSchema = writeHeadersSchema;
export const learningItemMutationHeadersSchema = revisionWriteHeadersSchema;
export const deleteLearningItemResponseSchema = z.strictObject({
  deleted: z.literal(true),
  deletionKind: z.enum(["hard-delete", "erased"]),
  id: resourceIdSchema,
});
export type DeleteLearningItemResponse = z.infer<typeof deleteLearningItemResponseSchema>;
export const learningItemListResponseSchema = z.strictObject({
  items: z.array(learningItemDetailResponseSchema).max(100),
  nextCursor: z.string().nullable(),
});
export type LearningItemListResponse = z.infer<typeof learningItemListResponseSchema>;
export const listLearningItemsQuerySchema = z.strictObject({
  ...paginationQueryFields,
  archived: queryBoolean.default(false),
  due: z.enum(["due", "new"]).optional(),
  query: z.string().trim().min(1).max(200).optional(),
  systemAttribute: z.string().trim().min(1).max(100).optional(),
  tag: z.string().trim().min(1).max(100).optional(),
  type: z.enum(["expression", "sentence-pattern"]).optional(),
});
export type ListLearningItemsQuery = z.infer<typeof listLearningItemsQuerySchema>;
export const learningItemHttpRoutes = Object.freeze({
  archive: "/v1/learning-items/:id/archive",
  create: "/v1/learning-items",
  delete: "/v1/learning-items/:id",
  detail: "/v1/learning-items/:id",
  duplicateSuggestions: "/v1/learning-items/:id/duplicate-suggestions",
  list: "/v1/learning-items",
  mergeConfirm: "/v1/learning-items/:id/merge:confirm",
  mergePreview: "/v1/learning-items/:id/merge:preview",
  patch: "/v1/learning-items/:id",
  restore: "/v1/learning-items/:id/restore",
});

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
  expectedRevision: z.number().int().min(1),
});
export type DuplicateSuggestionsRequest = z.infer<typeof duplicateSuggestionsRequestSchema>;
export const duplicateSuggestionsHeadersSchema = writeHeadersSchema;
export const duplicateSuggestionsResponseSchema = z.strictObject({
  itemRevision: z.number().int().min(1),
  suggestions: z
    .array(
      z.strictObject({
        candidate: learningItemDetailResponseSchema,
        confidence: z.number().min(0).max(1),
        reasonZh: z.string().trim().min(1).max(500),
      }),
    )
    .max(10),
});
export type DuplicateSuggestionsResponse = z.infer<typeof duplicateSuggestionsResponseSchema>;
export const mergePreviewResponseSchema = z.strictObject({
  allowed: z.boolean(),
  blockedReason: z.enum(["source_has_practice_history", "source_is_scheduled"]).nullable(),
  scheduleDecision: z.literal("keep-target"),
  source: learningItemDetailResponseSchema,
  target: learningItemDetailResponseSchema,
});
export type MergePreviewResponse = z.infer<typeof mergePreviewResponseSchema>;
export const learningItemMergeResponseSchema = z.strictObject({
  deletedSourceId: resourceIdSchema,
  target: learningItemDetailResponseSchema,
});
export type LearningItemMergeResponse = z.infer<typeof learningItemMergeResponseSchema>;
