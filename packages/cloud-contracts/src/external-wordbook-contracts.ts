import { z } from "zod/v3";

import {
  cursorSchema,
  paginationQueryFields,
  resourceIdSchema,
  revisionWriteHeadersSchema,
  writeHeadersSchema,
} from "./common-contracts.js";

export const externalWordbookTargetSchema = z.enum(["eudic", "shanbay"]);
export type ExternalWordbookTarget = z.infer<typeof externalWordbookTargetSchema>;
export const externalWordbookDirectionSchema = z.enum(["import", "export"]);
export const externalWordbookJobStateSchema = z.enum([
  "pending",
  "active",
  "completed",
  "failed",
  "cancelled",
  "source-limit-reached",
]);
export const externalWordbookStableErrorCodeSchema = z.enum([
  "authentication-failed",
  "credential-missing",
  "data-corrupt",
  "invalid-response",
  "network-error",
  "rate-limited",
  "timeout",
]);

export const createWordbookJobRequestSchema = z
  .strictObject({
    direction: externalWordbookDirectionSchema,
    target: externalWordbookTargetSchema,
  })
  .refine((job) => job.target !== "shanbay" || job.direction === "export", {
    message: "Shanbay supports export only.",
  });
export type CreateWordbookJobRequest = z.infer<typeof createWordbookJobRequestSchema>;

export const wordbookJobResourceSchema = z
  .strictObject({
    createdAt: z.string().datetime({ offset: true }),
    direction: externalWordbookDirectionSchema,
    failedCount: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    id: resourceIdSchema,
    lastErrorCode: externalWordbookStableErrorCodeSchema.nullable(),
    nextPage: z.number().int().min(0).max(51).nullable(),
    processedCount: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    revision: z.number().int().min(1),
    state: externalWordbookJobStateSchema,
    target: externalWordbookTargetSchema,
    totalCount: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable(),
    updatedAt: z.string().datetime({ offset: true }),
  })
  .superRefine((job, context) => {
    const isImport = job.target === "eudic" && job.direction === "import";
    if ((isImport && job.nextPage === null) || (!isImport && job.nextPage !== null)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Only Eudic imports have a next page.",
        path: ["nextPage"],
      });
    }
    if ((isImport && job.totalCount !== null) || (!isImport && job.totalCount === null)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Only exports have a total count.",
        path: ["totalCount"],
      });
    }
    if (job.state === "source-limit-reached" && (!isImport || job.nextPage !== 51)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Only a terminal Eudic import cursor may reach the source limit.",
        path: ["state"],
      });
    }
    if (job.totalCount !== null && job.processedCount + job.failedCount > job.totalCount) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Job counts cannot exceed the export snapshot.",
      });
    }
  });
export type WordbookJobResource = z.infer<typeof wordbookJobResourceSchema>;

export const listWordbookJobsQuerySchema = z.strictObject({
  ...paginationQueryFields,
  direction: externalWordbookDirectionSchema.optional(),
  state: externalWordbookJobStateSchema.optional(),
  target: externalWordbookTargetSchema.optional(),
});
export type ListWordbookJobsQuery = z.infer<typeof listWordbookJobsQuerySchema>;
export const wordbookJobListResponseSchema = z.strictObject({
  items: z.array(wordbookJobResourceSchema).max(100),
  nextCursor: cursorSchema.nullable(),
});
export type WordbookJobListResponse = z.infer<typeof wordbookJobListResponseSchema>;

const leaseNonceSchema = z
  .string()
  .min(43)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/u);
const leaseTokenSchema = z
  .string()
  .min(43)
  .max(512)
  .regex(/^[A-Za-z0-9_-]+$/u);
export const wordbookLeaseRequestSchema = z.strictObject({
  claimNonce: leaseNonceSchema,
  expectedRevision: z.number().int().min(1),
});
export type WordbookLeaseRequest = z.infer<typeof wordbookLeaseRequestSchema>;

