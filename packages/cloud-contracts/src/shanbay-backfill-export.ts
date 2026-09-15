import { z } from "zod/v3";
import {
  backfillSourceSchema,
  backfillTargetSchema,
  backfillBatchSchema,
} from "@huayi/learning-domain";

export const shanbayBackfillExportRecordSchema = z.union([
  z.strictObject({
    recordType: z.literal("shanbay-backfill-settings"),
    enabled: z.boolean(),
    dailyHour: z.number().int().min(0).max(23),
    revision: z.number().int().nonnegative(),
    lastCheckedAt: z.string().datetime({ offset: true }).nullable(),
  }),
  z.strictObject({
    recordType: z.literal("shanbay-backfill-source"),
    source: backfillSourceSchema,
  }),
  z.strictObject({
    recordType: z.literal("shanbay-backfill-target"),
    target: backfillTargetSchema,
  }),
  z.strictObject({
    recordType: z.literal("shanbay-backfill-batch"),
    batch: backfillBatchSchema.omit({ holder: true, token: true }),
  }),
]);
