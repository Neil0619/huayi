import { CloudFault } from "./cloud-fault.js";
import type { IdentityModule } from "./identity-module.js";
import type { QuotaModule } from "./quota-module.js";
import type { Clock } from "./security.js";

interface AdminAuthorization {
  actorUserId: string;
  reauthenticatedAt: Date;
}
type AuditEvent = Readonly<{
  action: string;
  actorUserId: string;
  createdAt: string;
  safeDetails: Readonly<Record<string, number | string>>;
  subjectId: string;
}>;

export function createAdminModule(dependencies: {
  clock: Clock;
  identity: IdentityModule;
  quota: QuotaModule;
}) {
  const roles = new Map<string, "operator">();
  const auditEvents: AuditEvent[] = [];

  function authorize(authorization: AdminAuthorization): void {
    const age = dependencies.clock.now().getTime() - authorization.reauthenticatedAt.getTime();
    if (roles.get(authorization.actorUserId) !== "operator" || age < 0 || age > 15 * 60 * 1_000) {
      throw new CloudFault("forbidden", "Recent administrator authentication is required.");
    }
  }

  function audit(
    authorization: AdminAuthorization,
    action: string,
    subjectId: string,
    safeDetails: Record<string, number | string> = {},
  ): void {
    authorize(authorization);
    auditEvents.push(
      Object.freeze({
        action,
        actorUserId: authorization.actorUserId,
        createdAt: dependencies.clock.now().toISOString(),
        safeDetails: Object.freeze({ ...safeDetails }),
        subjectId,
      }),
    );
  }

  function createInvitation(authorization: AdminAuthorization, expiresInHours = 72) {
    authorize(authorization);
    const invitation = dependencies.identity.createInvitation(
      authorization.actorUserId,
      expiresInHours,
    );
    audit(authorization, "invitation.created", invitation.id);
    return invitation;
  }

  function setQuota(
    authorization: AdminAuthorization,
    userId: string,
    limitMicroUsd: number,
    periodStart = dependencies.clock.now(),
  ): void {
    authorize(authorization);
    dependencies.quota.grant({ limitMicroUsd, periodStart, source: "admin", userId });
    audit(authorization, "quota.granted", userId, { limitMicroUsd });
  }

  function setUserStatus(
    authorization: AdminAuthorization,
    userId: string,
    status: "active" | "disabled",
  ): void {
    authorize(authorization);
    dependencies.identity.setAccountStatus(userId, status);
    audit(authorization, status === "active" ? "user.enabled" : "user.disabled", userId);
  }

  function revokeDevices(authorization: AdminAuthorization, userId: string): void {
    authorize(authorization);
    const revokedCount = dependencies.identity.revokeAllExtensionSessions(userId);
    audit(authorization, "devices.revoked", userId, { revokedCount });
  }

  return {
    bootstrap: Object.freeze({
      assignRole: (userId: string, role: "operator") => roles.set(userId, role),
    }),
    createInvitation,
    listAuditEvents: () => [...auditEvents],
    revokeDevices,
    setQuota,
    setUserStatus,
  };
}

export type AdminModule = ReturnType<typeof createAdminModule>;
