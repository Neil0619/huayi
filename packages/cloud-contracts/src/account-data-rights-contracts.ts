import {
  analysisRecordSchema,
  learningItemSchema,
  practiceSessionSchema,
  scheduleStateSchema,
  storeAnalysisResultSchema,
  studyCaptureSchema,
  wordEntrySchema,
} from "@huayi/learning-domain";
import { z } from "zod/v3";

import {
  apiErrorDetailSchema,
  resourceIdSchema,
  revisionWriteHeadersSchema,
  writeHeadersSchema,
} from "./common-contracts.js";
import {
  accountPreferencesResponseSchema,
  accountSignInMethodsResponseSchema,
} from "./account-contracts.js";

const instantSchema = z.string().datetime({ offset: true });
const credentialFreeHttpsUrlSchema = z
  .string()
  .url()
  .refine((value) => {
    if (!value.startsWith("https://")) {
      return false;
    }
    const authority = value.slice("https://".length).split(/[/?#]/u, 1)[0] ?? "";
    return authority !== "" && !authority.includes("@");
  }, "Expected a credential-free HTTPS signed URL.");
const exportStableErrorSchema = z.enum([
  "export-build-failed",
  "object-write-failed",
  "object-delete-failed",
]);
const exportResourceCommon = {
  createdAt: instantSchema,
  formatVersion: z.literal(1),
  id: resourceIdSchema,
  revision: z.number().int().min(1),
  updatedAt: instantSchema,
};

export const accountDataExportJobResourceSchema = z.discriminatedUnion("state", [
  z.strictObject({ ...exportResourceCommon, state: z.literal("pending") }),
  z.strictObject({ ...exportResourceCommon, state: z.literal("running") }),
  z.strictObject({
    ...exportResourceCommon,
    byteLength: z.number().int().nonnegative(),
    expiresAt: instantSchema,
    recordCount: z.number().int().min(1),
    state: z.literal("ready"),
  }),
  z.strictObject({
    ...exportResourceCommon,
    stableErrorCode: exportStableErrorSchema,
    state: z.literal("failed"),
  }),
  z.strictObject({
    ...exportResourceCommon,
    expiresAt: instantSchema,
    state: z.literal("expired"),
  }),
]);
export type AccountDataExportJobResource = z.infer<typeof accountDataExportJobResourceSchema>;

export const createAccountDataExportRequestSchema = z.strictObject({});
export const retryAccountDataExportRequestSchema = z.strictObject({
  expectedRevision: z.number().int().min(1),
});
export const accountDeletionRequestSchema = z.strictObject({
  confirmation: z.literal("delete-account"),
});
export const accountDeletionResponseSchema = z.strictObject({
  accepted: z.literal(true),
  requestedAt: instantSchema,
});
export type AccountDeletionResponse = z.infer<typeof accountDeletionResponseSchema>;
export const downloadAccountDataExportResponseSchema = z.strictObject({
  expiresAt: instantSchema,
  url: credentialFreeHttpsUrlSchema,
});
export type DownloadAccountDataExportResponse = z.infer<
  typeof downloadAccountDataExportResponseSchema
>;
export const currentAccountDataExportResponseSchema = z.strictObject({
  job: accountDataExportJobResourceSchema.nullable(),
});
export const dataRightsWorkerResponseSchema = z.strictObject({
  deletion: z.enum(["idle", "processed", "failed"]),
  export: z.enum(["idle", "processed", "failed"]),
});

export const accountDataExportRecordSchema = z.union([
  z.strictObject({
    exportedAt: instantSchema,
    product: z.literal("huayi-cloud"),
    recordType: z.literal("manifest"),
    schemaVersion: z.literal(1),
  }),
  z.strictObject({
    ...accountPreferencesResponseSchema.shape,
    createdAt: instantSchema,
    recordType: z.literal("account-preferences"),
  }),
  z.strictObject({
    ...accountSignInMethodsResponseSchema.shape,
    recordType: z.literal("account-sign-in-methods"),
  }),
  z.strictObject({
    action: z.enum(["translate", "explain"]),
    createdAt: instantSchema,
    expiresAt: instantSchema,
    id: resourceIdSchema,
    recordType: z.literal("extension-query-generation"),
    selectionKind: z.enum(["word", "phrase", "sentence", "passage"]),
    sentenceContext: z.string().trim().min(1).max(2_000).optional(),
    sourceText: z.string().trim().min(1).max(2_000),
    sourceType: z.enum(["web-selection", "youtube-caption"]),
    state: z.literal("running"),
  }),
  z.strictObject({
    action: z.enum(["translate", "explain"]),
    createdAt: instantSchema,
    expiresAt: instantSchema,
    id: resourceIdSchema,
    recordType: z.literal("extension-query-generation"),
    result: storeAnalysisResultSchema,
    selectionKind: z.enum(["word", "phrase", "sentence", "passage"]),
    sentenceContext: z.string().trim().min(1).max(2_000).optional(),
    sourceText: z.string().trim().min(1).max(2_000),
    sourceType: z.enum(["web-selection", "youtube-caption"]),
    state: z.literal("completed"),
  }),
  z.strictObject({
    action: z.enum(["translate", "explain"]),
    createdAt: instantSchema,
    error: apiErrorDetailSchema,
    expiresAt: instantSchema,
    id: resourceIdSchema,
    recordType: z.literal("extension-query-generation"),
    selectionKind: z.enum(["word", "phrase", "sentence", "passage"]),
    sentenceContext: z.string().trim().min(1).max(2_000).optional(),
    sourceText: z.string().trim().min(1).max(2_000),
    sourceType: z.enum(["web-selection", "youtube-caption"]),
    state: z.literal("failed"),
  }),
  z.strictObject({
    capture: studyCaptureSchema,
    latestAnalysis: z
      .strictObject({
        createdAt: instantSchema,
        id: resourceIdSchema,
        reviewState: z.enum(["pendingReview", "reviewed"]),
        revision: z.number().int().min(1),
      })
      .nullable(),
    recordType: z.literal("study-capture"),
  }),
  z.strictObject({ analysis: analysisRecordSchema, recordType: z.literal("analysis") }),
  z.strictObject({
    archivedAt: instantSchema.nullable(),
    item: learningItemSchema,
    recordType: z.literal("learning-item"),
    schedule: scheduleStateSchema,
  }),
  z.strictObject({ recordType: z.literal("word"), word: wordEntrySchema }),
  z.strictObject({
    recordType: z.literal("practice-session"),
    session: practiceSessionSchema,
  }),
]);
export type AccountDataExportRecord = z.infer<typeof accountDataExportRecordSchema>;

export const accountDataExportCreateHeadersSchema = writeHeadersSchema;
export const accountDataExportRetryHeadersSchema = revisionWriteHeadersSchema;
export const accountDeletionHeadersSchema = writeHeadersSchema;
export const accountDataRightsHttpRoutes = Object.freeze({
  createExport: "/v1/account-data-exports",
  currentExport: "/v1/account-data-exports/current",
  deleteAccount: "/v1/account-deletion",
  downloadExport: "/v1/account-data-exports/:id/download-url",
  retryExport: "/v1/account-data-exports/:id/retry",
  runWorker: "/internal/data-rights/run",
});
