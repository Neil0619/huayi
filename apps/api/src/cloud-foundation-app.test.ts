import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  extensionSessionListResponseSchema,
  extensionSessionResourceSchema,
  quotaSummarySchema,
} from "@huayi/cloud-contracts";

import { createAccountQuotaApp } from "./account-quota-app.js";
import { createCloudFoundationApp } from "./cloud-foundation-app.js";
import { CloudFault } from "./cloud-fault.js";
import { createIdentityModule } from "./identity-module.js";
import { createQuotaModule } from "./quota-module.js";
import { createInMemoryRateLimiter, type RateLimiter } from "./rate-limiter.js";

import { DeterministicSecrets, MutableClock } from "./test-support/security-fakes.js";
import { createFoundationAuthProvider } from "./test-support/foundation-auth-provider.js";

const origin = "https://app.huayi.example";

function foundation(rateLimiter?: RateLimiter) {
  const clock = new MutableClock("2026-08-12T00:00:00.000Z");
  const identity = createIdentityModule({
    clock,
    pepper: "test-pepper-at-least-32-characters",
    secrets: new DeterministicSecrets(),
    webOrigin: origin,
  });
  const auth = createFoundationAuthProvider();
  vi.spyOn(auth, "beginGoogle");
  vi.spyOn(auth, "registerPassword");
  const quota = createQuotaModule({ clock });
  const app = createCloudFoundationApp({
    apiOrigin: "https://api.huayi.example",
    auth,
    extensionOrigin: `chrome-extension://${"a".repeat(32)}`,
    identity,
    passwordLink: identity.passwordLink,
    googleLink: identity.googleLink,
    protectRefreshToken: (token) => `protected:${token}`,
    protectTransientAuthState: (state) => state,
    rateLimiter: rateLimiter ?? createInMemoryRateLimiter(clock),
    unprotectRefreshToken: (token) => token.replace(/^protected:/u, ""),
    unprotectTransientAuthState: (state) => state,
    webOrigin: origin,
  });
  app.route(
    "/",
    createAccountQuotaApp({
      async authenticate(context) {
        const sessionId = context.req
          .header("cookie")
          ?.match(/(?:^|;\s*)huayi_session=([^;]+)/u)?.[1];
        if (sessionId === undefined) {
          throw new CloudFault("authentication_required", "Web session proof is required.");
        }
        return (await identity.authenticateWebSession(sessionId)).userId;
      },
      quota,
    }),
  );
  return {
    app,
    auth,
    identity,
    quota,
  };
}

