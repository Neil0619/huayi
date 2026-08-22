import { describe, expect, it, vi } from "vitest";

import { createCloudFoundationApp } from "./cloud-foundation-app.js";
import { createIdentityModule } from "./identity-module.js";
import { createInMemoryRateLimiter } from "./rate-limiter.js";
import { createFoundationAuthProvider } from "./test-support/foundation-auth-provider.js";
import { DeterministicSecrets, MutableClock } from "./test-support/security-fakes.js";

const apiOrigin = "https://api.huayi.example";
const webOrigin = "https://app.huayi.example";

describe("Cloud foundation password callback", () => {
  it("completes email confirmation as password registration on its dedicated callback", async () => {
    const clock = new MutableClock("2026-08-12T00:00:00.000Z");
    const identity = createIdentityModule({
      clock,
      pepper: "test-pepper-at-least-32-characters",
      secrets: new DeterministicSecrets(),
      webOrigin,
    });
    const auth = createFoundationAuthProvider();
    vi.spyOn(auth, "registerPassword");
    const completeCode = vi.spyOn(auth, "completeCode").mockResolvedValue({
      email: "learner@example.com",
      refreshToken: "refresh-token",
      userId: "auth-user-a",
    });
    const app = createCloudFoundationApp({
      apiOrigin,
      auth,
      extensionOrigin: `chrome-extension://${"a".repeat(32)}`,
      googleLink: identity.googleLink,
      identity,
      passwordLink: identity.passwordLink,
      protectRefreshToken: (token) => `protected:${token}`,
      protectTransientAuthState: (state) => state,
      rateLimiter: createInMemoryRateLimiter(clock),
      unprotectRefreshToken: (token) => token.replace(/^protected:/u, ""),
      unprotectTransientAuthState: (state) => state,
      webOrigin,
    });
    const invitation = identity.createInvitation("admin-1", 72);
    const claimResponse = await app.request("/v1/invitations/claim", {
      body: JSON.stringify({ invitationToken: invitation.token }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
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
    const redirectTo = vi.mocked(auth.registerPassword).mock.calls[0]?.[0].redirectTo;
    expect(redirectTo).toBeDefined();
    const callbackUrl = new URL(redirectTo ?? "https://invalid.test");
    expect(callbackUrl.pathname).toBe("/v1/auth/password/callback");
    const flow = callbackUrl.searchParams.get("flow");

    const callback = await app.request(
      `/v1/auth/password/callback?code=provider-code&flow=${encodeURIComponent(flow ?? "")}`,
    );
    expect(callback.status).toBe(302);
    expect(callback.headers.get("location")).toBe(`${webOrigin}/app`);
    expect(callback.headers.get("set-cookie")).toContain("HttpOnly; Secure; SameSite=Lax; Path=/");
    expect(completeCode).toHaveBeenCalledOnce();
    expect(identity.listSignInMethods("auth-user-a")).toEqual([
      expect.objectContaining({ method: "password" }),
    ]);
  });
});
