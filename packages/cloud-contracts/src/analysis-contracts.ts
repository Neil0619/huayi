import { analysisContentSchema, analysisRecordSchema } from "@huayi/learning-domain";
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
  type: z.enum(["manual", "web-selection", "youtube-caption"]),
});
export const startAnalysisRequestSchema = z.strictObject({
  action: z.enum(["translate", "explain", "deep-analyze"]),
  selectionKind: z.enum(["word", "phrase", "sentence", "passage"]),
  source: analysisSourceSchema,
  sourceText: z.string().trim().min(1).max(2_000),
});
export type StartAnalysisRequest = z.infer<typeof startAnalysisRequestSchema>;

export const importAnalysisRequestSchema = analysisContentSchema;
export type ImportAnalysisRequest = z.infer<typeof importAnalysisRequestSchema>;

export const listAnalysesQuerySchema = z.strictObject({
  ...paginationQueryFields,
  archived: queryBoolean.optional(),
  query: z.string().trim().min(1).max(200).optional(),
  reviewState: z.enum(["pendingReview", "reviewed"]).optional(),
  selectionKind: z.enum(["word", "phrase", "sentence", "passage"]).optional(),
  sourceType: z.enum(["manual", "web-selection", "youtube-caption"]).optional(),
});

export const processAnalysisRequestSchema = z.strictObject({
  expectedRevision: z.number().int().min(1),
  outcome: z.literal("nothing-to-save"),
});

export const analysisEventSchema = z.discriminatedUnion("type", [
  z.strictObject({
    requestId: resourceIdSchema,
    sentenceCount: z.number().int().min(1).max(40),
    type: z.literal("analysis.started"),
  }),
  z.strictObject({
    requestId: resourceIdSchema,
    section: z.union([z.literal("overall"), z.string().regex(/^sentence:[1-9]\d*$/u)]),
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
export const analysisSseEnvelopeSchema = z.strictObject({
  data: analysisEventSchema,
  event: z.literal("analysis"),
  id: z.string().regex(/^[1-9]\d*$/u),
});
