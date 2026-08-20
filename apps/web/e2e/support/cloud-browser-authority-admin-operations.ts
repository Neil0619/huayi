import type { Request, Route } from "@playwright/test";
import {
  adminAccessResponseSchema,
  adminAuditEventListResponseSchema,
  adminAuditEventSchema,
  adminInvitationListResponseSchema,
  adminKillSwitchResourceSchema,
  adminUsageSummarySchema,
  adminUserListResponseSchema,
  adminUserResourceSchema,
  adminUserStatusResponseSchema,
  createAdminInvitationRequestSchema,
  createdInvitationResponseSchema,
  listAdminAuditEventsQuerySchema,
  listAdminInvitationsQuerySchema,
  listAdminUsersQuerySchema,
  setAdminKillSwitchRequestSchema,
  setAdminUserStatusRequestSchema,
  type AdminAuditEvent,
  type AdminUserResource,
  type ApiError,
  type InvitationResource,
} from "@huayi/cloud-contracts";

import { cloudQueryObject, cloudRequestBody } from "./cloud-browser-authority-request.js";
import type {
  CloudBrowserAuthenticatedAs,
  CloudBrowserRequestFact,
} from "./cloud-browser-authority-types.js";

const operatorId = "00000000-0000-0000-0000-000000000001";
const learnerId = "00000000-0000-0000-0000-000000000002";
const invitationId = "80000000-0000-0000-0000-000000000001";
const now = "2026-08-13T10:00:00.000Z";
const periodStart = "2026-08-01T00:00:00.000Z";
const periodEnd = "2026-09-01T00:00:00.000Z";

interface AdminAuthorityContext {
  readonly authentication: (request: Request) => CloudBrowserAuthenticatedAs;
  readonly json: (route: Route, status: number, body: unknown) => Promise<void>;
  readonly record: (request: Request, proof: CloudBrowserRequestFact["proof"]) => void;
  readonly reject: (
    route: Route,
    status: number,
    code: ApiError["error"]["code"],
    proof?: CloudBrowserRequestFact["proof"],
  ) => Promise<void>;
  readonly writeProof: (request: Request, revision?: number) => string | null;
}

function quota(limitMicroUsd: number) {
  return {
    availableMicroUsd: limitMicroUsd,
    limitMicroUsd,
    percentUsed: 0,
    periodEnd,
    periodStart,
    reservedMicroUsd: 0,
    usedMicroUsd: 0,
    warning: "available" as const,
  };
}

