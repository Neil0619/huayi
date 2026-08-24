import { describe, expect, it, vi } from "vitest";

import type { AuthProvider } from "./auth-provider.js";
import { CloudFault } from "./cloud-fault.js";
import { createGoogleLinkModule } from "./google-link-module.js";
import { createIdentityModule } from "./identity-module.js";
import { DeterministicSecrets, MutableClock } from "./test-support/security-fakes.js";

describe("GoogleLink module", () => {
  it("resumes from persisted refreshed state without consuming another refresh generation", async () => {
    const clock = new MutableClock("2026-08-12T00:00:00.000Z");
    const identity = createIdentityModule({
      clock,
      pepper: "test-pepper-at-least-32-characters",
      secrets: new DeterministicSecrets(),
      webOrigin: "https://app.huayi.example",
    });
    identity.createProfile("auth-user-a", "learner@example.com", ["password"]);
    const ordinary = identity.createWebSession("auth-user-a", "protected:initial-refresh");
    const current = identity.completePasswordReauthentication(
      ordinary.sessionId,
      "auth-user-a",
      "protected:reauthenticated-refresh",
    );
    const auth: AuthProvider = {
      beginGoogle: vi.fn(),
      beginGoogleLink: vi
        .fn()
        .mockRejectedValueOnce(new CloudFault("authentication_required", "Provider unavailable."))
        .mockResolvedValueOnce({
          authState: { codeVerifier: "started-state" },
          redirectUrl: "https://accounts.google.test/link",
        }),
      completeCode: vi.fn().mockResolvedValue({
        email: "other@example.com",
        refreshToken: "untrusted-refresh",
        userId: "different-provider-user",
      }),
      refreshSession: vi.fn().mockResolvedValue({
        authState: { providerRefresh: "refreshed-state" },
        session: {
          email: "learner@example.com",
          refreshToken: "rotated-provider-refresh",
          userId: "auth-user-a",
        },
      }),
      registerPassword: vi.fn(),
      resendPasswordRegistrationOtp: vi.fn(),
      setPassword: vi.fn(),
      signInWithPassword: vi.fn(),
      verifyPasswordRegistrationOtp: vi.fn(),
    };
    const link = createGoogleLinkModule({
      apiOrigin: "https://api.huayi.example",
      auth,
      protectRefreshToken: (value) => `protected:${value}`,
      protectTransientAuthState: (value) => `state:${value}`,
      repository: identity.googleLink,
      unprotectRefreshToken: (value) => value.replace(/^protected:/u, ""),
      unprotectTransientAuthState: (value) => value.replace(/^state:/u, ""),
    });
    const flow = await link.create(
      current.sessionId,
      "https://app.huayi.example",
      current.csrfToken,
    );

    await expect(link.continue(flow.flowId, current.sessionId)).rejects.toThrow(
      "Provider unavailable.",
    );
    expect(auth.refreshSession).toHaveBeenCalledOnce();

    clock.advance(31_000);
    await expect(link.continue(flow.flowId, current.sessionId)).resolves.toEqual({
      redirectUrl: "https://accounts.google.test/link",
    });
    expect(auth.refreshSession).toHaveBeenCalledOnce();
    expect(auth.beginGoogleLink).toHaveBeenLastCalledWith({
      authState: { providerRefresh: "refreshed-state" },
      redirectTo: expect.stringContaining("/v1/account/sign-in-methods/google:callback?flow="),
    });

    await expect(link.complete(flow.flowId, current.sessionId, "provider-code")).rejects.toThrow(
      "Google link did not match.",
    );
    expect(identity.listSignInMethods("auth-user-a").map(({ method }) => method)).toEqual([
      "password",
    ]);
    expect(identity.authenticateWebSession(current.sessionId)).toMatchObject({
      userId: "auth-user-a",
    });
    await expect(link.complete(flow.flowId, current.sessionId, "replay-code")).rejects.toThrow(
      "Google link is unavailable.",
    );
  });
});
