import { z } from "zod/v3";

const idSchema = z.string().trim().min(1).max(200);
const timestampSchema = z.string().datetime({ offset: true });

export const exportTargetSchema = z.enum(["eudic", "shanbay"]);
export type ExportTarget = z.infer<typeof exportTargetSchema>;

export const exportReceiptSchema = z.strictObject({
  entryId: idSchema,
  outcome: z.enum(["created", "already-present", "confirmed"]),
  recordedAt: timestampSchema,
  target: exportTargetSchema,
});
export type ExportReceipt = z.infer<typeof exportReceiptSchema>;

export const exportOutboxStateSchema = z.enum([
  "queued",
  "in-flight",
  "delivered",
  "failed",
  "cancelled",
]);
export type ExportOutboxState = z.infer<typeof exportOutboxStateSchema>;

export const exportOutboxItemSchema = z.strictObject({
  attemptCount: z.number().int().nonnegative().safe(),
  createdAt: timestampSchema,
  entryId: idSchema,
  id: idSchema,
  lastError: z
    .enum([
      "authentication-failed",
      "credential-missing",
      "data-corrupt",
      "entry-missing",
      "invalid-response",
      "network-error",
      "rate-limited",
      "timeout",
      "vault-locked",
    ])
    .optional(),
  receipt: exportReceiptSchema.optional(),
  state: exportOutboxStateSchema,
  target: exportTargetSchema,
  updatedAt: timestampSchema,
});
export type ExportOutboxItem = z.infer<typeof exportOutboxItemSchema>;

export const eudicImportStateSchema = z.enum([
  "idle",
  "running",
  "paused",
  "completed",
  "failed",
  "source-limit-reached",
]);
export type EudicImportState = z.infer<typeof eudicImportStateSchema>;

export const eudicImportJobSchema = z
  .strictObject({
    duplicateCount: z.number().int().nonnegative().safe(),
    importedCount: z.number().int().nonnegative().safe(),
    lastError: z
      .enum([
        "authentication-failed",
        "credential-missing",
        "data-corrupt",
        "invalid-response",
        "network-error",
        "rate-limited",
        "timeout",
        "vault-locked",
      ])
      .optional(),
    nextPage: z.number().int().nonnegative().max(51),
    state: eudicImportStateSchema,
    updatedAt: timestampSchema,
  })
  .superRefine((job, context) => {
    if (job.nextPage === 51 && job.state !== "source-limit-reached") {
      context.addIssue({
        code: "custom",
        message: "Terminal Eudic cursor requires source-limit-reached.",
        path: ["state"],
      });
    }
    if (job.state === "source-limit-reached" && job.nextPage !== 51) {
      context.addIssue({
        code: "custom",
        message: "Source-limit state requires terminal Eudic cursor.",
        path: ["nextPage"],
      });
    }
  });
export type EudicImportJob = z.infer<typeof eudicImportJobSchema>;

export const shanbayBatchItemSchema = z.strictObject({
  entryId: idSchema,
  outboxId: idSchema,
});
export type ShanbayBatchItem = z.infer<typeof shanbayBatchItemSchema>;

export const shanbayBatchSchema = z.strictObject({
  items: z.array(shanbayBatchItemSchema).min(1).max(100),
  token: idSchema,
});
export type ShanbayBatch = z.infer<typeof shanbayBatchSchema>;

export interface WordbookExportEngine {
  enqueue(entryId: string, targets: readonly ExportTarget[]): Promise<readonly ExportOutboxItem[]>;
  cancelEntry(entryId: string): Promise<void>;
  claimShanbayBatch(limit: number): Promise<ShanbayBatch | null>;
  listOutbox(states?: readonly ExportOutboxState[]): Promise<readonly ExportOutboxItem[]>;
  retry(outboxId: string): Promise<void>;
  startEudicImport(): Promise<EudicImportJob>;
  resumeEudicImport(): Promise<EudicImportJob>;
  pauseEudicImport(): Promise<EudicImportJob>;
  getEudicImportJob(): Promise<EudicImportJob>;
  processEudicOnce(): Promise<boolean>;
  processEudicImportOnce(): Promise<boolean>;
  resolveShanbayBatch(
    token: string,
    confirmedOutboxIds: readonly string[],
    failedOutboxIds: readonly string[],
  ): Promise<boolean>;
}
