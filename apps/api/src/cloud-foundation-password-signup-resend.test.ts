import { describe, expect, it, vi } from "vitest";

import { createCloudFoundationApp } from "./cloud-foundation-app.js";
import { createIdentityModule } from "./identity-module.js";
import { createInMemoryRateLimiter } from "./rate-limiter.js";
import { createFoundationAuthProvider } from "./test-support/foundation-auth-provider.js";
import { DeterministicSecrets, MutableClock } from "./test-support/security-fakes.js";

const apiOrigin = "https://api.huayi.example";
const webOrigin = "https://app.huayi.example";

function foundation() {
  const clock = new MutableClock("2026-08-24T00:00:00.000Z");
  const identity = createIdentityModule({
    clock,
    pepper: "test-pepper-at-least-32-characters",
    secrets: new DeterministicSecrets(),
    webOrigin,
  });
  const resendPasswordRegistrationOtp = vi.fn(async () => undefined);
  const auth = Object.assign(createFoundationAuthProvider(), {
    resendPasswordRegistrationOtp,
  });
  vi.spyOn(auth, "registerPassword");
  const app = createCloudFoundationApp({
    apiOrigin,
    auth,
    extensionOrigin: `chrome-extension://${"a".repeat(32)}`,
    googleAuthenticationEnabled: true,
    googleLink: identity.googleLink,
    identity,
    passwordLink: identity.passwordLink,
    protectRefreshToken: (token) => `protected:${token}`,
    rateLimiter: createInMemoryRateLimiter(clock),
    unprotectRefreshToken: (token) => token.replace(/^protected:/u, ""),
    webOrigin,
  });
  return { app, auth, clock, identity, resendPasswordRegistrationOtp };
}

async function createPendingRegistration() {
  const current = foundation();
  const invitation = current.identity.createInvitation("admin-1", 72);
  const claim = await current.app.request("/v1/invitations/claim", {
    body: JSON.stringify({ invitationToken: invitation.token }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  const { claimTicket } = (await claim.json()) as { claimTicket: string };
  const registration = await current.app.request("/v1/auth/password/register", {
    body: JSON.stringify({
      claimTicket,
      email: "learner@example.com",
      password: "correct horse battery staple",
    }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  expect(registration.status).toBe(202);
  return { ...current, invitation };
}

describe("Cloud foundation password signup OTP resend", () => {
  it("rotates the same bound invitation flow and resends signup confirmation", async () => {
    const current = await createPendingRegistration();
    const response = await current.app.request("/v1/auth/password/register/resend", {
      body: JSON.stringify({ invitationToken: current.invitation.token }),
      headers: { "content-type": "application/json", "x-vercel-forwarded-for": "198.51.100.8" },
      method: "POST",
    });

    expect(response.status).toBe(202);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(await response.json()).toEqual({ accepted: true });
    expect(current.resendPasswordRegistrationOtp).toHaveBeenCalledWith({
      email: "learner@example.com",
      redirectTo: expect.stringMatching(
        /^https:\/\/api\.huayi\.example\/v1\/auth\/password\/confirm\?flow=[A-Za-z0-9_-]{43}$/u,
      ),
    });
    expect(current.auth.registerPassword).not.toHaveBeenCalledTimes(2);
  });

  it("reactivates only the same expired bound invitation for one fresh confirmation window", async () => {
    const current = await createPendingRegistration();
    current.clock.advance(72 * 60 * 60 * 1_000 + 1);

    const response = await current.app.request("/v1/auth/password/register/resend", {
      body: JSON.stringify({ invitationToken: current.invitation.token }),
      headers: { "content-type": "application/json", "x-vercel-forwarded-for": "198.51.100.8" },
      method: "POST",
    });

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ accepted: true });
    expect(current.resendPasswordRegistrationOtp).toHaveBeenCalledTimes(1);
    expect(current.auth.registerPassword).toHaveBeenCalledTimes(1);

    const reclaim = await current.app.request("/v1/invitations/claim", {
      body: JSON.stringify({ invitationToken: current.invitation.token }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(reclaim.status).toBe(409);
  });

  it("keeps an expired-invitation recovery retryable after a Provider failure", async () => {
    const current = await createPendingRegistration();
    current.clock.advance(72 * 60 * 60 * 1_000 + 1);
    current.resendPasswordRegistrationOtp.mockRejectedValueOnce(new Error("provider detail"));
    const request = () =>
      current.app.request("/v1/auth/password/register/resend", {
        body: JSON.stringify({ invitationToken: current.invitation.token }),
        headers: {
          "content-type": "application/json",
          "x-vercel-forwarded-for": "198.51.100.10",
        },
        method: "POST",
      });

    expect((await request()).status).toBe(400);
    current.clock.advance(1);
    expect((await request()).status).toBe(202);
    expect(current.resendPasswordRegistrationOtp).toHaveBeenCalledTimes(2);
  });

  it("rejects an unrelated invitation without sending mail or setting a Cookie", async () => {
    const current = await createPendingRegistration();
    const other = current.identity.createInvitation("admin-1", 72);
    const response = await current.app.request("/v1/auth/password/register/resend", {
      body: JSON.stringify({ invitationToken: other.token }),
      headers: { "content-type": "application/json", "x-vercel-forwarded-for": "198.51.100.8" },
      method: "POST",
    });

    expect(response.status).toBe(401);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(current.resendPasswordRegistrationOtp).not.toHaveBeenCalled();
    expect(JSON.stringify(await response.json())).not.toContain(other.token);
  });

  it("rejects extra request fields before rotating or sending", async () => {
    const current = await createPendingRegistration();
    const response = await current.app.request("/v1/auth/password/register/resend", {
      body: JSON.stringify({
        email: "learner@example.com",
        invitationToken: current.invitation.token,
      }),
      headers: { "content-type": "application/json", "x-vercel-forwarded-for": "198.51.100.8" },
      method: "POST",
    });

    expect(response.status).toBe(400);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(current.resendPasswordRegistrationOtp).not.toHaveBeenCalled();
  });

  it("rate-limits the invitation before a fourth resend can rotate or send", async () => {
    const current = await createPendingRegistration();
    const request = () =>
      current.app.request("/v1/auth/password/register/resend", {
        body: JSON.stringify({ invitationToken: current.invitation.token }),
        headers: {
          "content-type": "application/json",
          "x-vercel-forwarded-for": "198.51.100.8",
        },
        method: "POST",
      });

    expect((await request()).status).toBe(202);
    expect((await request()).status).toBe(202);
    expect((await request()).status).toBe(202);
    expect((await request()).status).toBe(429);
    expect(current.resendPasswordRegistrationOtp).toHaveBeenCalledTimes(3);
  });

  it("keeps Provider failure cookie-free and allows the same invitation to retry", async () => {
    const current = await createPendingRegistration();
    current.resendPasswordRegistrationOtp.mockRejectedValueOnce(new Error("provider detail"));
    const request = () =>
      current.app.request("/v1/auth/password/register/resend", {
        body: JSON.stringify({ invitationToken: current.invitation.token }),
        headers: {
          "content-type": "application/json",
          "x-vercel-forwarded-for": "198.51.100.9",
        },
        method: "POST",
      });

    const failed = await request();
    expect(failed.status).toBe(400);
    expect(failed.headers.get("set-cookie")).toBeNull();
    expect(JSON.stringify(await failed.json())).not.toContain("provider detail");
    expect((await request()).status).toBe(202);
    expect(current.resendPasswordRegistrationOtp).toHaveBeenCalledTimes(2);
  });
});
