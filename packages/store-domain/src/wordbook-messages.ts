import { z } from "zod/v3";

import { STORE_MESSAGE_VERSION } from "./messages.js";
import {
  eudicImportJobSchema,
  exportOutboxItemSchema,
  exportOutboxStateSchema,
  shanbayBatchSchema,
} from "./wordbook.js";

const version = z.literal(STORE_MESSAGE_VERSION);
const id = z.string().trim().min(1).max(200);
const base = { messageVersion: version };
export const storeWordbookRequestSchema = z.discriminatedUnion("type", [
  z.strictObject({ ...base, type: z.literal("store/eudic-import-start") }),
  z.strictObject({ ...base, type: z.literal("store/eudic-import-resume") }),
  z.strictObject({ ...base, type: z.literal("store/eudic-import-pause") }),
  z.strictObject({ ...base, type: z.literal("store/eudic-import-status") }),
  z.strictObject({ ...base, type: z.literal("store/eudic-import-step") }),
  z.strictObject({
    ...base,
    states: z.array(exportOutboxStateSchema).max(5).optional(),
    type: z.literal("store/outbox-list"),
  }),
  z.strictObject({ ...base, outboxId: id, type: z.literal("store/outbox-retry") }),
  z.strictObject({ ...base, type: z.literal("store/outbox-process-one") }),
  z.strictObject({ ...base, type: z.literal("store/shanbay-page-ready") }),
  z.strictObject({
    ...base,
    batchToken: id,
    confirmedOutboxIds: z.array(id).max(100),
    failedOutboxIds: z.array(id).max(100),
    type: z.literal("store/shanbay-resolve"),
  }),
]);
export type StoreWordbookRequest = z.infer<typeof storeWordbookRequestSchema>;

export const storeWordbookErrorCodeSchema = z.enum([
  "authentication-failed",
  "concurrent-modification",
  "consent-required",
  "credential-missing",
  "data-corrupt",
  "internal-error",
  "invalid-request",
  "invalid-response",
  "network-error",
  "rate-limited",
  "recipient-disabled",
  "timeout",
]);
export type StoreWordbookErrorCode = z.infer<typeof storeWordbookErrorCodeSchema>;

export const storeWordbookResponseSchema = z.discriminatedUnion("type", [
  z.strictObject({
    ...base,
    job: eudicImportJobSchema,
    type: z.literal("store/eudic-import-result"),
  }),
  z.strictObject({
    ...base,
    items: z.array(exportOutboxItemSchema).max(20_000),
    type: z.literal("store/outbox-result"),
  }),
  z.strictObject({
    ...base,
    processed: z.boolean(),
    type: z.literal("store/outbox-process-result"),
  }),
  z.strictObject({
    ...base,
    retried: z.boolean(),
    type: z.literal("store/outbox-retry-result"),
  }),
  z.strictObject({
    ...base,
    batch: shanbayBatchSchema.nullable(),
    type: z.literal("store/shanbay-batch"),
  }),
  z.strictObject({
    ...base,
    accepted: z.boolean(),
    type: z.literal("store/shanbay-resolved"),
  }),
  z.strictObject({
    ...base,
    code: storeWordbookErrorCodeSchema,
    type: z.literal("store/wordbook-error"),
  }),
]);
export type StoreWordbookResponse = z.infer<typeof storeWordbookResponseSchema>;

export function parseStoreWordbookRequest(value: unknown): StoreWordbookRequest {
  return storeWordbookRequestSchema.parse(value);
}

export function parseStoreWordbookResponse(value: unknown): StoreWordbookResponse {
  return storeWordbookResponseSchema.parse(value);
}
