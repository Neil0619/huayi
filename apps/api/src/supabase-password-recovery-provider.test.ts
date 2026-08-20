import { describe, expect, it, vi } from "vitest";

import { createSupabasePasswordRecoveryProvider } from "./supabase-password-recovery-provider.js";

function authClient(methods: Record<string, unknown>) {
  return { auth: methods } as never;
}

describe("Supabase password recovery provider", () => {
  it("starts recovery with an exact redirect and returns only per-flow PKCE state", async () => {
    const resetPasswordForEmail = vi.fn();
    const provider = createSupabasePasswordRecoveryProvider((storage) =>
      authClient({
        resetPasswordForEmail: resetPasswordForEmail.mockImplementation(async () => {
          await storage.setItem("pkce-code-verifier", "verifier-value");
          return { data: {}, error: null };
        }),
      }),
    );

    await expect(
      provider.begin({
        email: "learner@example.com",
        redirectTo: "https://api.example/v1/auth/password/recovery/confirm?flow=opaque-flow",
      }),
    ).resolves.toEqual({ authState: { "pkce-code-verifier": "verifier-value" } });
    expect(resetPasswordForEmail).toHaveBeenCalledWith("learner@example.com", {
      redirectTo: "https://api.example/v1/auth/password/recovery/confirm?flow=opaque-flow",
    });
  });

  it("restores recovery state for code exchange and returns a strict normalized identity", async () => {
    const provider = createSupabasePasswordRecoveryProvider((storage) =>
      authClient({
        exchangeCodeForSession: vi.fn(async (code) => {
          expect(code).toBe("provider-code");
          expect(await storage.getItem("pkce-code-verifier")).toBe("verifier-value");
          await storage.removeItem("pkce-code-verifier");
          await storage.setItem("provider-session", "recovery-session");
          return {
            data: {
              session: { refresh_token: "provider-refresh" },
              user: { email: " Learner@Example.COM ", id: "auth-user-a" },
            },
            error: null,
          };
        }),
      }),
    );

    await expect(
      provider.exchange({
        authState: { "pkce-code-verifier": "verifier-value" },
        code: "provider-code",
      }),
    ).resolves.toEqual({
      authState: { "provider-session": "recovery-session" },
      email: "learner@example.com",
      userId: "auth-user-a",
    });
  });

  it("updates a password only through restored recovery state", async () => {
    const updateUser = vi.fn();
    const provider = createSupabasePasswordRecoveryProvider((storage) =>
      authClient({
        updateUser: updateUser.mockImplementation(async () => {
          expect(await storage.getItem("provider-session")).toBe("recovery-session");
          await storage.setItem("provider-session", "rotated-session");
          return {
            data: { user: { email: "learner@example.com", id: "auth-user-a" } },
            error: null,
          };
        }),
      }),
    );

    await expect(
      provider.updatePassword({
        authState: { "provider-session": "recovery-session" },
        password: "correct horse battery staple",
      }),
    ).resolves.toEqual({
      authState: { "provider-session": "rotated-session" },
      userId: "auth-user-a",
    });
    expect(updateUser).toHaveBeenCalledWith({ password: "correct horse battery staple" });
  });

  it("converges provider errors and malformed provider identities on one safe failure", async () => {
    const expectedFault = {
      code: "authentication_required",
      message: "Password recovery could not be completed.",
    };
    const beginFailure = createSupabasePasswordRecoveryProvider(() =>
      authClient({
        resetPasswordForEmail: vi.fn().mockResolvedValue({
          data: null,
          error: new Error("provider reset detail"),
        }),
      }),
    );
    const exchangeFailure = createSupabasePasswordRecoveryProvider(() =>
      authClient({
        exchangeCodeForSession: vi.fn().mockResolvedValue({
          data: { session: null, user: { email: "learner@example.com", id: "auth-user-a" } },
          error: null,
        }),
      }),
    );
    const updateFailure = createSupabasePasswordRecoveryProvider(() =>
      authClient({
        updateUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
      }),
    );

    await expect(
      beginFailure.begin({ email: "learner@example.com", redirectTo: "https://api.example/fixed" }),
    ).rejects.toMatchObject(expectedFault);
    await expect(
      exchangeFailure.exchange({ authState: {}, code: "provider-code" }),
    ).rejects.toMatchObject(expectedFault);
    await expect(
      updateFailure.updatePassword({ authState: {}, password: "correct horse battery staple" }),
    ).rejects.toMatchObject(expectedFault);
  });
});