export function createCloudBrowserAdminOperationsAuthority(operator: boolean) {
  let learnerStatus: "active" | "disabled" = "active";
  let killSwitchEnabled = false;
  let invitation: InvitationResource | null = null;
  let audit: AdminAuditEvent[] = [];

  const users = (): AdminUserResource[] => [
    adminUserResourceSchema.parse({
      createdAt: "2026-08-01T00:00:00.000Z",
      deviceCount: 0,
      email: "operator@example.test",
      id: operatorId,
      quota: quota(1_000_000),
      status: "active",
    }),
    adminUserResourceSchema.parse({
      createdAt: "2026-08-02T00:00:00.000Z",
      deviceCount: learnerStatus === "active" ? 2 : 0,
      email: "learner@example.test",
      id: learnerId,
      quota: quota(1_000_000),
      status: learnerStatus,
    }),
  ];

  const addAudit = (
    action: AdminAuditEvent["action"],
    subjectId: string,
    safeDetails: AdminAuditEvent["safeDetails"],
  ) => {
    audit = [
      adminAuditEventSchema.parse({
        action,
        actorUserId: operatorId,
        createdAt: now,
        id: `90000000-0000-0000-0000-${String(audit.length + 1).padStart(12, "0")}`,
        safeDetails,
        subjectId,
      }),
      ...audit,
    ];
  };

  return {
    async handle(route: Route, context: AdminAuthorityContext): Promise<boolean> {
      const request = route.request();
      const url = new URL(request.url());
      if (!url.pathname.startsWith("/v1/admin/")) return false;
      if (context.authentication(request) !== "web") {
        await context.reject(route, 401, "authentication_required", "read");
        return true;
      }
      if (!operator) {
        await context.reject(route, 403, "forbidden", "read");
        return true;
      }

      if (url.pathname === "/v1/admin/access" && request.method() === "GET") {
        context.record(request, "read");
        await context.json(route, 200, adminAccessResponseSchema.parse({ role: "operator" }));
        return true;
      }
      if (url.pathname === "/v1/admin/usage" && request.method() === "GET") {
        const disabled = learnerStatus === "disabled" ? 1 : 0;
        context.record(request, "read");
        await context.json(
          route,
          200,
          adminUsageSummarySchema.parse({
            accounts: { active: 2 - disabled, deleting: 0, disabled, total: 2 },
            analysisRequests: {
              failed: 0,
              p95LatencyMs: 125,
              repaired: 0,
              repairRatePercent: 0,
              succeeded: 2,
              successRatePercent: 100,
              terminal: 2,
            },
            killSwitch: { enabled: killSwitchEnabled, updatedAt: now },
            periodEnd,
            periodStart,
            quota: {
              availableMicroUsd: 2_000_000,
              limitMicroUsd: 2_000_000,
              reservedMicroUsd: 0,
              usedMicroUsd: 0,
            },
            usageCalls: { failed: 0, succeeded: 2 },
          }),
        );
        return true;
      }
      if (url.pathname === "/v1/admin/users" && request.method() === "GET") {
        const parsed = listAdminUsersQuerySchema.safeParse(cloudQueryObject(url));
        if (!parsed.success) {
          await context.reject(route, 400, "invalid_request", "read");
          return true;
        }
        const items = users().filter(
          (user) =>
            (parsed.data.query === undefined || user.email.includes(parsed.data.query)) &&
            (parsed.data.status === undefined || user.status === parsed.data.status),
        );
        context.record(request, "read");
        await context.json(
          route,
          200,
          adminUserListResponseSchema.parse({ items, nextCursor: null }),
        );
        return true;
      }
      if (url.pathname === "/v1/admin/invitations" && request.method() === "GET") {
        const parsed = listAdminInvitationsQuerySchema.safeParse(cloudQueryObject(url));
        if (!parsed.success) {
          await context.reject(route, 400, "invalid_request", "read");
          return true;
        }
        context.record(request, "read");
        await context.json(
          route,
          200,
          adminInvitationListResponseSchema.parse({
            items: invitation === null ? [] : [invitation],
            nextCursor: null,
          }),
        );
        return true;
      }
      if (url.pathname === "/v1/admin/audit-events" && request.method() === "GET") {
        const parsed = listAdminAuditEventsQuerySchema.safeParse(cloudQueryObject(url));
        if (!parsed.success) {
          await context.reject(route, 400, "invalid_request", "read");
          return true;
        }
        const items = audit.filter(
          (event) => parsed.data.action === undefined || event.action === parsed.data.action,
        );
        context.record(request, "read");
        await context.json(
          route,
          200,
          adminAuditEventListResponseSchema.parse({ items, nextCursor: null }),
        );
        return true;
      }

      const userStatus = /^\/v1\/admin\/users\/([^/]+)\/status$/u.exec(url.pathname);
      if (userStatus?.[1] !== undefined && request.method() === "POST") {
        const parsed = setAdminUserStatusRequestSchema.safeParse(cloudRequestBody(request));
        if (!parsed.success || context.writeProof(request) === null) {
          await context.reject(
            route,
            parsed.success ? 403 : 400,
            parsed.success ? "forbidden" : "invalid_request",
          );
          return true;
        }
        if (decodeURIComponent(userStatus[1]) !== learnerId || parsed.data.action !== "disable") {
          await context.reject(route, 400, "invalid_request", "write-valid");
          return true;
        }
        learnerStatus = "disabled";
        addAudit("user.disabled", learnerId, {
          extensionSessions: 2,
          pairings: 0,
          webSessions: 1,
        });
        context.record(request, "write-valid");
        await context.json(
          route,
          200,
          adminUserStatusResponseSchema.parse({ id: learnerId, status: learnerStatus }),
        );
        return true;
      }
      if (url.pathname === "/v1/admin/invitations" && request.method() === "POST") {
        const parsed = createAdminInvitationRequestSchema.safeParse(cloudRequestBody(request));
        if (!parsed.success || context.writeProof(request) === null) {
          await context.reject(
            route,
            parsed.success ? 403 : 400,
            parsed.success ? "forbidden" : "invalid_request",
          );
          return true;
        }
        invitation = {
          consumedAt: null,
          createdAt: now,
          expiresAt: "2026-08-16T10:00:00.000Z",
          id: invitationId,
          revokedAt: null,
        };
        addAudit("invitation.created", invitationId, {
          expiresInHours: parsed.data.expiresInHours ?? 72,
        });
        context.record(request, "write-valid");
        await context.json(
          route,
          201,
          createdInvitationResponseSchema.parse({
            ...invitation,
            invitationPath: "/join#operator-invitation-token-00000001",
          }),
        );
        return true;
      }
      if (url.pathname === "/v1/admin/runtime/model-kill-switch" && request.method() === "PUT") {
        const parsed = setAdminKillSwitchRequestSchema.safeParse(cloudRequestBody(request));
        if (!parsed.success || context.writeProof(request) === null) {
          await context.reject(
            route,
            parsed.success ? 403 : 400,
            parsed.success ? "forbidden" : "invalid_request",
          );
          return true;
        }
        killSwitchEnabled = parsed.data.enabled;
        addAudit("model.kill-switch-set", operatorId, { enabled: killSwitchEnabled });
        context.record(request, "write-valid");
        await context.json(
          route,
          200,
          adminKillSwitchResourceSchema.parse({ enabled: killSwitchEnabled, updatedAt: now }),
        );
        return true;
      }

      await context.reject(
        route,
        404,
        "not_found",
        request.method() === "GET" ? "read" : "write-invalid",
      );
      return true;
    },
  };
}
