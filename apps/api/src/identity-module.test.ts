import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { CloudFault } from "./cloud-fault.js";
import { createIdentityModule } from "./identity-module.js";
import { DeterministicSecrets, MutableClock } from "./test-support/security-fakes.js";

const origin = "https://app.huayi.example";
const pairingApproval = {
  cloudWordCopyMode: "enabled" as const,
  deviceLabel: "Work Mac",
  expectedPreferencesRevision: 1,
  extensionQueryModelMode: "byok" as const,
  studyCaptureMode: "manual" as const,
};

describe("identity module", () => {
  it("records only the invitation registration method and authorizes only registered login", () => {
    const module = createIdentityModule({
      clock: new MutableClock("2026-08-12T00:00:00.000Z"),
      pepper: "test-pepper-at-least-32-characters",
      secrets: new DeterministicSecrets(),
      webOrigin: origin,
    });
    const invitation = module.createInvitation("admin-1", 72);
    const claim = module.claimInvitation(invitation.token);
    module.bindInvitationIdentity(claim.claimTicket, "password-user");

    module.finalizeInvitation(
      claim.claimTicket,
      "password-user",
      "password@example.com",
      "password",
    );

    expect(module.listSignInMethods("password-user")).toEqual([
      { linkedAt: new Date("2026-08-12T00:00:00.000Z"), method: "password" },
    ]);
    expect(module.authorizeSignInMethod("password-user", "password")).toEqual({
      userId: "password-user",
    });
    expect(() => module.authorizeSignInMethod("password-user", "google")).toThrowError(
      expect.objectContaining({ code: "authentication_required" }),
    );
  });

  it("records Google registration but rejects ordinary Google login without a registered method", () => {
    const module = createIdentityModule({
      clock: new MutableClock("2026-08-12T00:00:00.000Z"),
      pepper: "test-pepper-at-least-32-characters",
      secrets: new DeterministicSecrets(),
      webOrigin: origin,
    });
    const invitation = module.createInvitation("admin-1", 72);
    const claim = module.claimInvitation(invitation.token);
    const registration = module.createAuthFlow(claim.claimTicket);

    module.completeAuthFlow(registration.flowId, "google-user", "google@example.com", "google");
    expect(module.listSignInMethods("google-user")).toEqual([
      { linkedAt: new Date("2026-08-12T00:00:00.000Z"), method: "google" },
    ]);

    module.createProfile("password-only", "same@example.com", ["password"]);
    const login = module.createLoginAuthFlow();
    expect(() =>
      module.completeAuthFlow(login.flowId, "password-only", "same@example.com", "google"),
    ).toThrowError(expect.objectContaining({ code: "authentication_required" }));
  });

  it("does not use an invitation to log into an existing profile or add a method", () => {
    const module = createIdentityModule({
      clock: new MutableClock("2026-08-12T00:00:00.000Z"),
      pepper: "test-pepper-at-least-32-characters",
      secrets: new DeterministicSecrets(),
      webOrigin: origin,
    });
    module.createProfile("existing-user", "existing@example.com", ["password"]);
    const invitation = module.createInvitation("admin-1", 72);
    const claim = module.claimInvitation(invitation.token);
    module.bindInvitationIdentity(claim.claimTicket, "existing-user");

    expect(() =>
      module.finalizeInvitation(
        claim.claimTicket,
        "existing-user",
        "existing@example.com",
        "google",
      ),
    ).toThrowError(expect.objectContaining({ code: "invitation_invalid" }));
    expect(module.listSignInMethods("existing-user")).toEqual([
      { linkedAt: new Date("2026-08-12T00:00:00.000Z"), method: "password" },
    ]);
  });

  it("allows only one concurrent invitation claim and finalizes idempotently", async () => {
    const clock = new MutableClock("2026-08-12T00:00:00.000Z");
    const module = createIdentityModule({
      clock,
      pepper: "test-pepper-at-least-32-characters",
      secrets: new DeterministicSecrets(),
      webOrigin: origin,
    });
    const invitation = module.createInvitation("admin-1", 72);

    const claims = await Promise.allSettled([
      Promise.resolve().then(() => module.claimInvitation(invitation.token)),
      Promise.resolve().then(() => module.claimInvitation(invitation.token)),
    ]);
    const fulfilled = claims.filter((claim) => claim.status === "fulfilled");
    const rejected = claims.filter((claim) => claim.status === "rejected");

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    const ticket = fulfilled[0]?.status === "fulfilled" ? fulfilled[0].value.claimTicket : "";
    module.bindInvitationIdentity(ticket, "user-a");
    expect(module.finalizeInvitation(ticket, "user-a", "user-a@example.com", "password")).toEqual({
      userId: "user-a",
    });
    expect(module.finalizeInvitation(ticket, "user-a", "user-a@example.com", "password")).toEqual({
      userId: "user-a",
    });
    expect(() =>
      module.finalizeInvitation(ticket, "user-b", "user-b@example.com", "password"),
    ).toThrow(CloudFault);
  });

  it("requires finalization to use the Auth identity bound to the claim", () => {
    const module = createIdentityModule({
      clock: new MutableClock("2026-08-12T00:00:00.000Z"),
      pepper: "test-pepper-at-least-32-characters",
      secrets: new DeterministicSecrets(),
      webOrigin: origin,
    });
    const invitation = module.createInvitation("admin-1", 72);
    const claim = module.claimInvitation(invitation.token);
    module.bindInvitationIdentity(claim.claimTicket, "auth-user-a");

    expect(() =>
      module.finalizeInvitation(claim.claimTicket, "auth-user-b", "user-b@example.com", "password"),
    ).toThrowError(expect.objectContaining({ code: "invitation_invalid" }));
    expect(() => module.bindInvitationIdentity(claim.claimTicket, "auth-user-b")).toThrowError(
      expect.objectContaining({ code: "invitation_consumed" }),
    );
  });

  it("exchanges a short-lived auth flow ID for the claim ticket only once", () => {
    const module = createIdentityModule({
      clock: new MutableClock("2026-08-12T00:00:00.000Z"),
      pepper: "test-pepper-at-least-32-characters",
      secrets: new DeterministicSecrets(),
      webOrigin: origin,
    });
    const invitation = module.createInvitation("admin-1", 72);
    const claim = module.claimInvitation(invitation.token);
    const flow = module.createAuthFlow(claim.claimTicket);

    expect(flow.flowId).not.toBe(claim.claimTicket);
    expect(module.consumeAuthFlow(flow.flowId)).toBe(claim.claimTicket);
    expect(() => module.consumeAuthFlow(flow.flowId)).toThrowError(
      expect.objectContaining({ code: "authentication_required" }),
    );
  });

  it("completes an auth flow without exposing its claim ticket to the callback", () => {
    const module = createIdentityModule({
      clock: new MutableClock("2026-08-12T00:00:00.000Z"),
      pepper: "test-pepper-at-least-32-characters",
      secrets: new DeterministicSecrets(),
      webOrigin: origin,
    });
    const invitation = module.createInvitation("admin-1", 72);
    const claim = module.claimInvitation(invitation.token);
    const flow = module.createAuthFlow(claim.claimTicket);

    expect(
      module.completeAuthFlow(flow.flowId, "auth-user-a", "user-a@example.com", "google"),
    ).toEqual({ userId: "auth-user-a" });
    expect(() =>
      module.completeAuthFlow(flow.flowId, "auth-user-a", "user-a@example.com", "google"),
    ).toThrowError(expect.objectContaining({ code: "authentication_required" }));
  });

  it("issues hardened cookies, checks origin plus CSRF, rotates, and revokes sessions", () => {
    const module = createIdentityModule({
      clock: new MutableClock("2026-08-12T00:00:00.000Z"),
      pepper: "test-pepper-at-least-32-characters",
      secrets: new DeterministicSecrets(),
      webOrigin: origin,
    });
    module.createProfile("user-a", undefined, ["password"]);
    const session = module.createWebSession("user-a", "encrypted-refresh-token");

    expect(session.setCookie).toContain("HttpOnly; Secure; SameSite=Lax; Path=/");
    expect(() =>
      module.authenticateWebMutation(session.sessionId, "https://evil.example", session.csrfToken),
    ).toThrowError(expect.objectContaining({ code: "forbidden" }));
    expect(() => module.authenticateWebMutation(session.sessionId, origin, "wrong-token")).toThrow(
      CloudFault,
    );
    expect(module.authenticateWebMutation(session.sessionId, origin, session.csrfToken)).toEqual({
      reauthenticatedAt: new Date("2026-08-12T00:00:00.000Z"),
      userId: "user-a",
    });

    const rotated = module.rotateWebSession(session.sessionId);
    expect(rotated.sessionId).not.toBe(session.sessionId);
    expect(() => module.authenticateWebSession(session.sessionId)).toThrow(CloudFault);
    module.revokeWebSession(rotated.sessionId);
    expect(() => module.authenticateWebSession(rotated.sessionId)).toThrow(CloudFault);
  });

  it("rotates a password-reauthenticated session only for the same registered owner", () => {
    const clock = new MutableClock("2026-08-12T00:00:00.000Z");
    const module = createIdentityModule({
      clock,
      pepper: "test-pepper-at-least-32-characters",
      secrets: new DeterministicSecrets(),
      webOrigin: origin,
    });
    module.createProfile("user-a", "Learner@Example.COM", ["password"]);
    const current = module.createWebSession("user-a", "old-refresh-ciphertext");
    expect(() => module.requireRecentAuthentication(current.sessionId, "password")).toThrowError(
      expect.objectContaining({ code: "authentication_required" }),
    );

    expect(
      module.preparePasswordReauthentication(current.sessionId, origin, current.csrfToken),
    ).toEqual({ email: "learner@example.com", userId: "user-a" });
    clock.advance(60_000);
    const rotated = module.completePasswordReauthentication(
      current.sessionId,
      "user-a",
      "new-refresh-ciphertext",
    );

    expect(rotated).toMatchObject({ access: "full" });
    expect(rotated.sessionId).not.toBe(current.sessionId);
    expect(rotated.csrfToken).not.toBe(current.csrfToken);
    expect(() => module.authenticateWebSession(current.sessionId)).toThrowError(
      expect.objectContaining({ code: "authentication_required" }),
    );
    expect(module.authenticateWebSession(rotated.sessionId)).toEqual({
      reauthenticatedAt: new Date("2026-08-12T00:01:00.000Z"),
      userId: "user-a",
    });
    expect(module.requireRecentAuthentication(rotated.sessionId, "password")).toEqual({
      userId: "user-a",
    });
    expect(() => module.requireRecentAuthentication(rotated.sessionId, "google")).toThrowError(
      expect.objectContaining({ code: "authentication_required" }),
    );
    clock.advance(15 * 60 * 1_000 + 1);
    expect(() => module.requireRecentAuthentication(rotated.sessionId, "password")).toThrowError(
      expect.objectContaining({ code: "authentication_required" }),
    );

    const unchanged = module.createWebSession("user-a", "unchanged-refresh-ciphertext");
    expect(() =>
      module.completePasswordReauthentication(
        unchanged.sessionId,
        "different-provider-user",
        "untrusted-refresh-ciphertext",
      ),
    ).toThrowError(expect.objectContaining({ code: "authentication_required" }));
    expect(module.authenticateWebSession(unchanged.sessionId)).toMatchObject({ userId: "user-a" });
  });

  it("uses state + PKCE and permits only one pairing exchange", async () => {
    const module = createIdentityModule({
      clock: new MutableClock("2026-08-12T00:00:00.000Z"),
      pepper: "test-pepper-at-least-32-characters",
      secrets: new DeterministicSecrets(),
      webOrigin: origin,
    });
    module.createProfile("user-a", undefined, ["password"]);
    const verifier = "a".repeat(43);
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const pairing = module.createExtensionPairing({
      installIdHash: "i".repeat(32),
      pkceChallenge: challenge,
      state: "s".repeat(32),
    });
    module.approveExtensionPairing(pairing.id, "user-a", pairingApproval);

    const exchanges = await Promise.allSettled([
      Promise.resolve().then(() =>
        module.exchangeExtensionPairing(pairing.id, "s".repeat(32), verifier),
      ),
      Promise.resolve().then(() =>
        module.exchangeExtensionPairing(pairing.id, "s".repeat(32), verifier),
      ),
    ]);
    expect(exchanges.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(exchanges.filter((result) => result.status === "rejected")).toHaveLength(1);
    const token = exchanges.find((result) => result.status === "fulfilled");
    if (token?.status !== "fulfilled") throw new Error("Expected one successful exchange.");
    expect(token.value.preferences).toMatchObject({
      extensionQueryModelMode: "byok",
      revision: 2,
    });
    expect(module.authenticateExtension(token.value.sessionToken)).toEqual({ userId: "user-a" });
    module.revokeExtensionSession("user-a", token.value.sessionId);
    expect(() => module.authenticateExtension(token.value.sessionToken)).toThrow(CloudFault);
  });

  it("rejects disabled business sessions but issues a data-rights-only Web session", () => {
    const module = createIdentityModule({
      clock: new MutableClock("2026-08-12T00:00:00.000Z"),
      pepper: "test-pepper-at-least-32-characters",
      secrets: new DeterministicSecrets(),
      webOrigin: origin,
    });
    module.createProfile("user-a", undefined, ["password"]);
    const session = module.createWebSession("user-a", "ciphertext");
    const verifier = "a".repeat(43);
    const pairing = module.createExtensionPairing({
      installIdHash: "i".repeat(32),
      pkceChallenge: createHash("sha256").update(verifier).digest("base64url"),
      state: "s".repeat(32),
    });
    module.approveExtensionPairing(pairing.id, "user-a", pairingApproval);
    const extension = module.exchangeExtensionPairing(pairing.id, "s".repeat(32), verifier);
    module.setAccountStatus("user-a", "disabled");

    expect(() => module.authenticateWebSession(session.sessionId)).toThrowError(
      expect.objectContaining({ code: "authentication_required" }),
    );
    expect(() => module.authenticateExtension(extension.sessionToken)).toThrowError(
      expect.objectContaining({ code: "authentication_required" }),
    );
    const rights = module.createWebSession("user-a", "new-refresh-ciphertext");
    expect(rights.access).toBe("data-rights");
    expect(() => module.authenticateWebSession(rights.sessionId)).toThrowError(
      expect.objectContaining({ code: "authentication_required" }),
    );
    expect(
      module.authenticateDataRightsMutation(rights.sessionId, origin, rights.csrfToken),
    ).toMatchObject({ access: "data-rights", userId: "user-a" });
  });

  it("cannot approve an expired pairing", () => {
    const clock = new MutableClock("2026-08-12T00:00:00.000Z");
    const module = createIdentityModule({
      clock,
      pepper: "test-pepper-at-least-32-characters",
      secrets: new DeterministicSecrets(),
      webOrigin: origin,
    });
    module.createProfile("user-a", undefined, ["password"]);
    const pairing = module.createExtensionPairing({
      installIdHash: "i".repeat(32),
      pkceChallenge: "p".repeat(43),
      state: "s".repeat(32),
    });
    clock.advance(10 * 60 * 1_000 + 1);

    expect(() =>
      module.approveExtensionPairing(pairing.id, "user-a", {
        ...pairingApproval,
        deviceLabel: "Expired",
      }),
    ).toThrowError(expect.objectContaining({ code: "not_found" }));
  });
});
