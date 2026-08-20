import { describe, expect, it } from "vitest";

import {
  adminAccessResponseSchema,
  adminAuditEventListResponseSchema,
  adminHttpRoutes,
  adminUsageSummarySchema,
  adminUserListResponseSchema,
  adminWriteHeadersSchema,
  createAdminInvitationRequestSchema,
  createdInvitationResponseSchema,
  listAdminAuditEventsQuerySchema,
  listAdminUsersQuerySchema,
  setAdminKillSwitchRequestSchema,
} from "./index.js";

const now = "2026-08-13T00:00:00.000Z";
const end = "2026-09-01T00:00:00.000Z";

describe("admin operations contracts", () => {
  it("defines fixed routes and strict white-listed account projections", () => {
    expect(adminHttpRoutes).toEqual({
      access: "/v1/admin/access",
      auditEvents: "/v1/admin/audit-events",
      invitations: "/v1/admin/invitations",
      invitation: "/v1/admin/invitations/:id",
      killSwitch: "/v1/admin/runtime/model-kill-switch",
      usage: "/v1/admin/usage",
      userDevices: "/v1/admin/users/:id/devices/revoke",
      userQuota: "/v1/admin/users/:id/quota",
      userStatus: "/v1/admin/users/:id/status",
      users: "/v1/admin/users",
    });
    expect(adminAccessResponseSchema.parse({ role: "operator" })).toEqual({ role: "operator" });
    const list = adminUserListResponseSchema.parse({
      items: [
        {
          createdAt: now,
          deviceCount: 2,
          email: "learner@example.com",
          id: "user-1",
          quota: {
            availableMicroUsd: 700,
            limitMicroUsd: 1_000,
            percentUsed: 20,
            periodEnd: end,
            periodStart: now,
            reservedMicroUsd: 100,
            usedMicroUsd: 200,
            warning: "available",
          },
          status: "active",
        },
      ],
      nextCursor: null,
    });
    expect(list.items[0]?.email).toBe("learner@example.com");
    expect(() =>
      adminUserListResponseSchema.parse({
        ...list,
        items: [{ ...list.items[0], sourceText: "private learning content" }],
      }),
    ).toThrow();
    expect(
      listAdminUsersQuerySchema.parse({ limit: "20", query: "100%_USER", status: "active" }),
    ).toMatchObject({ limit: 20, query: "100%_user", status: "active" });
  });

  it("keeps audit, usage, and write contracts strict and secret-free", () => {
    expect(
      adminAuditEventListResponseSchema.parse({
        items: [
          {
            action: "devices.revoked",
            actorUserId: "operator-1",
            createdAt: now,
            id: "audit-1",
            safeDetails: { revokedCount: 2 },
            subjectId: "user-1",
          },
        ],
        nextCursor: null,
      }).items[0]?.safeDetails,
    ).toEqual({ revokedCount: 2 });
    expect(
      adminUsageSummarySchema.parse({
        accounts: { active: 2, deleting: 0, disabled: 1, total: 3 },
        analysisRequests: {
          failed: 1,
          p95LatencyMs: 850,
          repairRatePercent: 25,
          repaired: 1,
          succeeded: 3,
          successRatePercent: 75,
          terminal: 4,
        },
        killSwitch: { enabled: false, updatedAt: now },
        periodEnd: end,
        periodStart: now,
        quota: {
          availableMicroUsd: 1_500,
          limitMicroUsd: 3_000,
          reservedMicroUsd: 500,
          usedMicroUsd: 1_000,
        },
        usageCalls: { failed: 1, succeeded: 4 },
      }).accounts.total,
    ).toBe(3);
    expect(listAdminAuditEventsQuerySchema.parse({ action: "user.disabled", limit: "10" })).toEqual(
      { action: "user.disabled", limit: 10 },
    );
    expect(adminWriteHeadersSchema.parse({ "idempotency-key": "write-1" })).toBeTruthy();
    expect(createAdminInvitationRequestSchema.parse({ expiresInHours: 48 })).toEqual({
      expiresInHours: 48,
    });
    expect(setAdminKillSwitchRequestSchema.parse({ enabled: true })).toEqual({ enabled: true });
    expect(
      createdInvitationResponseSchema.parse({
        consumedAt: null,
        createdAt: now,
        expiresAt: "2026-08-16T00:00:00.000Z",
        id: "invitation-1",
        invitationPath: `/join#${"i".repeat(43)}`,
        revokedAt: null,
      }).invitationPath,
    ).not.toContain("token=");
    expect(() =>
      setAdminKillSwitchRequestSchema.parse({ enabled: true, actorUserId: "x" }),
    ).toThrow();
  });
});
