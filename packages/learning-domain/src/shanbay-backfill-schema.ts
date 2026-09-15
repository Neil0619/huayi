import { z } from "zod/v3";
import { normalizeHeadword } from "./normalization.js";

export const backfillHeadwordSchema = z
  .string()
  .min(1)
  .max(200)
  .transform(normalizeHeadword)
  .pipe(z.string().regex(/^[a-z]+(?:['-][a-z]+)*$/u));
export const backfillOriginSchema = z.enum(["eudic", "local", "cloud"]);
export const backfillSourceSchema = z.strictObject({
  headword: backfillHeadwordSchema,
  target: backfillHeadwordSchema,
  origins: z.array(backfillOriginSchema).min(1).max(3),
  attempt: z.enum(["original", "lemma", "manual"]),
  state: z.enum(["pending", "confirmed", "unresolved", "discarded"]),
  updatedAt: z.string().datetime({ offset: true }),
});
export const backfillTargetSchema = z.strictObject({
  headword: backfillHeadwordSchema,
  confirmedAt: z.string().datetime({ offset: true }).nullable(),
});
export const backfillBatchSchema = z.strictObject({
  token: z.string().min(1).max(200),
  holder: z.string().min(1).max(200),
  headwords: z.array(backfillHeadwordSchema).min(1).max(20),
  state: z.enum(["prepared", "unknown", "resolved"]),
  expiresAt: z.string().datetime({ offset: true }),
});
export const backfillStateSchema = z.strictObject({
  sources: z.record(backfillSourceSchema),
  targets: z.record(backfillTargetSchema),
  batches: z.array(backfillBatchSchema),
});
export type BackfillState = z.infer<typeof backfillStateSchema>;
export type BackfillSource = z.infer<typeof backfillSourceSchema>;
export type BackfillBatch = z.infer<typeof backfillBatchSchema>;
export type BackfillOrigin = z.infer<typeof backfillOriginSchema>;
