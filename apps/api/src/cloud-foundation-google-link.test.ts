import { describe, expect, it, vi } from "vitest";

import type { AuthProvider } from "./auth-provider.js";
import { createCloudFoundationApp } from "./cloud-foundation-app.js";
import { createIdentityModule } from "./identity-module.js";
import { createInMemoryRateLimiter } from "./rate-limiter.js";
import { DeterministicSecrets, MutableClock } from "./test-support/security-fakes.js";

const webOrigin = "https://app.huayi.example";

function foundation() {
  const clock = new MutableClock("2026-08-12T00:00:00.000Z");
  const identity = createIdentityModule({
    clock,
    pepper: "test-pepper-at-least-32-characters",
    secrets: new DeterministicSecrets(),
    webOrigin,
  });
  const auth: AuthProvider = {
    beginGoogle: vi.fn(),
    beginGoogleLink: vi.fn(),
    completeCode: vi.fn(),
    refreshSession: vi.fn(),
    registerPassword: vi.fn(),
    resendPasswordRegistrationOtp: vi.fn(),
    setPassword: vi.fn(),
    signInWithPassword: vi.fn().mockResolvedValue({
      email: "learner@example.com",
      refreshToken: "refresh-token",
      userId: "auth-user-a",
    }),
    verifyPasswordRegistrationOtp: vi.fn(),
  };
  return {
    app: createCloudFoundationApp({
      apiOrigin: "https://api.huayi.example",
      auth,
      extensionOrigin: `chrome-extension://${"a".repeat(32)}`,
      googleLink: identity.googleLink,
      googleAuthenticationEnabled: true,
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

describe("Cloud foundation Google link", () => {
  it("links Google only after password reauthentication and rotates the current session", async () => {
    const currentFoundation = foundation();
    currentFoundation.identity.createProfile("auth-user-a", "learner@example.com", ["password"]);
    const initial = currentFoundation.identity.createWebSession(
      "auth-user-a",
      "protected:initial-refresh",
    );
    const reauthenticated = await currentFoundation.app.request(
      "/v1/auth/reauthenticate/password",
      {
        body: JSON.stringify({ password: "correct horse battery staple" }),
        headers: {
          "content-type": "application/json",
          cookie: `huayi_session=${initial.sessionId}`,
          origin: webOrigin,
          "x-csrf-token": initial.csrfToken,
        },
        method: "POST",
      },
    );
    const sessionId = /huayi_session=([^;]+)/u.exec(
      reauthenticated.headers.get("set-cookie") ?? "",
    )?.[1];
    const { csrfToken } = (await reauthenticated.json()) as { csrfToken: string };
    vi.mocked(currentFoundation.auth.refreshSession).mockResolvedValue({
      authState: { providerRefresh: "rotated-provider-refresh" },
      session: {
        email: "learner@example.com",
        refreshToken: "rotated-provider-refresh",
        userId: "auth-user-a",
      },
    });
    vi.mocked(currentFoundation.auth.beginGoogleLink).mockResolvedValue({
      authState: { codeVerifier: "persisted-before-redirect" },
      redirectUrl: "https://accounts.google.test/link",
    });

    const started = await currentFoundation.app.request(
      "/v1/account/sign-in-methods/google:start",
      {
        body: JSON.stringify({}),
        headers: {
          "content-type": "application/json",
          cookie: `huayi_session=${sessionId ?? "missing"}`,
          origin: webOrigin,
          "x-csrf-token": csrfToken,
        },
        method: "POST",
      },
    );
    expect(await started.json()).toEqual({
      continuePath: "/v1/account/sign-in-methods/google:continue",
    });
    const intentCookie = started.headers.get("set-cookie");
    expect(intentCookie).toContain(
      "HttpOnly; Secure; SameSite=Strict; Path=/v1/account/sign-in-methods/google:continue",
    );

    const continued = await currentFoundation.app.request(
      "/v1/account/sign-in-methods/google:continue",
      {
        headers: {
          cookie: `huayi_session=${sessionId ?? "missing"}; ${intentCookie?.split(";", 1)[0] ?? ""}`,
        },
      },
    );
    expect(continued.headers.get("location")).toBe("https://accounts.google.test/link");
    expect(currentFoundation.auth.refreshSession).toHaveBeenCalledWith({
      refreshToken: "refresh-token",
    });
    expect(currentFoundation.auth.beginGoogleLink).toHaveBeenCalledWith({
      authState: { providerRefresh: "rotated-provider-refresh" },
      redirectTo: expect.stringContaining("/v1/account/sign-in-methods/google:callback?flow="),
    });
    const redirectTo = vi.mocked(currentFoundation.auth.beginGoogleLink).mock.calls[0]?.[0]
      .redirectTo;
    const flow = redirectTo === undefined ? null : new URL(redirectTo).searchParams.get("flow");
    vi.mocked(currentFoundation.auth.completeCode).mockResolvedValue({
      email: "learner@example.com",
      refreshToken: "linked-provider-refresh",
      userId: "auth-user-a",
    });

    const completed = await currentFoundation.app.request(
      `/v1/account/sign-in-methods/google:callback?code=provider-code&flow=${encodeURIComponent(
        flow ?? "",
      )}`,
      { headers: { cookie: `huayi_session=${sessionId ?? "missing"}` } },
    );
    expect(completed.status).toBe(302);
    expect(completed.headers.get("location")).toBe(`${webOrigin}/settings/account`);
    expect(
      currentFoundation.identity.listSignInMethods("auth-user-a").map(({ method }) => method),
    ).toEqual(["password", "google"]);
    expect(() =>
      currentFoundation.identity.authenticateWebSession(sessionId ?? "missing"),
    ).toThrow();
  });

  it("rejects an ordinary-login session before touching the provider", async () => {
    const currentFoundation = foundation();
    currentFoundation.identity.createProfile("auth-user-a", "learner@example.com", ["password"]);
    const ordinary = currentFoundation.identity.createWebSession(
      "auth-user-a",
      "protected:initial-refresh",
    );

    const rejected = await currentFoundation.app.request(
      "/v1/account/sign-in-methods/google:start",
      {
        body: JSON.stringify({}),
        headers: {
          "content-type": "application/json",
          cookie: `huayi_session=${ordinary.sessionId}`,
          origin: webOrigin,
          "x-csrf-token": ordinary.csrfToken,
        },
        method: "POST",
      },
    );

    expect(rejected.status).toBe(401);
    expect(rejected.headers.get("set-cookie")).toBeNull();
    expect(currentFoundation.auth.refreshSession).not.toHaveBeenCalled();
    expect(currentFoundation.auth.beginGoogleLink).not.toHaveBeenCalled();
  });

  it("returns a stable conflict without creating a flow when Google is already linked", async () => {
    const currentFoundation = foundation();
    currentFoundation.identity.createProfile("auth-user-a", "learner@example.com", [
      "password",
      "google",
    ]);
    const initial = currentFoundation.identity.createWebSession(
      "auth-user-a",
      "protected:initial-refresh",
    );
    const reauthenticated = await currentFoundation.app.request(
      "/v1/auth/reauthenticate/password",
      {
        body: JSON.stringify({ password: "correct horse battery staple" }),
        headers: {
          "content-type": "application/json",
          cookie: `huayi_session=${initial.sessionId}`,
          origin: webOrigin,
          "x-csrf-token": initial.csrfToken,
        },
        method: "POST",
      },
    );
    const sessionId = /huayi_session=([^;]+)/u.exec(
      reauthenticated.headers.get("set-cookie") ?? "",
    )?.[1];
    const { csrfToken } = (await reauthenticated.json()) as { csrfToken: string };
    const response = await currentFoundation.app.request(
      "/v1/account/sign-in-methods/google:start",
      {
        body: JSON.stringify({}),
        headers: {
          "content-type": "application/json",
          cookie: `huayi_session=${sessionId ?? "missing"}`,
          origin: webOrigin,
          "x-csrf-token": csrfToken,
        },
        method: "POST",
      },
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: expect.objectContaining({ code: "sign_in_method_already_linked" }),
    });
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(currentFoundation.auth.refreshSession).not.toHaveBeenCalled();
    expect(currentFoundation.auth.beginGoogleLink).not.toHaveBeenCalled();
  });
});
