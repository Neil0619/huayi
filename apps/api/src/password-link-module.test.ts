import { describe, expect, it, vi } from "vitest";

import type { AuthProvider } from "./auth-provider.js";
import { CloudFault } from "./cloud-fault.js";
import { createIdentityModule } from "./identity-module.js";
import { createPasswordLinkModule } from "./password-link-module.js";
import { DeterministicSecrets, MutableClock } from "./test-support/security-fakes.js";

describe("PasswordLink module", () => {
  it("resumes a persisted refresh after provider failure without rotating again", async () => {
    const clock = new MutableClock("2026-08-12T00:00:00.000Z");
    const identity = createIdentityModule({
      clock,
      pepper: "test-pepper-at-least-32-characters",
      secrets: new DeterministicSecrets(),
      webOrigin: "https://app.huayi.example",
    });
    identity.createProfile("auth-user-a", "learner@example.com", ["google"]);
    const ordinary = identity.createWebSession("auth-user-a", "protected:initial-refresh");
    const reauthentication = identity.createGoogleReauthentication(
      ordinary.sessionId,
      "https://app.huayi.example",
      ordinary.csrfToken,
    );
    identity.continueGoogleReauthentication(reauthentication.flowId, ordinary.sessionId);
    identity.saveAuthFlowState(reauthentication.flowId, "state:google-reauthentication");
    const current = identity.completeGoogleReauthentication(
      reauthentication.flowId,
      ordinary.sessionId,
      "auth-user-a",
      "protected:google-reauthenticated-refresh",
    );
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
      setPassword: vi
        .fn()
        .mockRejectedValueOnce(new CloudFault("authentication_required", "Password rejected."))
        .mockResolvedValueOnce({ authState: {}, userId: "auth-user-a" }),
      signInWithPassword: vi.fn(),
    };
    const link = createPasswordLinkModule({
      auth,
      protectRefreshToken: (value) => `protected:${value}`,
      protectTransientAuthState: (value) => `state:${value}`,
      repository: identity.passwordLink,
      unprotectRefreshToken: (value) => value.replace(/^protected:/u, ""),
      unprotectTransientAuthState: (value) => value.replace(/^state:/u, ""),
    });

    await expect(
      link.execute(
        current.sessionId,
        "https://app.huayi.example",
        current.csrfToken,
        "first rejected password",
      ),
    ).rejects.toThrow("Password rejected.");
    expect(auth.refreshSession).toHaveBeenCalledOnce();

    clock.advance(31_000);
    const completed = await link.execute(
      current.sessionId,
      "https://app.huayi.example",
      current.csrfToken,
      "correct horse battery staple",
    );
    expect(auth.refreshSession).toHaveBeenCalledOnce();
    expect(auth.setPassword).toHaveBeenLastCalledWith({
      authState: { "provider-session": "refreshed-state" },
      password: "correct horse battery staple",
    });
    expect(completed.methods.map(({ method }) => method)).toEqual(["password", "google"]);
  });
});
