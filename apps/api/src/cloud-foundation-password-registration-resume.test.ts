import { describe, expect, it, vi } from "vitest";

import { createCloudFoundationApp } from "./cloud-foundation-app.js";
import { CloudFault } from "./cloud-fault.js";
import { createIdentityModule } from "./identity-module.js";
import { createInMemoryRateLimiter } from "./rate-limiter.js";
import { createFoundationAuthProvider } from "./test-support/foundation-auth-provider.js";
import { DeterministicSecrets, MutableClock } from "./test-support/security-fakes.js";

function foundation() {
  const clock = new MutableClock("2026-08-12T00:00:00.000Z");
  const identity = createIdentityModule({
    clock,
    pepper: "test-pepper-at-least-32-characters",
    secrets: new DeterministicSecrets(),
    webOrigin: "https://app.huayi.example",
  });
  const auth = createFoundationAuthProvider();
  vi.spyOn(auth, "registerPassword");
  vi.spyOn(auth, "signInWithPassword");
  const app = createCloudFoundationApp({
    apiOrigin: "https://api.huayi.example",
    auth,
    extensionOrigin: `chrome-extension://${"a".repeat(32)}`,
    googleAuthenticationEnabled: true,
    googleLink: identity.googleLink,
    identity,
    passwordLink: identity.passwordLink,
    protectRefreshToken: (token) => `protected:${token}`,
    rateLimiter: createInMemoryRateLimiter(clock),
    unprotectRefreshToken: (token) => token.replace(/^protected:/u, ""),
    webOrigin: "https://app.huayi.example",
  });
  return { app, auth, clock, identity };
}

describe("Cloud foundation interrupted password registration", () => {
  it("rate-limits registration before an invalid claim can reach Auth", async () => {
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

  it("resumes a confirmed provider identity only through the original valid invitation", async () => {
    const { app, auth, clock, identity } = foundation();
    const invitation = identity.createInvitation("admin-1", 72);
    const claim = identity.claimInvitation(invitation.token);
    identity.createAuthFlow(claim.claimTicket);
    identity.bindInvitationIdentity(claim.claimTicket, "auth-user-a", "learner@example.com");
    clock.advance(16 * 60 * 1_000);

    const response = await app.request("/v1/auth/password/register/resume", {
      body: JSON.stringify({
        email: "learner@example.com",
        invitationToken: invitation.token,
        password: "correct horse battery staple",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("set-cookie")).toMatch(
      /^huayi_session=[A-Za-z0-9_-]+; HttpOnly; Secure; SameSite=Lax; Path=\/$/u,
    );
    expect(await response.json()).toMatchObject({
      access: "full",
      emailConfirmationRequired: false,
    });
    expect(auth.signInWithPassword).toHaveBeenCalledWith({
      email: "learner@example.com",
      password: "correct horse battery staple",
    });
    expect(JSON.stringify(vi.mocked(auth.signInWithPassword).mock.calls)).not.toContain(
      invitation.token,
    );
    expect(auth.registerPassword).not.toHaveBeenCalled();
    expect(identity.authorizeSignInMethod("auth-user-a", "password")).toEqual({
      userId: "auth-user-a",
    });
  });

  it("does not mutate registration state or set a Cookie when password proof fails", async () => {
    const { app, auth, identity } = foundation();
    const invitation = identity.createInvitation("admin-1", 72);
    const resume = vi.spyOn(identity, "resumeInterruptedPasswordRegistration");
    vi.mocked(auth.signInWithPassword).mockRejectedValueOnce(
      new CloudFault("authentication_required", "Email or password is invalid."),
    );

    const response = await app.request("/v1/auth/password/register/resume", {
      body: JSON.stringify({
        email: "learner@example.com",
        invitationToken: invitation.token,
        password: "wrong password long enough",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });

    expect(response.status).toBe(401);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(resume).not.toHaveBeenCalled();
    expect(auth.registerPassword).not.toHaveBeenCalled();
  });

  it("does not set a Cookie when the atomic interrupted state rejects recovery", async () => {
    const { app, auth, identity } = foundation();
    const invitation = identity.createInvitation("admin-1", 72);
    const resume = vi
      .spyOn(identity, "resumeInterruptedPasswordRegistration")
      .mockImplementationOnce(() => {
        throw new CloudFault("authentication_required", "Registration recovery is unavailable.");
      });
    const createWebSession = vi.spyOn(identity, "createWebSession");

    const response = await app.request("/v1/auth/password/register/resume", {
      body: JSON.stringify({
        email: "learner@example.com",
        invitationToken: invitation.token,
        password: "correct horse battery staple",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });

    expect(response.status).toBe(401);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(auth.signInWithPassword).toHaveBeenCalledOnce();
    expect(resume).toHaveBeenCalledOnce();
    expect(createWebSession).not.toHaveBeenCalled();
  });
});
