import { storeAnalysisResultSchema, studyCaptureSchema } from "@huayi/learning-domain";
import { z } from "zod/v3";

import {
  apiErrorDetailSchema,
  cursorSchema,
  paginationQueryFields,
  quotaSummarySchema,
  resourceIdSchema,
} from "./common-contracts.js";

const instantSchema = z.string().datetime({ offset: true });
const selectionKindSchema = z.enum(["word", "phrase", "sentence", "passage"]);
export type StoreAnalysisResult = z.infer<typeof storeAnalysisResultSchema>;
export { storeAnalysisResultSchema };

export const extensionQueryRequestSchema = z
  .strictObject({
    action: z.enum(["translate", "explain"]),
    selectionKind: selectionKindSchema,
    sentenceContext: z.string().trim().min(1).max(2_000).optional(),
    sourceText: z.string().trim().min(1).max(2_000),
    sourceType: z.enum(["web-selection", "youtube-caption"]),
  })
  .superRefine((value, context) => {
    const lexical = value.selectionKind === "word" || value.selectionKind === "phrase";
    if (!lexical && value.sentenceContext !== undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Sentence and passage queries accept only the exact selection.",
        path: ["sentenceContext"],
      });
    }
  });
export type ExtensionQueryRequest = z.infer<typeof extensionQueryRequestSchema>;

export const extensionQueryEventSchema = z.discriminatedUnion("type", [
  z.strictObject({ generationId: resourceIdSchema, type: z.literal("query.started") }),
  z.strictObject({
    generationId: resourceIdSchema,
    section: z.string().trim().min(1).max(100),
    sequence: z.number().int().nonnegative(),
    text: z.string().min(1).max(4_096),
    type: z.literal("query.preview"),
  }),
  z.strictObject({
    generationId: resourceIdSchema,
    quota: quotaSummarySchema,
    result: storeAnalysisResultSchema,
    type: z.literal("query.completed"),
  }),
  z.strictObject({
    error: apiErrorDetailSchema,
    generationId: resourceIdSchema,
    quota: quotaSummarySchema,
    type: z.literal("query.failed"),
  }),
]);
export type ExtensionQueryEvent = z.infer<typeof extensionQueryEventSchema>;

export const extensionQueryGenerationSchema = z.discriminatedUnion("state", [
  z.strictObject({
    createdAt: instantSchema,
    expiresAt: instantSchema,
    id: resourceIdSchema,
    state: z.literal("running"),
  }),
  z.strictObject({
    createdAt: instantSchema,
    expiresAt: instantSchema,
    id: resourceIdSchema,
    result: storeAnalysisResultSchema,
    state: z.literal("completed"),
  }),
  z.strictObject({
    createdAt: instantSchema,
    error: apiErrorDetailSchema,
    expiresAt: instantSchema,
    id: resourceIdSchema,
    state: z.literal("failed"),
  }),
]);
export type ExtensionQueryGeneration = z.infer<typeof extensionQueryGenerationSchema>;

export const extensionQueryCleanupResponseSchema = z.strictObject({
  abandonedCount: z.number().int().min(0).max(100),
  deletedCount: z.number().int().min(0).max(100),
});
export type ExtensionQueryCleanupResponse = z.infer<typeof extensionQueryCleanupResponseSchema>;

export const extensionQueryHttpRoutes = Object.freeze({
  cleanup: "/internal/extension-queries/cleanup",
  detail: "/v1/extension-query-generations/:id",
  start: "/v1/extension-queries:stream",
});

export const studyCaptureCreateRequestSchema = z.strictObject({
  kind: z.enum(["phrase", "sentence", "passage"]),
  sourceText: z.string().trim().min(1).max(2_000),
});
export type StudyCaptureCreateRequest = z.infer<typeof studyCaptureCreateRequestSchema>;
export const studyCaptureCreateResponseSchema = z.discriminatedUnion("outcome", [
  z.strictObject({
    capture: studyCaptureSchema,
    outcome: z.literal("created"),
    undo: z.strictObject({
      captureId: resourceIdSchema,
      expectedRevision: z.number().int().min(1),
    }),
  }),
  z.strictObject({ capture: studyCaptureSchema, outcome: z.literal("existing") }),
  z.strictObject({ capture: studyCaptureSchema, outcome: z.literal("linked-analysis") }),
]);
export const studyCapturePatchRequestSchema = z
  .strictObject({
    expectedRevision: z.number().int().min(1),
    kind: z.enum(["phrase", "sentence", "passage"]).optional(),
    title: z.string().trim().min(1).max(500).nullable().optional(),
    userContext: z.string().trim().min(1).max(1_000).nullable().optional(),
  })
  .refine(
    (value) =>
      value.kind !== undefined || value.title !== undefined || value.userContext !== undefined,
    { message: "At least one capture field must change." },
  );
