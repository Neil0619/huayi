import {
  analysisRecordSchema,
  candidateSchema,
  phraseAnalysisSchema,
  sentencePassageAnalysisSchema,
  webDeepAnalysisSchema,
} from "@huayi/learning-domain";
import { z } from "zod/v3";

import {
  apiErrorDetailSchema,
  paginationQueryFields,
  queryBoolean,
  quotaSummarySchema,
  resourceIdSchema,
} from "./common-contracts.js";

export const analysisSourceSchema = z.strictObject({
  title: z.string().trim().min(1).max(500).optional(),
  type: z.literal("manual"),
  userContext: z.string().trim().min(1).max(1_000).optional(),
});
export const startAnalysisRequestSchema = z.strictObject({
  selectionKind: z.enum(["phrase", "sentence", "passage"]),
  source: analysisSourceSchema,
  sourceText: z.string().trim().min(1).max(2_000),
});
export type StartAnalysisRequest = z.infer<typeof startAnalysisRequestSchema>;

export { analysisRecordSchema };
export {
  candidateSchema,
  phraseAnalysisSchema,
  sentencePassageAnalysisSchema,
  webDeepAnalysisSchema,
};
export type AnalysisRecord = z.infer<typeof analysisRecordSchema>;

export const listAnalysesQuerySchema = z.strictObject({
  ...paginationQueryFields,
  archived: queryBoolean.default(false),
  limit: paginationQueryFields.limit.default(20),
  query: z.string().trim().min(1).max(200).optional(),
  reviewState: z.enum(["pendingReview", "reviewed"]).optional(),
  selectionKind: z.enum(["phrase", "sentence", "passage"]).optional(),
  sourceType: z.enum(["manual", "study-capture"]).optional(),
});
export type ListAnalysesQuery = z.infer<typeof listAnalysesQuerySchema>;

export const processAnalysisRequestSchema = z.strictObject({
  expectedRevision: z.number().int().min(1),
  outcome: z.literal("nothing-to-save"),
});
export const analysisMutationRequestSchema = z.strictObject({
  expectedRevision: z.number().int().min(1),
});
export const analysisDeleteRequestSchema = z.strictObject({
  deleteStudyCapture: z.boolean(),
  expectedRevision: z.number().int().min(1),
});
export type AnalysisMutationRequest = z.infer<typeof analysisMutationRequestSchema>;
export const analysisDeleteResponseSchema = z.strictObject({
  deleted: z.literal(true),
  id: resourceIdSchema,
});
export type AnalysisDeleteResponse = z.infer<typeof analysisDeleteResponseSchema>;

export const analysisEventSchema = z.discriminatedUnion("type", [
  z.strictObject({
    requestId: resourceIdSchema,
    unitCount: z.number().int().min(1).max(40),
    type: z.literal("analysis.started"),
  }),
  z.strictObject({
    requestId: resourceIdSchema,
    section: z.union([z.literal("overall"), z.string().regex(/^unit:u(?:[1-9]|[1-3]\d|40)$/u)]),
    text: z.string().max(4_096),
    type: z.literal("analysis.preview"),
  }),
  z.strictObject({
    analysis: analysisRecordSchema,
    quota: quotaSummarySchema,
    type: z.literal("analysis.completed"),
  }),
  z.strictObject({
    error: apiErrorDetailSchema,
    quota: quotaSummarySchema,
    type: z.literal("analysis.failed"),
  }),
]);
export type AnalysisEvent = z.infer<typeof analysisEventSchema>;
export const analysisRequestStatusSchema = z.discriminatedUnion("state", [
  z.strictObject({ requestId: resourceIdSchema, state: z.literal("running") }),
  z.strictObject({
    analysisId: resourceIdSchema,
    requestId: resourceIdSchema,
    state: z.literal("completed"),
  }),
  z.strictObject({
    error: apiErrorDetailSchema,
    requestId: resourceIdSchema,
    state: z.literal("failed"),
  }),
]);
export type AnalysisRequestStatus = z.infer<typeof analysisRequestStatusSchema>;
export const analysisHistoryResponseSchema = z.strictObject({
  items: z.array(analysisRecordSchema).max(100),
  nextCursor: z.string().nullable(),
});
export const analysisHttpRoutes = Object.freeze({
  archive: "/v1/analyses/:id/archive",
  confirmCandidates: "/v1/analyses/:id/candidates:confirm",
  detail: "/v1/analyses/:id",
  delete: "/v1/analyses/:id",
  history: "/v1/analyses",
  process: "/v1/analyses/:id/process",
  restore: "/v1/analyses/:id/restore",
  start: "/v1/analyses:stream",
  status: "/v1/analysis-requests/:requestId",
});
export const analysisSseEnvelopeSchema = z.strictObject({
  data: analysisEventSchema,
  event: z.literal("analysis"),
  id: z.string().regex(/^[1-9]\d*$/u),
});
