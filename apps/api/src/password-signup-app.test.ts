import { describe, expect, it, vi } from "vitest";

import { createCloudFoundationApp } from "./cloud-foundation-app.js";
import { CloudFault } from "./cloud-fault.js";
import { createIdentityModule } from "./identity-module.js";
import { createInMemoryRateLimiter } from "./rate-limiter.js";
import { createFoundationAuthProvider } from "./test-support/foundation-auth-provider.js";
import { DeterministicSecrets, MutableClock } from "./test-support/security-fakes.js";

const webOrigin = "https://app.huayi.example";
const email = "learner@example.com";
const password = "correct horse battery staple";
const base = "/v1/auth/password/signup";

async function fixture() {
  const clock = new MutableClock("2026-09-07T00:00:00Z");
  const identity = createIdentityModule({
    clock,
    pepper: "test-pepper-at-least-32-characters",
    secrets: new DeterministicSecrets(),
    webOrigin,
  });
  const auth = createFoundationAuthProvider();
  vi.spyOn(auth, "registerPassword");
  vi.spyOn(auth, "verifyPasswordRegistrationOtp").mockImplementation(async ({ token }) => {
    if (token !== "123456")
      throw new CloudFault("authentication_required", "private provider detail");
    return {
      authState: { private: "provider-session" },
      email,
      refreshToken: "refresh-token",
      userId: "auth-user-a",
    };
  });
  vi.spyOn(auth, "setPassword").mockResolvedValue({
    authState: { private: "updated-session" },
    userId: "auth-user-a",
  });
  vi.spyOn(auth, "resendPasswordRegistrationOtp");
  const app = createCloudFoundationApp({
    apiOrigin: "https://api.huayi.example",
    auth,
    googleAuthenticationEnabled: false,
    googleLink: identity.googleLink,
    identity,
    passwordLink: identity.passwordLink,
    protectRefreshToken: (value) => `protected:${value}`,
    unprotectRefreshToken: (value) => value.slice(10),
    protectTransientAuthState: (value) => `protected:${value}`,
    unprotectTransientAuthState: (value) => value.slice(10),
    rateLimiter: createInMemoryRateLimiter(clock),
    webOrigin,
  });
  const invitation = identity.createInvitation("admin", 72);
  const claim = identity.claimInvitation(invitation.token);
  const post = (path: string, body: unknown, cookie?: string, csrf?: string, origin = webOrigin) =>
    app.request(`${base}/${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin,
        ...(cookie ? { cookie } : {}),
        ...(csrf ? { "x-csrf-token": csrf } : {}),
      },
      body: JSON.stringify(body),
    });
  const start = await post("start", { claimTicket: claim.claimTicket, email });
  return { app, auth, clock, identity, invitation, post, start };
}

async function pending() {
  const f = await fixture();
  expect(f.start.status).toBe(202);
  const session = (await f.start.json()) as { csrfToken: string; email: string; step: string };
  const cookie = f.start.headers.get("set-cookie")?.split(";", 1)[0] ?? "";
  return { ...f, cookie, session };
}

describe("email-first password signup", () => {
  it("verifies email before setting a password or creating an application session", async () => {
    const f = await pending();
    expect(f.session).toMatchObject({ email, step: "verify-email" });
    expect(f.cookie).toMatch(/^huayi_signup=/u);
    expect(f.start.headers.get("set-cookie")).toContain("HttpOnly; Secure; SameSite=Lax");
    expect(f.start.headers.get("set-cookie")).not.toContain("huayi_session=");
    expect(f.auth.registerPassword).toHaveBeenCalledWith(
      expect.objectContaining({ email, password: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/u) }),
    );
    expect(f.auth.setPassword).not.toHaveBeenCalled();
    const blocked = await f.post("complete", { password }, f.cookie, f.session.csrfToken);
    expect(blocked.status).toBe(401);
    expect(f.auth.setPassword).not.toHaveBeenCalled();
    const verified = await f.post("verify", { token: "123456" }, f.cookie, f.session.csrfToken);
    expect(verified.status).toBe(200);
    expect(await verified.json()).toMatchObject({ email, step: "set-password" });
    expect(verified.headers.get("set-cookie")).toBeNull();
    expect(f.auth.setPassword).not.toHaveBeenCalled();
    expect(f.identity.listSignInMethods("auth-user-a")).toEqual([]);
    const restored = await f.app.request(`${base}/session`, {
      headers: { origin: webOrigin, cookie: f.cookie },
    });
    expect(await restored.json()).toMatchObject({ email, step: "set-password" });
    const complete = await f.post("complete", { password }, f.cookie, f.session.csrfToken);
    expect(complete.status).toBe(200);
    expect(await complete.json()).toMatchObject({ access: "full" });
    expect(complete.headers.get("set-cookie")).toContain("huayi_session=");
    expect(f.auth.setPassword).toHaveBeenCalledWith({
      authState: { private: "provider-session" },
      password,
    });
    expect(f.identity.listSignInMethods("auth-user-a")).toEqual([
      expect.objectContaining({ method: "password" }),
    ]);
    expect(
      (
        await f.post(
          "complete",
          { password: "a different password" },
          f.cookie,
          f.session.csrfToken,
        )
      ).status,
    ).toBe(401);
    expect(f.auth.setPassword).toHaveBeenCalledOnce();
  });

  it("does not advance or expose provider details after an invalid OTP", async () => {
    const f = await pending();
    const response = await f.post("verify", { token: "000000" }, f.cookie, f.session.csrfToken);
    expect(response.status).toBe(401);
    expect(await response.text()).not.toContain("private provider detail");
    expect(f.auth.setPassword).not.toHaveBeenCalled();
    const restored = await f.app.request(`${base}/session`, {
      headers: { origin: webOrigin, cookie: f.cookie },
    });
    expect(await restored.json()).toMatchObject({ step: "verify-email" });
  });

  it("requires the bound browser cookie, exact origin and CSRF before contacting the provider", async () => {
    const f = await pending();
    for (const response of [
      await f.post("verify", { token: "123456" }),
      await f.post("verify", { token: "123456" }, f.cookie),
      await f.post("verify", { token: "123456" }, f.cookie, "x".repeat(43)),
      await f.post(
        "verify",
        { token: "123456" },
        f.cookie,
        f.session.csrfToken,
        "https://other.invalid",
      ),
      await f.post(
        "verify",
        { token: "123456", email: "other@example.com" },
        f.cookie,
        f.session.csrfToken,
      ),
    ])
      expect(response.status).toBeGreaterThanOrEqual(400);
    expect(f.auth.verifyPasswordRegistrationOtp).not.toHaveBeenCalled();
    expect(f.auth.setPassword).not.toHaveBeenCalled();
  });

  it("resends to the server-bound email and shares the email verification rate limit", async () => {
    const f = await pending();
    expect((await f.post("resend", {}, f.cookie, f.session.csrfToken)).status).toBe(202);
    expect(f.auth.resendPasswordRegistrationOtp).toHaveBeenCalledWith(
      expect.objectContaining({ email }),
    );
    for (let n = 0; n < 5; n++)
      expect(
        (await f.post("verify", { token: "000000" }, f.cookie, f.session.csrfToken)).status,
      ).toBe(401);
    expect(
      (await f.post("verify", { token: "123456" }, f.cookie, f.session.csrfToken)).status,
    ).toBe(429);
    expect(f.auth.verifyPasswordRegistrationOtp).toHaveBeenCalledTimes(5);
  });

  it("prevents concurrent password updates", async () => {
    const f = await pending();
    await f.post("verify", { token: "123456" }, f.cookie, f.session.csrfToken);
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.mocked(f.auth.setPassword).mockImplementationOnce(async () => {
      await waiting;
      return { authState: {}, userId: "auth-user-a" };
    });
    const first = f.post("complete", { password }, f.cookie, f.session.csrfToken);
    await vi.waitFor(() => expect(f.auth.setPassword).toHaveBeenCalledOnce());
    expect(
      (
        await f.post(
          "complete",
          { password: "a different password" },
          f.cookie,
          f.session.csrfToken,
        )
      ).status,
    ).toBe(409);
    release();
    expect((await first).status).toBe(200);
    expect(f.auth.setPassword).toHaveBeenCalledOnce();
  });

  it("fails closed when the password update returns a different identity", async () => {
    const f = await pending();
    await f.post("verify", { token: "123456" }, f.cookie, f.session.csrfToken);
    vi.mocked(f.auth.setPassword).mockResolvedValueOnce({ authState: {}, userId: "other-user" });
    const response = await f.post("complete", { password }, f.cookie, f.session.csrfToken);
    expect(response.status).toBe(401);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(f.identity.listSignInMethods("auth-user-a")).toEqual([]);
  });

  it("restores an expired verification lease without mutating progress on GET", async () => {
    const f = await pending();
    const compare = vi.spyOn(f.identity, "comparePasswordSignupState");
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.mocked(f.auth.verifyPasswordRegistrationOtp).mockImplementationOnce(async () => {
      await waiting;
      return { email, userId: "auth-user-a", refreshToken: "refresh", authState: {} };
    });
    const verification = f.post("verify", { token: "123456" }, f.cookie, f.session.csrfToken);
    await vi.waitFor(() => expect(f.auth.verifyPasswordRegistrationOtp).toHaveBeenCalledOnce());
    const now = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 121_000);
    try {
      const restored = await f.app.request(`${base}/session`, {
        headers: { origin: webOrigin, cookie: f.cookie },
      });
      expect(await restored.json()).toMatchObject({ step: "verify-email" });
      expect(compare).toHaveBeenCalledOnce();
    } finally {
      now.mockRestore();
      release();
      await verification;
    }
  });

  it("restores verified progress in the bound browser after the short claim expires", async () => {
    const f = await pending();
    await f.post("verify", { token: "123456" }, f.cookie, f.session.csrfToken);
    f.clock.advance(20 * 60_000);
    const restored = await f.app.request(`${base}/session`, {
      headers: { origin: webOrigin, cookie: f.cookie },
    });
    expect(restored.status).toBe(200);
    expect(await restored.json()).toMatchObject({ email, step: "set-password" });
    expect((await f.post("complete", { password }, f.cookie, f.session.csrfToken)).status).toBe(
      200,
    );
    expect(f.auth.verifyPasswordRegistrationOtp).toHaveBeenCalledOnce();
  });

  it("stops recovery after 24 hours without writing a password", async () => {
    const f = await pending();
    await f.post("verify", { token: "123456" }, f.cookie, f.session.csrfToken);
    f.clock.advance(24 * 60 * 60_000);
    expect((await f.post("complete", { password }, f.cookie, f.session.csrfToken)).status).toBe(
      401,
    );
    expect(f.auth.setPassword).not.toHaveBeenCalled();
  });

  it("recovers a lost password update response only with proof of the same password", async () => {
    const f = await pending();
    await f.post("verify", { token: "123456" }, f.cookie, f.session.csrfToken);
    vi.mocked(f.auth.setPassword).mockRejectedValueOnce(new Error("private provider detail"));
    const response = await f.post("complete", { password }, f.cookie, f.session.csrfToken);
    expect(response.status).toBe(200);
    expect(await response.text()).not.toContain("private provider detail");
    expect(f.auth.setPassword).toHaveBeenCalledOnce();
  });

  it("keeps a failed password completion retryable without accepting a competing password", async () => {
    const f = await pending();
    await f.post("verify", { token: "123456" }, f.cookie, f.session.csrfToken);
    vi.mocked(f.auth.setPassword).mockRejectedValueOnce(new Error("private provider detail"));
    vi.spyOn(f.auth, "signInWithPassword").mockRejectedValueOnce(new Error("network failure"));
    expect((await f.post("complete", { password }, f.cookie, f.session.csrfToken)).status).toBe(
      401,
    );
    expect(
      (
        await f.post(
          "complete",
          { password: "a different password" },
          f.cookie,
          f.session.csrfToken,
        )
      ).status,
    ).toBe(401);
    expect(f.auth.setPassword).toHaveBeenCalledOnce();
    expect((await f.post("complete", { password }, f.cookie, f.session.csrfToken)).status).toBe(
      200,
    );
    expect(f.auth.setPassword).toHaveBeenCalledTimes(2);
  });

  it("keeps the email link inert and rejects the legacy callback for an email-first flow", async () => {
    const f = await pending();
    const link = new URL(
      vi.mocked(f.auth.registerPassword).mock.calls[0]?.[0].redirectTo ?? "https://invalid.test",
    );
    const page = await f.app.request(`${link.pathname}${link.search}`);
    expect(page.headers.get("location")).toBe(`${webOrigin}/join`);
    expect(f.auth.verifyPasswordRegistrationOtp).not.toHaveBeenCalled();
    const bypass = await f.app.request("/v1/auth/password/callback", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        flow: link.searchParams.get("flow") ?? "",
        email,
        token: "123456",
      }),
    });
    expect(bypass.status).toBeGreaterThanOrEqual(400);
    expect(f.auth.verifyPasswordRegistrationOtp).not.toHaveBeenCalled();
    expect(bypass.headers.get("set-cookie")).toBeNull();
  });
});
