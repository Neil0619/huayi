import { describe, expect, it, vi } from "vitest";

import { createCloudFoundationApp } from "./cloud-foundation-app.js";
import { CloudFault } from "./cloud-fault.js";
import { createIdentityModule } from "./identity-module.js";
import { createInMemoryRateLimiter } from "./rate-limiter.js";
import { createFoundationAuthProvider } from "./test-support/foundation-auth-provider.js";
import { DeterministicSecrets, MutableClock } from "./test-support/security-fakes.js";

const apiOrigin = "https://api.huayi.example";
const webOrigin = "https://app.huayi.example";

function foundation() {
  const clock = new MutableClock("2026-08-12T00:00:00.000Z");
  const identity = createIdentityModule({
    clock,
    pepper: "test-pepper-at-least-32-characters",
    secrets: new DeterministicSecrets(),
    webOrigin,
  });
  const auth = createFoundationAuthProvider();
  vi.spyOn(auth, "registerPassword");
  vi.spyOn(auth, "verifyPasswordRegistrationOtp");
  const app = createCloudFoundationApp({
    apiOrigin,
    auth,
    extensionOrigin: `chrome-extension://${"a".repeat(32)}`,
    googleLink: identity.googleLink,
    googleAuthenticationEnabled: true,
    identity,
    passwordLink: identity.passwordLink,
    protectRefreshToken: (token) => `protected:${token}`,
    rateLimiter: createInMemoryRateLimiter(clock),
    unprotectRefreshToken: (token) => token.replace(/^protected:/u, ""),
    webOrigin,
  });
  return { app, auth, identity };
}

async function startRegistration() {
  const current = foundation();
  const invitation = current.identity.createInvitation("admin-1", 72);
  const claimResponse = await current.app.request("/v1/invitations/claim", {
    body: JSON.stringify({ invitationToken: invitation.token }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  const claim = (await claimResponse.json()) as { claimTicket: string };
  const registration = await current.app.request("/v1/auth/password/register", {
    body: JSON.stringify({
      claimTicket: claim.claimTicket,
      email: "learner@example.com",
      password: "correct horse battery staple",
    }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  expect(registration.status).toBe(202);
  const redirectTo = vi.mocked(current.auth.registerPassword).mock.calls[0]?.[0].redirectTo;
  const confirmation = new URL(redirectTo ?? "https://invalid.test");
  return { ...current, confirmation };
}

describe("Cloud foundation password signup confirmation", () => {
  it("renders an inert confirmation form without consuming the provider OTP", async () => {
    const { app, auth, confirmation } = await startRegistration();
    expect(confirmation.pathname).toBe("/v1/auth/password/confirm");
    expect(confirmation.searchParams.get("flow")).toMatch(/^[A-Za-z0-9_-]{43}$/u);

    const first = await app.request(`${confirmation.pathname}${confirmation.search}`);
    const repeated = await app.request(`${confirmation.pathname}${confirmation.search}`);
    expect(first.status).toBe(200);
    expect(repeated.status).toBe(200);
    expect(first.headers.get("cache-control")).toBe("private, no-store");
    expect(first.headers.get("referrer-policy")).toBe("no-referrer");
    expect(first.headers.get("content-security-policy")).toBe(
      `default-src 'none'; form-action 'self' ${webOrigin}; base-uri 'none'; frame-ancestors 'none'`,
    );
    expect(await first.text()).toContain('name="token"');
    expect(auth.verifyPasswordRegistrationOtp).not.toHaveBeenCalled();
  });

  it("uses an explicit six-digit OTP POST before completing the invitation", async () => {
    const { app, auth, confirmation, identity } = await startRegistration();
    const flow = confirmation.searchParams.get("flow") ?? "";
    const callback = await app.request("/v1/auth/password/callback", {
      body: new URLSearchParams({
        email: "learner@example.com",
        flow,
        token: "123456",
      }).toString(),
      headers: { "content-type": "application/x-www-form-urlencoded" },
      method: "POST",
    });

    expect(callback.status).toBe(302);
    expect(callback.headers.get("location")).toBe(`${webOrigin}/app`);
    expect(callback.headers.get("set-cookie")).toContain("HttpOnly; Secure; SameSite=Lax; Path=/");
    expect(auth.verifyPasswordRegistrationOtp).toHaveBeenCalledWith({
      email: "learner@example.com",
      token: "123456",
    });
    expect(identity.listSignInMethods("auth-user-a")).toEqual([
      expect.objectContaining({ method: "password" }),
    ]);
  });

  it("rejects duplicate, extra, malformed, and query OTP submissions", async () => {
    const { app, auth, confirmation } = await startRegistration();
    const flow = confirmation.searchParams.get("flow") ?? "";
    for (const request of [
      app.request(`/v1/auth/password/confirm?flow=${flow}&extra=1`),
      app.request("/v1/auth/password/callback?token=123456", {
        body: new URLSearchParams({ email: "learner@example.com", flow, token: "123456" }),
        headers: { "content-type": "application/x-www-form-urlencoded" },
        method: "POST",
      }),
      app.request("/v1/auth/password/callback", {
        body: `email=learner%40example.com&flow=${flow}&token=123456&token=654321`,
        headers: { "content-type": "application/x-www-form-urlencoded" },
        method: "POST",
      }),
      app.request("/v1/auth/password/callback", {
        body: JSON.stringify({ email: "learner@example.com", flow, token: "123456" }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
    ]) {
      expect((await request).status).toBe(400);
    }
    expect(auth.verifyPasswordRegistrationOtp).not.toHaveBeenCalled();
  });

  it("keeps a normalized provider failure human-retryable without exposing details", async () => {
    const { app, auth, confirmation } = await startRegistration();
    vi.mocked(auth.verifyPasswordRegistrationOtp).mockRejectedValueOnce(
      new CloudFault("authentication_required", "provider-secret-detail"),
    );
    const response = await app.request("/v1/auth/password/callback", {
      body: new URLSearchParams({
        email: "learner@example.com",
        flow: confirmation.searchParams.get("flow") ?? "",
        token: "123456",
      }),
      headers: { "content-type": "application/x-www-form-urlencoded" },
      method: "POST",
    });
    expect(response.status).toBe(400);
    expect(response.headers.get("set-cookie")).toBeNull();
    const html = await response.text();
    expect(html).toContain("验证未完成");
    expect(html).toContain('name="token"');
    expect(html).not.toContain("learner@example.com");
    expect(html).not.toContain("123456");
    expect(html).not.toContain("provider-secret-detail");
  });
});
