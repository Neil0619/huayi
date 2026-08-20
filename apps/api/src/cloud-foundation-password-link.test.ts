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
    refreshSession: vi.fn().mockResolvedValue({
      authState: { "provider-session": "refreshed-state" },
      session: {
        email: "learner@example.com",
        refreshToken: "rotated-refresh",
        userId: "auth-user-a",
      },
    }),
    registerPassword: vi.fn(),
    setPassword: vi.fn().mockResolvedValue({
      authState: { "provider-session": "updated-state" },
      userId: "auth-user-a",
    }),
    signInWithPassword: vi.fn(),
  };
  return {
    app: createCloudFoundationApp({
      apiOrigin: "https://api.huayi.example",
      auth,
      extensionOrigin: `chrome-extension://${"a".repeat(32)}`,
      googleLink: identity.googleLink,
      identity,
      passwordLink: identity.passwordLink,
      protectRefreshToken: (token) => `protected:${token}`,
      protectTransientAuthState: (state) => `state:${state}`,
      rateLimiter: createInMemoryRateLimiter(clock),
      unprotectRefreshToken: (token) => token.replace(/^protected:/u, ""),
      unprotectTransientAuthState: (state) => state.replace(/^state:/u, ""),
      webOrigin,
    }),
    auth,
    identity,
  };
}

function googleReauthenticatedSession(
  currentFoundation: ReturnType<typeof foundation>,
  methods: ("google" | "password")[] = ["google"],
) {
  const { identity } = currentFoundation;
  identity.createProfile("auth-user-a", "learner@example.com", methods);
  const ordinary = identity.createWebSession("auth-user-a", "protected:initial-refresh");
  const flow = identity.createGoogleReauthentication(
    ordinary.sessionId,
    webOrigin,
    ordinary.csrfToken,
  );
  identity.continueGoogleReauthentication(flow.flowId, ordinary.sessionId);
  identity.saveAuthFlowState(flow.flowId, "state:google-reauthentication");
  return identity.completeGoogleReauthentication(
    flow.flowId,
    ordinary.sessionId,
    "auth-user-a",
    "protected:google-reauthenticated-refresh",
  );
}

describe("Cloud foundation password link", () => {
  it("sets password after Google reauthentication and rotates the current session", async () => {
    const currentFoundation = foundation();
    const current = googleReauthenticatedSession(currentFoundation);

    const response = await currentFoundation.app.request("/v1/account/sign-in-methods/password", {
      body: JSON.stringify({ password: "correct horse battery staple" }),
      headers: {
        "content-type": "application/json",
        cookie: `huayi_session=${current.sessionId}`,
        origin: webOrigin,
        "x-csrf-token": current.csrfToken,
      },
      method: "POST",
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({
      methods: [
        expect.objectContaining({ method: "password" }),
        expect.objectContaining({ method: "google" }),
      ],
    });
    expect(currentFoundation.auth.refreshSession).toHaveBeenCalledWith({
      refreshToken: "google-reauthenticated-refresh",
    });
    expect(currentFoundation.auth.setPassword).toHaveBeenCalledWith({
      authState: { "provider-session": "refreshed-state" },
      password: "correct horse battery staple",
    });
    expect(() => currentFoundation.identity.authenticateWebSession(current.sessionId)).toThrow();
    expect(response.headers.get("set-cookie")).not.toContain(current.sessionId);
  });

  it("rejects ordinary login provenance before refresh or password update", async () => {
    const currentFoundation = foundation();
    currentFoundation.identity.createProfile("auth-user-a", "learner@example.com", ["google"]);
    const ordinary = currentFoundation.identity.createWebSession(
      "auth-user-a",
      "protected:initial-refresh",
    );

    const response = await currentFoundation.app.request("/v1/account/sign-in-methods/password", {
      body: JSON.stringify({ password: "correct horse battery staple" }),
      headers: {
        "content-type": "application/json",
        cookie: `huayi_session=${ordinary.sessionId}`,
        origin: webOrigin,
        "x-csrf-token": ordinary.csrfToken,
      },
      method: "POST",
    });

    expect(response.status).toBe(401);
    expect(currentFoundation.auth.refreshSession).not.toHaveBeenCalled();
    expect(currentFoundation.auth.setPassword).not.toHaveBeenCalled();
  });

  it("returns a stable conflict without touching the provider when password is already linked", async () => {
    const currentFoundation = foundation();
    const current = googleReauthenticatedSession(currentFoundation, ["password", "google"]);

    const response = await currentFoundation.app.request("/v1/account/sign-in-methods/password", {
      body: JSON.stringify({ password: "correct horse battery staple" }),
      headers: {
        "content-type": "application/json",
        cookie: `huayi_session=${current.sessionId}`,
        origin: webOrigin,
        "x-csrf-token": current.csrfToken,
      },
      method: "POST",
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: expect.objectContaining({ code: "sign_in_method_already_linked" }),
    });
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(currentFoundation.auth.refreshSession).not.toHaveBeenCalled();
    expect(currentFoundation.auth.setPassword).not.toHaveBeenCalled();
  });
});