const exportLeaseEntrySchema = z.strictObject({
  contextLine: z.string().trim().min(1).max(2_000).optional(),
  headword: z.string().trim().min(1).max(200),
  itemId: resourceIdSchema,
});
export const wordbookLeaseResponseSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    entries: z.array(exportLeaseEntrySchema).min(1).max(20),
    expiresAt: z.string().datetime({ offset: true }),
    jobId: resourceIdSchema,
    kind: z.literal("export"),
    leaseToken: leaseTokenSchema,
  }),
  z.strictObject({
    expiresAt: z.string().datetime({ offset: true }),
    jobId: resourceIdSchema,
    kind: z.literal("eudic-import"),
    leaseToken: leaseTokenSchema,
    page: z.number().int().min(0).max(50),
    pageSize: z.literal(100),
  }),
]);
export type WordbookLeaseResponse = z.infer<typeof wordbookLeaseResponseSchema>;

const successfulExportReceiptSchema = z.strictObject({
  itemId: resourceIdSchema,
  outcome: z.enum(["already-present", "confirmed", "created"]),
});
const failedExportReceiptSchema = z.strictObject({
  itemId: resourceIdSchema,
  outcome: z.literal("failed"),
  stableErrorCode: externalWordbookStableErrorCodeSchema,
});
const exportReceiptSchema = z.union([successfulExportReceiptSchema, failedExportReceiptSchema]);
const eudicImportEntrySchema = z.strictObject({
  addedAt: z.string().datetime({ offset: true }),
  contextLine: z.string().trim().min(1).max(2_000).optional(),
  headword: z.string().trim().min(1).max(200),
});
export const submitWordbookReceiptsRequestSchema = z
  .discriminatedUnion("kind", [
    z.strictObject({
      kind: z.literal("export"),
      leaseToken: leaseTokenSchema,
      receipts: z.array(exportReceiptSchema).min(1).max(20),
    }),
    z.strictObject({
      entries: z.array(eudicImportEntrySchema).max(100),
      kind: z.literal("eudic-import-page"),
      leaseToken: leaseTokenSchema,
      page: z.number().int().min(0).max(50),
    }),
    z.strictObject({
      kind: z.literal("eudic-import-failure"),
      leaseToken: leaseTokenSchema,
      page: z.number().int().min(0).max(50),
      stableErrorCode: externalWordbookStableErrorCodeSchema,
    }),
  ])
  .superRefine((request, context) => {
    if (request.kind !== "export") return;
    const ids = request.receipts.map((receipt) => receipt.itemId);
    if (new Set(ids).size !== ids.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Export receipt item IDs must be unique.",
        path: ["receipts"],
      });
    }
  });
export type SubmitWordbookReceiptsRequest = z.infer<typeof submitWordbookReceiptsRequestSchema>;

export const wordbookJobRevisionRequestSchema = z.strictObject({
  expectedRevision: z.number().int().min(1),
});
export type WordbookJobRevisionRequest = z.infer<typeof wordbookJobRevisionRequestSchema>;
export const wordbookReceiptResponseSchema = z.strictObject({
  job: wordbookJobResourceSchema,
});
export type WordbookReceiptResponse = z.infer<typeof wordbookReceiptResponseSchema>;

export const wordbookJobWriteHeadersSchema = writeHeadersSchema;
export const wordbookJobRevisionHeadersSchema = revisionWriteHeadersSchema;
export const externalWordbookHttpRoutes = Object.freeze({
  cancel: "/v1/wordbook-jobs/:id/cancel",
  create: "/v1/wordbook-jobs",
  detail: "/v1/wordbook-jobs/:id",
  lease: "/v1/wordbook-jobs/:id/lease",
  list: "/v1/wordbook-jobs",
  receipts: "/v1/wordbook-jobs/:id/receipts",
  retry: "/v1/wordbook-jobs/:id/retry",
});
