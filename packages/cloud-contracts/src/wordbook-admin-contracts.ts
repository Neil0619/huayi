import { z } from "zod/v3";

import { paginationQueryFields, resourceIdSchema } from "./common-contracts.js";

export const createWordbookJobRequestSchema = z
  .strictObject({
    direction: z.enum(["import", "export"]),
    target: z.enum(["eudic", "shanbay"]),
  })
  .refine((job) => job.target !== "shanbay" || job.direction === "export", {
    message: "Shanbay supports export only.",
  });
export const wordbookJobResourceSchema = z.strictObject({
  createdAt: z.string().datetime({ offset: true }),
  direction: z.enum(["import", "export"]),
  id: resourceIdSchema,
  processedCount: z.number().int().nonnegative(),
  revision: z.number().int().min(1),
  state: z.enum(["pending", "active", "completed", "failed", "cancelled"]),
  target: z.enum(["eudic", "shanbay"]),
  totalCount: z.number().int().nonnegative().nullable(),
  updatedAt: z.string().datetime({ offset: true }),
});
export const wordbookLeaseRequestSchema = z.strictObject({
  expectedRevision: z.number().int().min(1),
});
export const wordbookLeaseResponseSchema = z.strictObject({
  entries: z
    .array(
      z.strictObject({ headword: z.string().trim().min(1).max(200), itemId: resourceIdSchema }),
    )
    .max(20),
  expiresAt: z.string().datetime({ offset: true }),
  leaseToken: z.string().min(32).max(256),
});
export const submitWordbookReceiptsRequestSchema = z.strictObject({
  leaseToken: z.string().min(32).max(256),
  receipts: z
    .array(
      z.strictObject({
        itemId: resourceIdSchema,
        outcome: z.enum(["created", "already-exists", "confirmed", "failed"]),
        stableErrorCode: z.string().trim().min(1).max(100).optional(),
      }),
    )
    .min(1)
    .max(20),
});

export const listAdminInvitationsQuerySchema = z.strictObject({ ...paginationQueryFields });
export const createAdminInvitationRequestSchema = z.strictObject({
  expiresInHours: z.number().int().min(1).max(72).optional(),
});
export const invitationResourceSchema = z.strictObject({
  consumedAt: z.string().datetime({ offset: true }).nullable(),
  createdAt: z.string().datetime({ offset: true }),
  expiresAt: z.string().datetime({ offset: true }),
  id: resourceIdSchema,
  revokedAt: z.string().datetime({ offset: true }).nullable(),
});
export const createdInvitationResponseSchema = invitationResourceSchema.extend({
  invitationPath: z.string().regex(/^\/join\/[A-Za-z0-9_-]{32,}$/u),
});
export const setAdminUserStatusRequestSchema = z.strictObject({
  action: z.enum(["disable", "enable"]),
});
export const setAdminQuotaRequestSchema = z.strictObject({
  limitMicroUsd: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  periodStart: z.string().datetime({ offset: true }),
});
export const adminUserResourceSchema = z.strictObject({
  deviceCount: z.number().int().nonnegative(),
  email: z.string().email().max(320),
  limitMicroUsd: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  status: z.enum(["active", "disabled", "deleting"]),
  usedMicroUsd: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
});
