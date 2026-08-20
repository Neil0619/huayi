import {
  adminAuditEventSchema,
  adminKillSwitchResourceSchema,
  adminUserQuotaResponseSchema,
  adminUserResourceSchema,
  adminUserStatusResponseSchema,
  invitationResourceSchema,
  revokedAdminInvitationResponseSchema,
  revokedAdminUserDevicesResponseSchema,
  type AdminAuditEvent,
  type AdminUserResource,
  type InvitationResource,
} from "@huayi/cloud-contracts";

import type { AdminAuthorization, AdminOperationsRepository } from "./admin-operations-module.js";
import type { AnalysisDatabase } from "./analysis-database.js";
import { CloudFault } from "./cloud-fault.js";
import {
  currentUtcPeriod,
  integer,
  iso,
  page,
  payloadFor,
  quota,
  requireRecent,
  translateAdminError,
  usageSummary,
  type UsageRow,
  type UserRow,
} from "./postgres-admin-operations-support.js";
import { hashSecret } from "./security.js";

const IDEMPOTENCY_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;

export function createPostgresAdminOperations(options: {
  database: AnalysisDatabase;
  id(): string;
  now(): Date;
  pepper: string;
}): AdminOperationsRepository {
  const authorized = async <T>(
    authorization: AdminAuthorization,
    operation: (now: Date) => Promise<T>,
  ): Promise<T> => {
    const now = options.now();
    requireRecent(authorization, now);
    try {
      return await operation(now);
    } catch (error) {
      return translateAdminError(error);
    }
  };

  return {
    async access(authorization) {
      return authorized(authorization, async () => {
        const rows = await options.database.trusted((database) =>
          database.rows<{ role: string | null }>("SELECT require_admin_operator($1) AS role", [
            authorization.actorUserId,
          ]),
        );
        if (rows[0]?.role !== "operator") {
          throw new CloudFault("forbidden", "Operator permission is required.");
        }
      });
    },
    async execute(authorization, command) {
      return authorized(authorization, async (now) => {
        const operation = `admin.${
          command.type === "create-invitation"
            ? "invitation-create"
            : command.type === "revoke-invitation"
              ? "invitation-revoke"
              : command.type === "set-user-status"
                ? "user-status"
                : command.type === "revoke-user-devices"
                  ? "devices-revoke"
                  : command.type === "set-user-quota"
                    ? "quota-set"
                    : "kill-switch-set"
        }`;
        const targetId = "id" in command ? command.id : null;
        const payload = payloadFor(command);
        const tokenHash =
          command.type === "create-invitation" ? hashSecret(command.token, options.pepper) : null;
        const rows = await options.database.trusted((query) =>
          query.rows<{ response: unknown }>(
            "SELECT admin_execute($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11) AS response",
            [
              authorization.actorUserId,
              operation,
              command.idempotencyKey,
              command.requestHash,
              targetId,
              JSON.stringify(payload),
              tokenHash,
              now,
              new Date(now.getTime() + IDEMPOTENCY_RETENTION_MS),
              options.id(),
              options.id(),
            ],
          ),
        );
        const response = rows[0]?.response as Record<string, unknown> | undefined;
        if (command.type === "create-invitation") {
          return invitationResourceSchema.parse(
            response === undefined
              ? response
              : {
                  ...response,
                  createdAt: iso(String(response.createdAt)),
                  expiresAt: iso(String(response.expiresAt)),
                  consumedAt:
                    response.consumedAt === null ? null : iso(String(response.consumedAt)),
                  revokedAt: response.revokedAt === null ? null : iso(String(response.revokedAt)),
                },
          );
        }
        if (command.type === "revoke-invitation")
          return revokedAdminInvitationResponseSchema.parse(response);
        if (command.type === "set-user-status")
          return adminUserStatusResponseSchema.parse(response);
        if (command.type === "revoke-user-devices")
          return revokedAdminUserDevicesResponseSchema.parse(response);
        if (command.type === "set-user-quota") {
          const quotaResponse = response?.quota as Record<string, unknown> | undefined;
          return adminUserQuotaResponseSchema.parse(
            quotaResponse === undefined
              ? response
              : {
                  ...response,
                  quota: {
                    ...quotaResponse,
                    periodEnd: iso(String(quotaResponse.periodEnd)),
                    periodStart: iso(String(quotaResponse.periodStart)),
                  },
                },
          );
        }
        return adminKillSwitchResourceSchema.parse(
          response === undefined
            ? response
            : { ...response, updatedAt: iso(String(response.updatedAt)) },
        );
      });
    },

    async listAuditEvents(authorization, query) {
      return authorized(authorization, async () => {
        const rows = await options.database.trusted((database) =>
          database.rows<{
            action: string;
            actor_id: string;
            created_at: Date | string;
            id: string;
            safe_details: unknown;
            subject_id: string;
          }>("SELECT * FROM admin_list_audit_events($1,$2,$3,$4,$5)", [
            authorization.actorUserId,
            query.action ?? null,
            query.boundary?.createdAt ?? null,
            query.boundary?.id ?? null,
            query.limit + 1,
          ]),
        );
        const items = rows.map((row) =>
          adminAuditEventSchema.parse({
            action: row.action,
            actorUserId: row.actor_id,
            createdAt: iso(row.created_at),
            id: row.id,
            safeDetails: row.safe_details,
            subjectId: row.subject_id,
          }),
        );
        return page<AdminAuditEvent>(items, query.limit);
      });
    },

    async listInvitations(authorization, query) {
      return authorized(authorization, async () => {
        const rows = await options.database.trusted((database) =>
          database.rows<{
            consumed_at: Date | string | null;
            created_at: Date | string;
            expires_at: Date | string;
            id: string;
            revoked_at: Date | string | null;
          }>("SELECT * FROM admin_list_invitations($1,$2,$3,$4)", [
            authorization.actorUserId,
            query.boundary?.createdAt ?? null,
            query.boundary?.id ?? null,
            query.limit + 1,
          ]),
        );
        const items = rows.map((row) =>
          invitationResourceSchema.parse({
            consumedAt: row.consumed_at === null ? null : iso(row.consumed_at),
            createdAt: iso(row.created_at),
            expiresAt: iso(row.expires_at),
            id: row.id,
            revokedAt: row.revoked_at === null ? null : iso(row.revoked_at),
          }),
        );
        return page<InvitationResource>(items, query.limit);
      });
    },

    async listUsers(authorization, query) {
      return authorized(authorization, async (now) => {
        const range = currentUtcPeriod(now);
        const rows = await options.database.trusted((database) =>
          database.rows<UserRow>("SELECT * FROM admin_list_users($1,$2,$3,$4,$5,$6,$7,$8)", [
            authorization.actorUserId,
            query.query ?? null,
            query.status ?? null,
            query.boundary?.createdAt ?? null,
            query.boundary?.id ?? null,
            query.limit + 1,
            range.start,
            range.end,
          ]),
        );
        const items = rows.map((row) =>
          adminUserResourceSchema.parse({
            createdAt: iso(row.created_at),
            deviceCount: integer(row.device_count),
            email: row.email,
            id: row.id,
            quota: quota(row, range),
            status: row.status,
          }),
        );
        return page<AdminUserResource>(items, query.limit);
      });
    },

    async usage(authorization) {
      return authorized(authorization, async (now) => {
        const range = currentUtcPeriod(now);
        const rows = await options.database.trusted((database) =>
          database.rows<UsageRow>("SELECT * FROM admin_usage_summary($1,$2,$3)", [
            authorization.actorUserId,
            range.start,
            range.end,
          ]),
        );
        return usageSummary(rows[0], range);
      });
    },
  };
}
