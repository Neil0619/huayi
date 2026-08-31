import { z } from "zod/v3";

import {
  listOf,
  paginationQueryFields,
  quotaSummarySchema,
  resourceIdSchema,
  writeHeadersSchema,
} from "./common-contracts.js";
import { accountEmailSchema } from "./account-contracts.js";

const instantSchema = z.string().datetime({ offset: true });
const safeIntegerSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const percentSchema = z.number().min(0).max(100).finite();

export const adminActionSchema = z.enum([
  "devices.revoked",
  "invitation.created",
  "invitation.revoked",
  "invitation.token-recovered",
  "model.kill-switch-set",
  "quota.granted",
  "user.disabled",
  "user.enabled",
]);
export type AdminAction = z.infer<typeof adminActionSchema>;

export const adminHttpRoutes = Object.freeze({
  access: "/v1/admin/access",
  auditEvents: "/v1/admin/audit-events",
  invitation: "/v1/admin/invitations/:id",
  invitationTokenRecovery: "/v1/admin/invitations/:id/token-recovery",
  invitations: "/v1/admin/invitations",
  killSwitch: "/v1/admin/runtime/model-kill-switch",
  usage: "/v1/admin/usage",
  userDevices: "/v1/admin/users/:id/devices/revoke",
  userQuota: "/v1/admin/users/:id/quota",
  userStatus: "/v1/admin/users/:id/status",
  users: "/v1/admin/users",
} as const);

export const adminAccessResponseSchema = z.strictObject({ role: z.literal("operator") });
export type AdminAccessResponse = z.infer<typeof adminAccessResponseSchema>;
export const adminWriteHeadersSchema = writeHeadersSchema;

