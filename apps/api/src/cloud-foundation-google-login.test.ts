import { describe, expect, it, vi } from "vitest";

import { createCloudFoundationApp } from "./cloud-foundation-app.js";
import { createIdentityModule } from "./identity-module.js";
import { createInMemoryRateLimiter } from "./rate-limiter.js";
import { createFoundationAuthProvider } from "./test-support/foundation-auth-provider.js";
import { DeterministicSecrets, MutableClock } from "./test-support/security-fakes.js";

const webOrigin = "https://app.huayi.example";

function foundation(googleAuthenticationEnabled = true) {
  const clock = new MutableClock("2026-08-12T00:00:00.000Z");
  const identity = createIdentityModule({
    clock,
    pepper: "test-pepper-at-least-32-characters",
    secrets: new DeterministicSecrets(),
    webOrigin,
  });
  const auth = createFoundationAuthProvider();
  vi.spyOn(auth, "beginGoogle");
  return {
    app: createCloudFoundationApp({
      apiOrigin: "https://api.huayi.example",
      auth,
      extensionOrigin: `chrome-extension://${"a".repeat(32)}`,
      googleLink: identity.googleLink,
      googleAuthenticationEnabled,
      identity,
      passwordLink: identity.passwordLink,
      protectRefreshToken: (token) => `protected:${token}`,
      protectTransientAuthState: (state) => state,
      rateLimiter: createInMemoryRateLimiter(clock),
      unprotectRefreshToken: (token) => token.replace(/^protected:/u, ""),
      unprotectTransientAuthState: (state) => state,
      webOrigin,
    }),
    auth,
    identity,
  };
}

describe("Cloud foundation ordinary Google login", () => {
  it("does not mount Google routes or create provider state when the capability is disabled", async () => {
    const disabled = foundation(false);
    const createFlow = vi.spyOn(disabled.identity, "createLoginAuthFlow");
    const response = await disabled.app.request("/v1/auth/google/login/start", {
      body: "",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      method: "POST",
    });
    expect(response.status).toBe(404);
    expect(createFlow).not.toHaveBeenCalled();
    expect(disabled.auth.beginGoogle).not.toHaveBeenCalled();
    for (const path of [
      "/v1/auth/google/start",
      "/v1/auth/google/login/start",
      "/v1/auth/callback",
      "/v1/auth/reauthenticate/google/start",
      "/v1/account/sign-in-methods/google:start",
    ]) {
      expect(disabled.app.routes.map((route) => route.path)).not.toContain(path);
    }
  });

  it("starts only from an empty native form", async () => {
    const { app } = foundation();
    const start = await app.request("/v1/auth/google/login/start", {
      body: "",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      method: "POST",
    });
    expect(start.status).toBe(302);
    expect(start.headers.get("location")).toBe("https://accounts.google.test");
    expect(start.headers.get("cache-control")).toBe("private, no-store");
    for (const body of ["claimTicket=private", "next=https%3A%2F%2Fevil.example"]) {
      expect(
        (
          await app.request("/v1/auth/google/login/start", {
            body,
            headers: { "content-type": "application/x-www-form-urlencoded" },
            method: "POST",
          })
        ).status,
      ).toBe(400);
    }
  });

  it("sets no-store and no-referrer on successful and rejected callbacks", async () => {
    const accepted = foundation();
    accepted.identity.createProfile("auth-user-a", "learner@example.com", ["google"]);
    vi.spyOn(accepted.auth, "completeCode").mockResolvedValue({
      email: "learner@example.com",
      refreshToken: "refresh-token",
      userId: "auth-user-a",
    });
    await accepted.app.request("/v1/auth/google/login/start", {
      body: "",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      method: "POST",
    });
    const redirectTo = vi.mocked(accepted.auth.beginGoogle).mock.calls[0]?.[0].redirectTo;
    const flow = redirectTo === undefined ? null : new URL(redirectTo).searchParams.get("flow");
    const callback = await accepted.app.request(
      `/v1/auth/callback?code=provider-code&flow=${encodeURIComponent(flow ?? "")}`,
    );

    expect(callback.status).toBe(302);
    expect(callback.headers.get("location")).toBe(`${webOrigin}/practice`);
    expect(callback.headers.get("cache-control")).toBe("private, no-store");
    expect(callback.headers.get("referrer-policy")).toBe("no-referrer");
    expect(callback.headers.get("set-cookie")).toContain("HttpOnly; Secure; SameSite=Lax; Path=/");

    const rejected = await foundation().app.request("/v1/auth/callback?flow=incomplete");
    expect(rejected.status).toBe(400);
    expect(rejected.headers.get("cache-control")).toBe("private, no-store");
    expect(rejected.headers.get("referrer-policy")).toBe("no-referrer");
    expect(rejected.headers.get("set-cookie")).toBeNull();
  });
});