export const studyCaptureDeleteRequestSchema = z.strictObject({
  expectedRevision: z.number().int().min(1),
});
export const studyCaptureDeleteResponseSchema = z.strictObject({
  deleted: z.literal(true),
  id: resourceIdSchema,
});
export const studyCaptureLatestAnalysisSchema = z.strictObject({
  createdAt: instantSchema,
  id: resourceIdSchema,
  reviewState: z.enum(["pendingReview", "reviewed"]),
  revision: z.number().int().min(1),
});
export const studyCaptureDetailResponseSchema = z.strictObject({
  activeAnalysisRequest: z
    .strictObject({ requestId: resourceIdSchema, state: z.literal("running") })
    .nullable()
    .default(null),
  capture: studyCaptureSchema,
  latestAnalysis: studyCaptureLatestAnalysisSchema.nullable(),
});
export type StudyCaptureDetailResponse = z.infer<typeof studyCaptureDetailResponseSchema>;
export const studyCaptureListQuerySchema = z.strictObject({
  ...paginationQueryFields,
  kind: z.enum(["phrase", "sentence", "passage"]).optional(),
  limit: paginationQueryFields.limit.default(20),
  query: z.string().trim().min(1).max(200).optional(),
  status: z.enum(["pending", "analyzing", "analyzed"]).default("pending"),
});
export type StudyCaptureListQuery = z.infer<typeof studyCaptureListQuerySchema>;
export const studyCaptureListResponseSchema = z.strictObject({
  items: z.array(studyCaptureDetailResponseSchema).max(100),
  nextCursor: cursorSchema.nullable(),
});
export const studyCapturePatchResponseSchema = studyCaptureDetailResponseSchema;
export const studyCaptureAnalyzeRequestSchema = z.strictObject({
  expectedRevision: z.number().int().min(1),
  intent: z.enum(["initial", "reanalysis"]),
});
export type StudyCaptureAnalyzeRequest = z.infer<typeof studyCaptureAnalyzeRequestSchema>;
export const studyCaptureHttpRoutes = Object.freeze({
  analyze: "/v1/study-captures/:id/analyses:stream",
  create: "/v1/study-captures",
  detail: "/v1/study-captures/:id",
  list: "/v1/study-captures",
});

const cloudWordCopyFields = {
  collectedAt: instantSchema,
  contextualMeaningZh: z.string().trim().min(1).max(1_000),
  headword: z.string().trim().min(1).max(200),
  sentence: z.string().trim().min(1).max(2_000),
};
export const cloudWordCopyRequestSchema = z.strictObject(cloudWordCopyFields);
export type CloudWordCopyRequest = z.infer<typeof cloudWordCopyRequestSchema>;
export const cloudWordCopyResponseSchema = z.strictObject({
  contextCreated: z.boolean(),
  wordId: resourceIdSchema,
});
export type CloudWordCopyResponse = z.infer<typeof cloudWordCopyResponseSchema>;
const cloudWordCopyBatchContextSchema = z.strictObject({
  collectedAt: instantSchema,
  contextKey: z.string().trim().min(1).max(200),
  contextualMeaningZh: z.string().trim().min(1).max(1_000).optional(),
  sentence: z.string().trim().min(1).max(2_000),
});
const cloudWordCopyBatchEntrySchema = z
  .strictObject({
    contexts: z.array(cloudWordCopyBatchContextSchema).max(1_000),
    entryKey: z.string().trim().min(1).max(200),
    headword: z.string().trim().min(1).max(200),
  })
  .superRefine((value, context) => {
    if (new Set(value.contexts.map((item) => item.contextKey)).size !== value.contexts.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Local context keys must be unique within an entry.",
        path: ["contexts"],
      });
    }
  });
export const cloudWordCopyBatchRequestSchema = z
  .strictObject({ entries: z.array(cloudWordCopyBatchEntrySchema).min(1).max(100) })
  .superRefine((value, context) => {
    if (new Set(value.entries.map((item) => item.entryKey)).size !== value.entries.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Local entry keys must be unique within a batch.",
        path: ["entries"],
      });
    }
    if (value.entries.reduce((total, entry) => total + entry.contexts.length, 0) > 1_000) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A batch may contain at most 1000 contexts.",
        path: ["entries"],
      });
    }
  });
export type CloudWordCopyBatchRequest = z.infer<typeof cloudWordCopyBatchRequestSchema>;
const cloudWordCopyBatchResponseEntrySchema = z.strictObject({
  contexts: z.array(
    z.strictObject({
      contextKey: z.string().trim().min(1).max(200),
      outcome: z.enum(["created", "duplicate"]),
    }),
  ),
  entryKey: z.string().trim().min(1).max(200),
  wordId: resourceIdSchema,
  wordOutcome: z.enum(["created", "existing"]),
});
export const cloudWordCopyBatchResponseSchema = z
  .strictObject({
    entries: z.array(cloudWordCopyBatchResponseEntrySchema).min(1).max(100),
    summary: z.strictObject({
      contextCount: z.number().int().min(0).max(1_000),
      createdContextCount: z.number().int().min(0).max(1_000),
      createdWordCount: z.number().int().min(0).max(100),
      duplicateContextCount: z.number().int().min(0).max(1_000),
      existingWordCount: z.number().int().min(0).max(100),
      wordCount: z.number().int().min(1).max(100),
    }),
  })
  .superRefine((value, context) => {
    const contexts = value.entries.flatMap((entry) => entry.contexts);
    const expected = {
      contextCount: contexts.length,
      createdContextCount: contexts.filter((item) => item.outcome === "created").length,
      createdWordCount: value.entries.filter((item) => item.wordOutcome === "created").length,
      duplicateContextCount: contexts.filter((item) => item.outcome === "duplicate").length,
      existingWordCount: value.entries.filter((item) => item.wordOutcome === "existing").length,
      wordCount: value.entries.length,
    };
    if (JSON.stringify(value.summary) !== JSON.stringify(expected)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Batch summary must match entry outcomes.",
        path: ["summary"],
      });
    }
    if (new Set(value.entries.map((item) => item.entryKey)).size !== value.entries.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Response entry keys must be unique.",
        path: ["entries"],
      });
    }
  });
export type CloudWordCopyBatchResponse = z.infer<typeof cloudWordCopyBatchResponseSchema>;
export const cloudWordCopyHttpRoutes = Object.freeze({
  copy: "/v1/words:copy",
  importLocal: "/v1/words:import-local",
});
