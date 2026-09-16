import { z } from "zod/v3";
import {
  backfillHeadwordSchema,
  backfillOriginSchema,
  backfillSourceSchema,
} from "@huayi/learning-domain";

const time = z.string().datetime({ offset: true });
const token = z.string().min(1).max(200);
const words = z.array(backfillHeadwordSchema).max(100);
export const shanbayBackfillCommandSchema = z.discriminatedUnion("action", [
  z.strictObject({
    action: z.literal("settings"),
    enabled: z.boolean(),
    dailyHour: z.number().int().min(0).max(23),
    expectedRevision: z.number().int().nonnegative(),
  }),
  z.strictObject({ action: z.literal("discover"), origin: backfillOriginSchema, headwords: words }),
  z.strictObject({ action: z.literal("reconcile"), cursor: z.string().uuid().nullable() }),
  z.strictObject({
    action: z.literal("adopt"),
    sources: z.array(backfillSourceSchema).max(100),
    confirmed: words,
    unknown: words.optional(),
  }),
  z.strictObject({
    action: z.literal("claim"),
    limit: z.number().int().min(1).max(100).optional(),
  }),
  z.strictObject({ action: z.literal("renew"), token }),
  z.strictObject({ action: z.literal("resolve"), token, confirmed: words, rejected: words }),
  z.strictObject({ action: z.literal("unknown"), token }),
  z.strictObject({ action: z.literal("retry-unknown"), token }),
  z.strictObject({
    action: z.literal("replace"),
    source: backfillHeadwordSchema,
    target: backfillHeadwordSchema,
    expectedRevision: z.number().int().nonnegative(),
  }),
  z.strictObject({
    action: z.literal("discard"),
    source: backfillHeadwordSchema,
    expectedRevision: z.number().int().nonnegative(),
  }),
]);
export const shanbayBackfillStatusSchema = z.strictObject({
  enabled: z.boolean(),
  dailyHour: z.number().int().min(0).max(23),
  revision: z.number().int().nonnegative(),
  scopeId: z.string().min(1).max(200),
  pendingCount: z.number().int().nonnegative(),
  unresolvedCount: z.number().int().nonnegative(),
  unknownCount: z.number().int().nonnegative(),
  lastCheckedAt: time.nullable(),
});
export const shanbayBackfillLeaseSchema = z.strictObject({
  token,
  headwords: z.array(backfillHeadwordSchema).min(1).max(100),
  expiresAt: time,
});
export const shanbayBackfillResponseSchema = z.strictObject({
  status: shanbayBackfillStatusSchema,
  accepted: z.boolean(),
  batch: shanbayBackfillLeaseSchema.nullable(),
  nextCursor: z.string().uuid().nullable(),
});
export const shanbayBackfillUnresolvedSchema = z.strictObject({
  items: z.array(backfillSourceSchema).max(100),
  unknownBatches: z.array(z.strictObject({ token, headwords: words })).max(100),
  nextCursor: z.string().max(202).nullable(),
  revision: z.number().int().nonnegative(),
});
export type ShanbayBackfillCommand = z.infer<typeof shanbayBackfillCommandSchema>;
export type ShanbayBackfillStatus = z.infer<typeof shanbayBackfillStatusSchema>;
export type ShanbayBackfillResponse = z.infer<typeof shanbayBackfillResponseSchema>;
export type ShanbayBackfillLease = z.infer<typeof shanbayBackfillLeaseSchema>;
export type ShanbayBackfillUnresolved = z.infer<typeof shanbayBackfillUnresolvedSchema>;
export const shanbayBackfillRoutes = {
  status: "/v1/shanbay-backfill/status",
  command: "/v1/shanbay-backfill",
  unresolved: "/v1/shanbay-backfill/unresolved",
} as const;
