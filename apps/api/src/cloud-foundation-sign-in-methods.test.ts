import { describe, expect, it, vi } from "vitest";

import type { AuthProvider } from "./auth-provider.js";
import { createCloudFoundationApp } from "./cloud-foundation-app.js";
import { CloudFault } from "./cloud-fault.js";
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
    beginGoogleLink: vi.fn(),
    beginGoogle: vi
      .fn()
      .mockResolvedValue({ authState: {}, redirectUrl: "https://accounts.google.test" }),
    completeCode: vi.fn(),
    registerPassword: vi.fn(),
    resendPasswordRegistrationOtp: vi.fn(),
    refreshSession: vi.fn(),
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
      identity,
      passwordLink: identity.passwordLink,
      googleLink: identity.googleLink,
      googleAuthenticationEnabled: true,
      protectRefreshToken: (token) => `protected:${token}`,
      protectTransientAuthState: (state) => state,
      rateLimiter: createInMemoryRateLimiter(clock),
      unprotectRefreshToken: (token) => token.replace(/^protected:/u, ""),
      unprotectTransientAuthState: (state) => state,
      webOrigin,
    }),
    auth,
    clock,
    identity,
  };
}

function reauthenticateRequest(
  session: { csrfToken: string; sessionId: string },
  password: string,
) {
  return {
    body: JSON.stringify({ password }),
    headers: {
      "content-type": "application/json",
      cookie: `huayi_session=${session.sessionId}`,
      origin: webOrigin,
      "x-csrf-token": session.csrfToken,
    },
    method: "POST" as const,
  };
}

