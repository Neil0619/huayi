import { z } from "zod/v3";

export const CLOUD_CONTRACT_VERSION = "v1" as const;
export const resourceIdSchema = z.string().trim().min(1).max(128);
export const revisionSchema = z.number().int().min(1);
export const idempotencyKeySchema = z.string().min(1).max(128);
export const cursorSchema = z.string().trim().min(1).max(2_048);
export const writeHeadersSchema = z.strictObject({
  "idempotency-key": idempotencyKeySchema,
});
export const revisionWriteHeadersSchema = z.strictObject({
  "idempotency-key": idempotencyKeySchema,
  "if-match": z.string().regex(/^"[1-9]\d*"$/u),
});

export const apiErrorCodeSchema = z.enum([
  "invalid_request",
  "authentication_required",
  "forbidden",
  "invitation_invalid",
  "invitation_expired",
  "invitation_consumed",
  "revision_conflict",
  "idempotency_conflict",
  "quota_exhausted",
  "rate_limited",
  "generation_busy",
  "model_unavailable",
  "model_output_invalid",
  "client_upgrade_required",
  "not_found",
]);
export const apiErrorDetailSchema = z.strictObject({
  code: apiErrorCodeSchema,
  message: z.string().trim().min(1).max(500),
  requestId: resourceIdSchema,
  retryAfterSeconds: z.number().int().positive().max(86_400).optional(),
});
export const apiErrorSchema = z.strictObject({ error: apiErrorDetailSchema });
export type ApiError = z.infer<typeof apiErrorSchema>;

const queryBooleanSchema = z.preprocess((value) => {
  if (value === "true") return true;
  if (value === "false") return false;
  return value;
}, z.boolean());
const queryLimitSchema = z.preprocess((value) => {
  if (typeof value === "string" && /^\d+$/u.test(value)) return Number(value);
  return value;
}, z.number().int().min(1).max(100));

export const paginationQueryFields = {
  cursor: cursorSchema.optional(),
  limit: queryLimitSchema.optional(),
};
export const queryBoolean = queryBooleanSchema;
export const listResponseSchema = z.strictObject({
  items: z.array(z.unknown()).max(100),
  nextCursor: cursorSchema.nullable(),
});
export function listOf<Item extends z.ZodTypeAny>(item: Item) {
  return z.strictObject({ items: z.array(item).max(100), nextCursor: cursorSchema.nullable() });
}

export const quotaSummarySchema = z
  .strictObject({
    availableMicroUsd: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    limitMicroUsd: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    percentUsed: z.number().min(0).max(100),
    periodEnd: z.string().datetime({ offset: true }),
    periodStart: z.string().datetime({ offset: true }),
    reservedMicroUsd: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    usedMicroUsd: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    warning: z.enum(["available", "warning", "exhausted"]),
  })
  .refine((quota) => Date.parse(quota.periodStart) < Date.parse(quota.periodEnd), {
    message: "Quota period must be ordered.",
  })
  .superRefine((quota, context) => {
    const committed = quota.usedMicroUsd + quota.reservedMicroUsd;
    const expectedAvailable = Math.max(0, quota.limitMicroUsd - committed);
    const expectedPercent =
      quota.limitMicroUsd === 0
        ? 100
        : Math.min(100, (quota.usedMicroUsd / quota.limitMicroUsd) * 100);
    const expectedWarning =
      committed >= quota.limitMicroUsd
        ? "exhausted"
        : expectedPercent >= 80
          ? "warning"
          : "available";
    if (
      !Number.isSafeInteger(committed) ||
      quota.availableMicroUsd !== expectedAvailable ||
      quota.percentUsed !== expectedPercent ||
      quota.warning !== expectedWarning
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Quota summary fields must describe one consistent allowance.",
      });
    }
  });
export type QuotaSummary = z.infer<typeof quotaSummarySchema>;
