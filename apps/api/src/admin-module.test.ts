import { describe, expect, it } from "vitest";

import { createAdminModule } from "./admin-module.js";
import { createIdentityModule } from "./identity-module.js";
import { createQuotaModule } from "./quota-module.js";
import { DeterministicSecrets, MutableClock } from "./test-support/security-fakes.js";

describe("admin module", () => {
  it("requires an explicit role and recent reauthentication", () => {
    const clock = new MutableClock("2026-08-12T00:00:00.000Z");
    const identity = createIdentityModule({
      clock,
      pepper: "test-pepper-at-least-32-characters",
      secrets: new DeterministicSecrets(),
      webOrigin: "https://app.huayi.example",
    });
    const admin = createAdminModule({ clock, identity, quota: createQuotaModule({ clock }) });
    identity.createProfile("admin-1", undefined, ["password"]);

    expect(() =>
      admin.createInvitation({ actorUserId: "admin-1", reauthenticatedAt: clock.now() }),
    ).toThrowError(expect.objectContaining({ code: "forbidden" }));
    admin.bootstrap.assignRole("admin-1", "operator");
    clock.advance(16 * 60 * 1_000);
    expect(() =>
      admin.createInvitation({
        actorUserId: "admin-1",
        reauthenticatedAt: new Date("2026-08-12T00:00:00.000Z"),
      }),
    ).toThrowError(expect.objectContaining({ code: "forbidden" }));
  });

  it("audits invitation, quota, status, and device revocation without secrets or content", () => {
    const clock = new MutableClock("2026-08-12T00:00:00.000Z");
    const identity = createIdentityModule({
      clock,
      pepper: "test-pepper-at-least-32-characters",
      secrets: new DeterministicSecrets(),
      webOrigin: "https://app.huayi.example",
    });
    const quota = createQuotaModule({ clock });
    const admin = createAdminModule({ clock, identity, quota });
    identity.createProfile("admin-1", undefined, ["password"]);
    identity.createProfile("user-a", undefined, ["password"]);
    admin.bootstrap.assignRole("admin-1", "operator");
    const authorization = { actorUserId: "admin-1", reauthenticatedAt: clock.now() };

    const invitation = admin.createInvitation(authorization);
    admin.setQuota(authorization, "user-a", 50_000);
    admin.setUserStatus(authorization, "user-a", "disabled");
    admin.revokeDevices(authorization, "user-a");

    expect(invitation.token).toHaveLength(43);
    expect(admin.listAuditEvents()).toEqual([
      expect.objectContaining({ action: "invitation.created" }),
      expect.objectContaining({ action: "quota.granted", safeDetails: { limitMicroUsd: 50_000 } }),
      expect.objectContaining({ action: "user.disabled" }),
      expect.objectContaining({ action: "devices.revoked" }),
    ]);
    const serialized = JSON.stringify(admin.listAuditEvents());
    expect(serialized).not.toContain(invitation.token);
    expect(serialized).not.toMatch(/sourceText|cookie|csrf|sessionToken|email/iu);
  });
});