describe("Cloud foundation HTTP adapter", () => {
  it("allows only reviewed Web and Extension origins to preflight the client version header", async () => {
    const { app } = foundation();
    const request = (requestOrigin: string) =>
      app.request("/v1/analyses:stream", {
        headers: {
          "access-control-request-headers": "authorization,x-huayi-client-version",
          "access-control-request-method": "POST",
          origin: requestOrigin,
        },
        method: "OPTIONS",
      });
    const extensionOrigin = `chrome-extension://${"a".repeat(32)}`;
    const accepted = await request(extensionOrigin);
    expect(accepted.status).toBe(204);
    expect(accepted.headers.get("access-control-allow-origin")).toBe(extensionOrigin);
    expect(accepted.headers.get("access-control-allow-headers")).toContain(
      "X-Huayi-Client-Version",
    );
    expect(accepted.headers.get("access-control-allow-headers")).toContain("Authorization");
    expect(
      (await request(`chrome-extension://${"b".repeat(32)}`)).headers.get(
        "access-control-allow-origin",
      ),
    ).toBeNull();

    const patch = await app.request("/v1/learning-items/item-1", {
      headers: {
        "access-control-request-headers": "content-type,idempotency-key,if-match,x-csrf-token",
        "access-control-request-method": "PATCH",
        origin,
      },
      method: "OPTIONS",
    });
    expect(patch.status).toBe(204);
    expect(patch.headers.get("access-control-allow-origin")).toBe(origin);
    expect(patch.headers.get("access-control-allow-methods")).toContain("PATCH");
    expect(patch.headers.get("access-control-expose-headers")).toContain("Content-Disposition");
  });

  it("returns only the authenticated Web account's strict quota projection", async () => {
    const { app, identity, quota } = foundation();
    identity.createProfile("user-a", undefined, ["password"]);
    quota.grant({ limitMicroUsd: 1_000_000, source: "default", userId: "user-a" });
    const session = identity.createWebSession("user-a", "protected-refresh");

    const unauthenticated = await app.request("/v1/quota", {
      headers: { authorization: "HuayiExtension extension-token" },
    });
    expect(unauthenticated.status).toBe(401);

    const response = await app.request("/v1/quota", {
      headers: { cookie: `huayi_session=${session.sessionId}` },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(quotaSummarySchema.parse(await response.json())).toMatchObject({
      availableMicroUsd: 1_000_000,
      limitMicroUsd: 1_000_000,
      warning: "available",
    });
  });
  it("validates invitation and registration payloads before binding Auth identity", async () => {
    const { app, auth, identity } = foundation();
    const invitation = identity.createInvitation("admin-1", 72);
    const claimResponse = await app.request("/v1/invitations/claim", {
      body: JSON.stringify({ invitationToken: invitation.token }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(claimResponse.status).toBe(200);
    const claim = (await claimResponse.json()) as { claimTicket: string };

    const registration = await app.request("/v1/auth/password/register", {
      body: JSON.stringify({
        claimTicket: claim.claimTicket,
        email: "learner@example.com",
        password: "correct horse battery staple",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(registration.status).toBe(202);
    expect(registration.headers.get("cache-control")).toBe("private, no-store");
    expect(await registration.json()).toEqual({ emailConfirmationRequired: true });
    expect(
      identity.finalizeInvitation(
        claim.claimTicket,
        "auth-user-a",
        "learner@example.com",
        "password",
      ),
    ).toEqual({ userId: "auth-user-a" });
    expect(auth.registerPassword).toHaveBeenCalledOnce();
    expect(JSON.stringify(vi.mocked(auth.registerPassword).mock.calls)).not.toContain(
      claim.claimTicket,
    );

    const unknownField = await app.request("/v1/invitations/claim", {
      body: JSON.stringify({ invitationToken: invitation.token, userId: "attacker" }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(unknownField.status).toBe(400);
  });

  it("rate-limits password registration before an invalid claim can reach Auth", async () => {
    const { app, auth } = foundation();
    const request = () =>
      app.request("/v1/auth/password/register", {
        body: JSON.stringify({
          claimTicket: "x".repeat(32),
          email: "learner@example.com",
          password: "correct horse battery staple",
        }),
        headers: { "content-type": "application/json", "x-forwarded-for": "198.51.100.8" },
        method: "POST",
      });

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await request();
      expect(response.status).toBe(400);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
    }
    expect((await request()).status).toBe(429);
    expect(auth.registerPassword).not.toHaveBeenCalled();
  });

  it("starts Google Auth from a body so the claim ticket never enters a request URL", async () => {
    const { app, auth, identity } = foundation();
    const invitation = identity.createInvitation("admin-1", 72);
    const claim = identity.claimInvitation(invitation.token);
    const start = await app.request("/v1/auth/google/start", {
      body: JSON.stringify({ claimTicket: claim.claimTicket }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });

    expect(start.status).toBe(302);
    expect(start.headers.get("location")).toBe("https://accounts.google.test");
    expect(start.headers.get("cache-control")).toBe("private, no-store");
    const call = vi.mocked(auth.beginGoogle).mock.calls[0]?.[0];
    expect(call?.redirectTo).not.toContain(claim.claimTicket);

    const unknownField = await app.request("/v1/auth/google/start", {
      body: JSON.stringify({ claimTicket: claim.claimTicket, redirectTo: "https://attacker.test" }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(unknownField.status).toBe(400);
  });

  it("starts Google Auth from one strict native form field without changing JSON semantics", async () => {
    const { app, auth, identity } = foundation();
    const invitation = identity.createInvitation("admin-1", 72);
    const claim = identity.claimInvitation(invitation.token);
    const form = new URLSearchParams({ claimTicket: claim.claimTicket });
    const start = await app.request("/v1/auth/google/start", {
      body: form.toString(),
      headers: { "content-type": "application/x-www-form-urlencoded" },
      method: "POST",
    });

    expect(start.status).toBe(302);
    expect(start.headers.get("location")).toBe("https://accounts.google.test");
    expect(JSON.stringify(vi.mocked(auth.beginGoogle).mock.calls)).not.toContain(claim.claimTicket);

    const invalidBodies = [
      "",
      "claimTicket=short",
      `claimTicket=${claim.claimTicket}&extra=value`,
      `claimTicket=${claim.claimTicket}&claimTicket=${claim.claimTicket}`,
      `claimTicket=${"x".repeat(2_049)}`,
    ];
    for (const body of invalidBodies) {
      const response = await app.request("/v1/auth/google/start", {
        body,
        headers: { "content-type": "application/x-www-form-urlencoded; charset=UTF-8" },
        method: "POST",
      });
      expect(response.status).toBe(400);
    }
    expect(
      (
        await app.request("/v1/auth/google/start", {
          body: claim.claimTicket,
          headers: { "content-type": "text/plain" },
          method: "POST",
        })
      ).status,
    ).toBe(400);
  });

  it("sets a hardened server session and requires Origin plus CSRF for logout", async () => {
    const { app, identity } = foundation();
    identity.createProfile("auth-user-a", undefined, ["password"]);
    const invalidLogin = await app.request("/v1/auth/password/login", {
      body: JSON.stringify({ email: "learner@example.com", password: "short" }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(invalidLogin.status).toBe(400);
    expect(invalidLogin.headers.get("cache-control")).toBe("private, no-store");
    const login = await app.request("/v1/auth/password/login", {
      body: JSON.stringify({
        email: "learner@example.com",
        password: "correct horse battery staple",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(login.status).toBe(200);
    expect(login.headers.get("cache-control")).toBe("private, no-store");
    expect(login.headers.get("set-cookie")).toContain("HttpOnly; Secure; SameSite=Lax; Path=/");
    await login.json();
    const cookie = login.headers.get("set-cookie")?.split(";", 1)[0] ?? "";

    const csrfBootstrap = await app.request("/v1/auth/csrf", {
      headers: { cookie, origin },
    });
    expect(csrfBootstrap.status).toBe(200);
    expect(csrfBootstrap.headers.get("access-control-allow-origin")).toBe(origin);
    expect(csrfBootstrap.headers.get("access-control-allow-credentials")).toBe("true");
    expect(csrfBootstrap.headers.get("vary")).toContain("Origin");
    expect(csrfBootstrap.headers.get("cache-control")).toBe("private, no-store");
    const rotated = (await csrfBootstrap.json()) as { csrfToken: string };

    const rejected = await app.request("/v1/auth/logout", {
      headers: { cookie, origin: "https://evil.example", "x-csrf-token": rotated.csrfToken },
      method: "POST",
    });
    expect(rejected.status).toBe(403);
    const logout = await app.request("/v1/auth/logout", {
      headers: { cookie, origin, "x-csrf-token": rotated.csrfToken },
      method: "POST",
    });
    expect(logout.status).toBe(204);
  });

  it("creates and exchanges a PKCE pairing once through strict routes", async () => {
    const { app, identity } = foundation();
    identity.createProfile("auth-user-a", undefined, ["password"]);
    const web = identity.createWebSession("auth-user-a", "refresh-ciphertext");
    const verifier = "a".repeat(43);
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const create = await app.request("/v1/extension-pairings", {
      body: JSON.stringify({
        installIdHash: "i".repeat(32),
        pkceChallenge: challenge,
        state: "s".repeat(32),
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    const pairing = (await create.json()) as { id: string };
    expect(create.status).toBe(201);
    const cookie = `huayi_session=${web.sessionId}`;
    const approved = await app.request(`/v1/extension-pairings/${pairing.id}/approve`, {
      body: JSON.stringify({
        cloudWordCopyMode: "enabled",
        deviceLabel: "Work Mac",
        expectedPreferencesRevision: 1,
        extensionQueryModelMode: "byok",
        studyCaptureMode: "manual",
      }),
      headers: {
        "content-type": "application/json",
        cookie,
        origin,
        "x-csrf-token": web.csrfToken,
      },
      method: "POST",
    });
    expect(approved.status).toBe(204);
    const exchange = () =>
      app.request(`/v1/extension-pairings/${pairing.id}/exchange`, {
        body: JSON.stringify({ pkceVerifier: verifier, state: "s".repeat(32) }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
    const exchanged = await exchange();
    expect(exchanged.status).toBe(200);
    await expect(exchanged.json()).resolves.toMatchObject({
      preferences: {
        cloudWordCopyMode: "enabled",
        extensionQueryModelMode: "byok",
        revision: 2,
        studyCaptureMode: "manual",
      },
    });
    expect((await exchange()).status).toBe(403);
    expect((await app.request(`/v1/extension-pairings/${pairing.id}`)).status).toBe(404);

    const listed = await app.request("/v1/extension-sessions", { headers: { cookie } });
    expect(listed.status).toBe(200);
    const sessions = extensionSessionListResponseSchema.parse(await listed.json());
    expect(sessions.items).toHaveLength(1);
    expect(() => extensionSessionResourceSchema.parse(sessions.items[0])).not.toThrow();
    identity.createProfile("auth-user-b", undefined, ["password"]);
    const otherWeb = identity.createWebSession("auth-user-b", "refresh-ciphertext");
    const crossAccount = await app.request(`/v1/extension-sessions/${sessions.items[0]?.id}`, {
      headers: {
        cookie: `huayi_session=${otherWeb.sessionId}`,
        origin,
        "x-csrf-token": otherWeb.csrfToken,
      },
      method: "DELETE",
    });
    expect(crossAccount.status).toBe(404);
    await expect(
      (await app.request("/v1/extension-sessions", { headers: { cookie } })).json(),
    ).resolves.toEqual(sessions);
    const revoked = await app.request(`/v1/extension-sessions/${sessions.items[0]?.id}`, {
      headers: { cookie, origin, "x-csrf-token": web.csrfToken },
      method: "DELETE",
    });
    expect(revoked.status).toBe(204);
    await expect(
      (await app.request("/v1/extension-sessions", { headers: { cookie } })).json(),
    ).resolves.toEqual({ items: [] });
  });

  it("rejects a rate-limited invitation claim", async () => {
    const { app, identity } = foundation({ consume: vi.fn().mockReturnValue(false) });
    const invitation = identity.createInvitation("admin-1", 72);
    const response = await app.request("/v1/invitations/claim", {
      body: JSON.stringify({ invitationToken: invitation.token }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(response.status).toBe(429);
  });
});