describe("Cloud foundation sign-in method fence", () => {
  it("does not create a Huayi session for an unregistered provider method", async () => {
    const passwordFoundation = foundation();
    passwordFoundation.identity.createProfile("auth-user-a", "learner@example.com", ["google"]);
    const passwordLogin = await passwordFoundation.app.request("/v1/auth/password/login", {
      body: JSON.stringify({
        email: "learner@example.com",
        password: "correct horse battery staple",
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(passwordLogin.status).toBe(401);
    expect(passwordLogin.headers.get("set-cookie")).toBeNull();

    const googleFoundation = foundation();
    googleFoundation.identity.createProfile("auth-user-a", "learner@example.com", ["password"]);
    vi.mocked(googleFoundation.auth.completeCode).mockResolvedValue({
      email: "learner@example.com",
      refreshToken: "refresh-token",
      userId: "auth-user-a",
    });
    await googleFoundation.app.request("/v1/auth/google/login/start", {
      body: "",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      method: "POST",
    });
    const redirectTo = vi.mocked(googleFoundation.auth.beginGoogle).mock.calls[0]?.[0].redirectTo;
    const flow = redirectTo === undefined ? "" : new URL(redirectTo).searchParams.get("flow");
    const googleCallback = await googleFoundation.app.request(
      `/v1/auth/callback?code=provider-code&flow=${encodeURIComponent(flow ?? "")}`,
    );
    expect(googleCallback.status).toBe(401);
    expect(googleCallback.headers.get("set-cookie")).toBeNull();
  });

  it("password-reauthenticates the current owner and atomically rotates its session", async () => {
    const currentFoundation = foundation();
    currentFoundation.identity.createProfile("auth-user-a", "Learner@Example.COM", ["password"]);
    const current = currentFoundation.identity.createWebSession(
      "auth-user-a",
      "old-refresh-ciphertext",
    );
    currentFoundation.clock.advance(60_000);

    const response = await currentFoundation.app.request(
      "/v1/auth/reauthenticate/password",
      reauthenticateRequest(current, "correct horse battery staple"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const setCookie = response.headers.get("set-cookie");
    expect(setCookie).toContain("HttpOnly; Secure; SameSite=Lax; Path=/");
    expect(setCookie).not.toContain(current.sessionId);
    const body = (await response.json()) as { access: string; csrfToken: string };
    expect(body).toMatchObject({ access: "full" });
    expect(body.csrfToken).not.toBe(current.csrfToken);
    expect(currentFoundation.auth.signInWithPassword).toHaveBeenCalledWith({
      email: "learner@example.com",
      password: "correct horse battery staple",
    });
    expect(() => currentFoundation.identity.authenticateWebSession(current.sessionId)).toThrow();
    const rotatedSessionId = /huayi_session=([^;]+)/u.exec(setCookie ?? "")?.[1];
    expect(
      currentFoundation.identity.authenticateWebSession(rotatedSessionId ?? "missing"),
    ).toEqual({
      reauthenticatedAt: new Date("2026-08-12T00:01:00.000Z"),
      userId: "auth-user-a",
    });
  });

  it("keeps the current session unchanged for wrong passwords and provider-user mismatch", async () => {
    const wrongPassword = foundation();
    wrongPassword.identity.createProfile("auth-user-a", "learner@example.com", ["password"]);
    const current = wrongPassword.identity.createWebSession("auth-user-a", "old-ciphertext");
    vi.mocked(wrongPassword.auth.signInWithPassword).mockRejectedValue(
      new CloudFault("authentication_required", "Email or password is invalid."),
    );

    const rejected = await wrongPassword.app.request(
      "/v1/auth/reauthenticate/password",
      reauthenticateRequest(current, "wrong-password-value"),
    );
    expect(rejected.status).toBe(401);
    expect(rejected.headers.get("set-cookie")).toBeNull();
    expect(wrongPassword.identity.authenticateWebSession(current.sessionId)).toMatchObject({
      userId: "auth-user-a",
    });

    const mismatch = foundation();
    mismatch.identity.createProfile("auth-user-a", "learner@example.com", ["password"]);
    const mismatchCurrent = mismatch.identity.createWebSession("auth-user-a", "old-ciphertext");
    vi.mocked(mismatch.auth.signInWithPassword).mockResolvedValue({
      email: "learner@example.com",
      refreshToken: "untrusted-refresh-token",
      userId: "different-provider-user",
    });
    const mismatched = await mismatch.app.request(
      "/v1/auth/reauthenticate/password",
      reauthenticateRequest(mismatchCurrent, "correct horse battery staple"),
    );
    expect(mismatched.status).toBe(401);
    expect(mismatched.headers.get("set-cookie")).toBeNull();
    expect(mismatch.identity.authenticateWebSession(mismatchCurrent.sessionId)).toMatchObject({
      userId: "auth-user-a",
    });
  });

  it("fails closed before provider authentication and rate-limits repeated password attempts", async () => {
    const missingProof = foundation();
    const noProof = await missingProof.app.request("/v1/auth/reauthenticate/password", {
      body: JSON.stringify({ password: "correct horse battery staple" }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(noProof.status).toBe(401);
    expect(missingProof.auth.signInWithPassword).not.toHaveBeenCalled();

    const wrongMethod = foundation();
    wrongMethod.identity.createProfile("auth-user-a", "learner@example.com", ["google"]);
    const googleSession = wrongMethod.identity.createWebSession("auth-user-a", "ciphertext");
    const unregistered = await wrongMethod.app.request(
      "/v1/auth/reauthenticate/password",
      reauthenticateRequest(googleSession, "correct horse battery staple"),
    );
    expect(unregistered.status).toBe(401);
    expect(wrongMethod.auth.signInWithPassword).not.toHaveBeenCalled();

    const limited = foundation();
    limited.identity.createProfile("auth-user-a", "learner@example.com", ["password"]);
    const current = limited.identity.createWebSession("auth-user-a", "ciphertext");
    vi.mocked(limited.auth.signInWithPassword).mockRejectedValue(
      new CloudFault("authentication_required", "Email or password is invalid."),
    );
    const attempts = [];
    for (let index = 0; index < 6; index += 1) {
      attempts.push(
        await limited.app.request(
          "/v1/auth/reauthenticate/password",
          reauthenticateRequest(current, "wrong-password-value"),
        ),
      );
    }
    expect(attempts.map(({ status }) => status)).toEqual([401, 401, 401, 401, 401, 429]);
    expect(limited.auth.signInWithPassword).toHaveBeenCalledTimes(5);
    expect(limited.identity.authenticateWebSession(current.sessionId)).toMatchObject({
      userId: "auth-user-a",
    });
  });

  it("Google-reauthenticates only the owner bound to a one-time session intent", async () => {
    const currentFoundation = foundation();
    currentFoundation.identity.createProfile("auth-user-a", "learner@example.com", ["google"]);
    const current = currentFoundation.identity.createWebSession("auth-user-a", "old-ciphertext");

    const started = await currentFoundation.app.request("/v1/auth/reauthenticate/google/start", {
      body: JSON.stringify({}),
      headers: {
        "content-type": "application/json",
        cookie: `huayi_session=${current.sessionId}`,
        origin: webOrigin,
        "x-csrf-token": current.csrfToken,
      },
      method: "POST",
    });
    expect(started.status).toBe(200);
    const startedBody = await started.json();
    expect(startedBody).toEqual({
      continuePath: "/v1/auth/reauthenticate/google/continue",
    });
    const intentCookie = started.headers.get("set-cookie");
    expect(intentCookie).toContain(
      "HttpOnly; Secure; SameSite=Strict; Path=/v1/auth/reauthenticate/google/continue",
    );
    expect(JSON.stringify(startedBody)).not.toContain("flow");

    const continued = await currentFoundation.app.request(
      "/v1/auth/reauthenticate/google/continue",
      {
        headers: {
          cookie: `huayi_session=${current.sessionId}; ${intentCookie?.split(";", 1)[0] ?? ""}`,
        },
      },
    );
    expect(continued.status).toBe(302);
    expect(continued.headers.get("location")).toBe("https://accounts.google.test");
    expect(continued.headers.get("set-cookie")).toContain("Max-Age=0");
    const redirectTo = vi.mocked(currentFoundation.auth.beginGoogle).mock.calls[0]?.[0].redirectTo;
    const flow = redirectTo === undefined ? null : new URL(redirectTo).searchParams.get("flow");
    expect(flow).toBeTruthy();

    vi.mocked(currentFoundation.auth.completeCode).mockResolvedValue({
      email: "learner@example.com",
      refreshToken: "new-google-refresh",
      userId: "auth-user-a",
    });
    currentFoundation.clock.advance(60_000);
    const completed = await currentFoundation.app.request(
      `/v1/auth/reauthenticate/google/callback?code=provider-code&flow=${encodeURIComponent(flow ?? "")}`,
      { headers: { cookie: `huayi_session=${current.sessionId}` } },
    );
    expect(completed.status).toBe(302);
    expect(completed.headers.get("location")).toBe(`${webOrigin}/settings/account`);
    const rotatedCookie = completed.headers.get("set-cookie");
    expect(rotatedCookie).not.toContain(current.sessionId);
    expect(() => currentFoundation.identity.authenticateWebSession(current.sessionId)).toThrow();
    const rotatedId = /huayi_session=([^;]+)/u.exec(rotatedCookie ?? "")?.[1];
    expect(currentFoundation.identity.authenticateWebSession(rotatedId ?? "missing")).toEqual({
      reauthenticatedAt: new Date("2026-08-12T00:01:00.000Z"),
      userId: "auth-user-a",
    });
    expect(
      currentFoundation.identity.requireRecentAuthentication(rotatedId ?? "missing", "google"),
    ).toEqual({ userId: "auth-user-a" });

    const replay = await currentFoundation.app.request(
      `/v1/auth/reauthenticate/google/callback?code=replay&flow=${encodeURIComponent(flow ?? "")}`,
      { headers: { cookie: `huayi_session=${rotatedId ?? "missing"}` } },
    );
    expect(replay.status).toBe(401);
    expect(replay.headers.get("set-cookie")).toBeNull();
  });

  it("keeps the initiating session when Google reauthentication returns a different user", async () => {
    const mismatch = foundation();
    mismatch.identity.createProfile("auth-user-a", "learner@example.com", ["google"]);
    const current = mismatch.identity.createWebSession("auth-user-a", "old-ciphertext");
    const started = await mismatch.app.request("/v1/auth/reauthenticate/google/start", {
      body: JSON.stringify({}),
      headers: {
        "content-type": "application/json",
        cookie: `huayi_session=${current.sessionId}`,
        origin: webOrigin,
        "x-csrf-token": current.csrfToken,
      },
      method: "POST",
    });
    const intentCookie = started.headers.get("set-cookie")?.split(";", 1)[0] ?? "";
    await mismatch.app.request("/v1/auth/reauthenticate/google/continue", {
      headers: { cookie: `huayi_session=${current.sessionId}; ${intentCookie}` },
    });
    const redirectTo = vi.mocked(mismatch.auth.beginGoogle).mock.calls[0]?.[0].redirectTo;
    const flow = redirectTo === undefined ? null : new URL(redirectTo).searchParams.get("flow");
    vi.mocked(mismatch.auth.completeCode).mockResolvedValue({
      email: "other@example.com",
      refreshToken: "untrusted-refresh",
      userId: "different-provider-user",
    });

    const completed = await mismatch.app.request(
      `/v1/auth/reauthenticate/google/callback?code=provider-code&flow=${encodeURIComponent(flow ?? "")}`,
      { headers: { cookie: `huayi_session=${current.sessionId}` } },
    );
    expect(completed.status).toBe(401);
    expect(completed.headers.get("set-cookie")).toBeNull();
    expect(mismatch.identity.authenticateWebSession(current.sessionId)).toMatchObject({
      userId: "auth-user-a",
    });
  });
});
