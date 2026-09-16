import { z } from "zod/v3";
import { backfillHeadwordSchema } from "@huayi/store-domain";
import {
  shanbayBackfillStatusSchema,
  shanbayBackfillUnresolvedSchema,
} from "@huayi/cloud-contracts";

const alias = z.string().uuid();
const scope = { expectedScope: z.string().min(1).max(200) };
const page = z
  .object({
    batchAlias: alias,
    items: z
      .array(z.strictObject({ alias, headword: backfillHeadwordSchema }))
      .min(1)
      .max(100),
  })
  .strict();
export const backfillMessageSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("store/backfill-status") }),
  z.strictObject({ type: z.literal("store/backfill-initialize") }),
  z.strictObject({
    type: z.literal("store/backfill-enable"),
    ...scope,
    enabled: z.boolean(),
    shareLocal: z.boolean(),
  }),
  z.strictObject({ type: z.literal("store/backfill-check"), ...scope }),
  z.strictObject({
    type: z.literal("store/backfill-open"),
    ...scope,
    view: z.literal("review").optional(),
  }),
  z.strictObject({
    type: z.literal("store/backfill-unresolved"),
    ...scope,
    cursor: z.string().max(202).optional(),
  }),
  z.strictObject({
    type: z.literal("store/backfill-replace"),
    ...scope,
    source: backfillHeadwordSchema,
    target: backfillHeadwordSchema,
    revision: z.number().int().nonnegative(),
  }),
  z.strictObject({
    type: z.literal("store/backfill-discard"),
    ...scope,
    source: backfillHeadwordSchema,
    revision: z.number().int().nonnegative(),
  }),
  z.strictObject({
    type: z.literal("store/backfill-retry-unknown"),
    ...scope,
    token: z.string().max(200),
  }),
  z.strictObject({ type: z.literal("store/backfill-page-review"), cursorAlias: alias.optional() }),
  z.strictObject({ type: z.literal("store/backfill-page-review-discard-all") }),
  z.strictObject({
    type: z.literal("store/backfill-page-review-replace"),
    sourceAlias: alias,
    target: backfillHeadwordSchema,
  }),
  z.strictObject({ type: z.literal("store/backfill-page-review-discard"), sourceAlias: alias }),
  z.strictObject({
    type: z.literal("store/backfill-page-review-retry-unknown"),
    batchAlias: alias,
  }),
  z.strictObject({
    type: z.literal("store/backfill-page-review-discard-unknown"),
    batchAlias: alias,
  }),
  z.strictObject({ type: z.literal("store/backfill-page-ready") }),
  z.strictObject({ type: z.literal("store/backfill-renew"), batchAlias: alias }),
  z.strictObject({ type: z.literal("store/backfill-unknown"), batchAlias: alias }),
  z.strictObject({
    type: z.literal("store/backfill-resolve"),
    batchAlias: alias,
    confirmedAliases: z.array(alias).max(100),
    rejectedAliases: z.array(alias).max(100),
  }),
]);
export const backfillViewSchema = z.strictObject({
  initializing: z.boolean().default(false),
  checking: z.boolean().default(false),
  status: shanbayBackfillStatusSchema,
  shared: z.boolean(),
  needsLocalMerge: z.boolean(),
  localMergeBlocked: z.boolean().default(false),
  reconnectRequired: z.boolean().default(false),
  checkError: z.string().max(300).nullable(),
  incomplete: z.boolean(),
  lastCheckedAt: z.string().datetime({ offset: true }).nullable(),
});
export const backfillPageResponseSchema = z.strictObject({
  accepted: z.boolean(),
  batch: page.nullable(),
  review: z.boolean().optional(),
});
export { shanbayBackfillUnresolvedSchema };
export type BackfillMessage = z.infer<typeof backfillMessageSchema>;
export type BackfillView = z.infer<typeof backfillViewSchema>;
export type BackfillPageBatch = z.infer<typeof page>;

export const backfillPageReviewResponseSchema = z.strictObject({
  accepted: z.literal(true),
  pendingCount: z.number().int().nonnegative(),
  unresolvedCount: z.number().int().nonnegative(),
  unknownCount: z.number().int().nonnegative(),
  items: z
    .array(
      z.strictObject({
        alias,
        headword: backfillHeadwordSchema,
        target: backfillHeadwordSchema,
        explanation: z.string().max(300).default(""),
        candidates: z.array(backfillHeadwordSchema).max(3).default([]),
      }),
    )
    .max(100),
  unknownBatches: z
    .array(z.strictObject({ alias, headwords: z.array(backfillHeadwordSchema).max(100) }))
    .max(100),
  nextCursorAlias: alias.nullable(),
});
export type BackfillPageReviewResponse = z.infer<typeof backfillPageReviewResponseSchema>;

export const backfillPageReviewMutationResponseSchema = z.strictObject({
  accepted: z.literal(true),
  update: z.number().int().nonnegative(),
  pendingCount: z.number().int().nonnegative(),
  unresolvedCount: z.number().int().nonnegative(),
  unknownCount: z.number().int().nonnegative(),
});