export const invitationResourceSchema = z.strictObject({
  consumedAt: instantSchema.nullable(),
  createdAt: instantSchema,
  expiresAt: instantSchema,
  id: resourceIdSchema,
  revokedAt: instantSchema.nullable(),
});
export type InvitationResource = z.infer<typeof invitationResourceSchema>;
export const createdInvitationResponseSchema = invitationResourceSchema.extend({
  invitationPath: z.string().regex(/^\/join#[A-Za-z0-9_-]{32,}$/u),
});
export type CreatedInvitationResponse = z.infer<typeof createdInvitationResponseSchema>;
export const createAdminInvitationRequestSchema = z.strictObject({
  expiresInHours: z.number().int().min(1).max(72).optional(),
});
export const revokeAdminInvitationRequestSchema = z.strictObject({});
export const recoverAdminInvitationTokenRequestSchema = z.strictObject({});
export const recoveredAdminInvitationTokenResponseSchema = z.strictObject({
  id: resourceIdSchema,
  recovered: z.literal(true),
});
export const recoveredInvitationTokenResponseSchema =
  recoveredAdminInvitationTokenResponseSchema.extend({
    invitationPath: z.string().regex(/^\/join#[A-Za-z0-9_-]{43}$/u),
  });
export type RecoveredInvitationTokenResponse = z.infer<
  typeof recoveredInvitationTokenResponseSchema
>;
export const revokedAdminInvitationResponseSchema = z.strictObject({
  id: resourceIdSchema,
  revoked: z.literal(true),
});
export const listAdminInvitationsQuerySchema = z.strictObject({ ...paginationQueryFields });
export const adminInvitationListResponseSchema = listOf(invitationResourceSchema);
export type AdminInvitationListResponse = z.infer<typeof adminInvitationListResponseSchema>;

export const adminUserResourceSchema = z.strictObject({
  createdAt: instantSchema,
  deviceCount: safeIntegerSchema,
  email: accountEmailSchema,
  id: resourceIdSchema,
  quota: quotaSummarySchema,
  status: z.enum(["active", "disabled", "deleting"]),
});
export type AdminUserResource = z.infer<typeof adminUserResourceSchema>;
export const adminUserListResponseSchema = listOf(adminUserResourceSchema);
export type AdminUserListResponse = z.infer<typeof adminUserListResponseSchema>;
export const listAdminUsersQuerySchema = z.strictObject({
  ...paginationQueryFields,
  query: z
    .string()
    .trim()
    .min(1)
    .max(320)
    .transform((value) => value.toLowerCase())
    .optional(),
  status: z.enum(["active", "disabled", "deleting"]).optional(),
});
export const setAdminUserStatusRequestSchema = z.strictObject({
  action: z.enum(["disable", "enable"]),
});
export const adminUserStatusResponseSchema = z.strictObject({
  id: resourceIdSchema,
  status: z.enum(["active", "disabled"]),
});
export const revokeAdminUserDevicesRequestSchema = z.strictObject({});
export const revokedAdminUserDevicesResponseSchema = z.strictObject({
  revokedCount: safeIntegerSchema,
});
export const setAdminQuotaRequestSchema = z.strictObject({
  limitMicroUsd: safeIntegerSchema,
  periodStart: instantSchema,
});
export const adminUserQuotaResponseSchema = z.strictObject({
  id: resourceIdSchema,
  quota: quotaSummarySchema,
});

export const adminAuditEventSchema = z.strictObject({
  action: adminActionSchema,
  actorUserId: resourceIdSchema,
  createdAt: instantSchema,
  id: resourceIdSchema,
  safeDetails: z.record(z.union([z.boolean(), z.number().int(), z.string().max(128)])),
  subjectId: resourceIdSchema,
});
export type AdminAuditEvent = z.infer<typeof adminAuditEventSchema>;
export const adminAuditEventListResponseSchema = listOf(adminAuditEventSchema);
export type AdminAuditEventListResponse = z.infer<typeof adminAuditEventListResponseSchema>;
export const listAdminAuditEventsQuerySchema = z.strictObject({
  ...paginationQueryFields,
  action: adminActionSchema.optional(),
});

export const setAdminKillSwitchRequestSchema = z.strictObject({ enabled: z.boolean() });
export const adminKillSwitchResourceSchema = z.strictObject({
  enabled: z.boolean(),
  updatedAt: instantSchema,
});
export type AdminKillSwitchResource = z.infer<typeof adminKillSwitchResourceSchema>;

const accountCountsSchema = z
  .strictObject({
    active: safeIntegerSchema,
    deleting: safeIntegerSchema,
    disabled: safeIntegerSchema,
    total: safeIntegerSchema,
  })
  .refine((value) => value.total === value.active + value.disabled + value.deleting, {
    message: "Account status counts must equal total.",
  });
const aggregateQuotaSchema = z
  .strictObject({
    availableMicroUsd: safeIntegerSchema,
    limitMicroUsd: safeIntegerSchema,
    reservedMicroUsd: safeIntegerSchema,
    usedMicroUsd: safeIntegerSchema,
  })
  .refine(
    (value) =>
      value.availableMicroUsd ===
      Math.max(0, value.limitMicroUsd - value.usedMicroUsd - value.reservedMicroUsd),
    { message: "Aggregate quota fields must be consistent." },
  );
const analysisRequestMetricsSchema = z
  .strictObject({
    failed: safeIntegerSchema,
    p95LatencyMs: safeIntegerSchema,
    repaired: safeIntegerSchema,
    repairRatePercent: percentSchema,
    succeeded: safeIntegerSchema,
    successRatePercent: percentSchema,
    terminal: safeIntegerSchema,
  })
  .superRefine((value, context) => {
    const successRate = value.terminal === 0 ? 0 : (value.succeeded / value.terminal) * 100;
    const repairRate = value.terminal === 0 ? 0 : (value.repaired / value.terminal) * 100;
    if (
      value.terminal !== value.succeeded + value.failed ||
      value.repaired > value.terminal ||
      value.successRatePercent !== successRate ||
      value.repairRatePercent !== repairRate
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Analysis request metrics must be consistent.",
      });
    }
  });

export const adminUsageSummarySchema = z
  .strictObject({
    accounts: accountCountsSchema,
    analysisRequests: analysisRequestMetricsSchema,
    killSwitch: adminKillSwitchResourceSchema,
    periodEnd: instantSchema,
    periodStart: instantSchema,
    quota: aggregateQuotaSchema,
    usageCalls: z.strictObject({ failed: safeIntegerSchema, succeeded: safeIntegerSchema }),
  })
  .refine((value) => Date.parse(value.periodStart) < Date.parse(value.periodEnd), {
    message: "Usage period must be ordered.",
  });
export type AdminUsageSummary = z.infer<typeof adminUsageSummarySchema>;
