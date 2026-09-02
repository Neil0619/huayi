import { describe, expect, it, vi } from "vitest";

import { createSupabasePasswordRecoveryProvider } from "./supabase-password-recovery-provider.js";

function authClient(methods: Record<string, unknown>) {
  return { auth: methods } as never;
}

describe("Supabase password recovery provider", () => {
  it("starts recovery with an exact redirect without retaining an unused PKCE verifier", async () => {
    const resetPasswordForEmail = vi.fn();
    const provider = createSupabasePasswordRecoveryProvider(() =>
      authClient({
        resetPasswordForEmail: resetPasswordForEmail.mockImplementation(async () => {
          return { data: {}, error: null };
        }),
      }),
    );

    await expect(
      provider.begin({
        email: "learner@example.com",
        redirectTo: "https://api.example/v1/auth/password/recovery/confirm?flow=opaque-flow",
      }),
    ).resolves.toEqual({ authState: {} });
    expect(resetPasswordForEmail).toHaveBeenCalledWith("learner@example.com", {
      redirectTo: "https://api.example/v1/auth/password/recovery/confirm?flow=opaque-flow",
    });
  });

  it("verifies the email token hash without depending on Supabase PKCE flow state", async () => {
    const verifyOtp = vi.fn();
    const provider = createSupabasePasswordRecoveryProvider((storage) =>
      authClient({
        verifyOtp: verifyOtp.mockImplementation(async (input) => {
          expect(input).toEqual({ token_hash: "provider-token-hash", type: "recovery" });
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
        authState: {},
        code: "provider-token-hash",
      }),
    ).resolves.toEqual({
      authState: { "provider-session": "recovery-session" },
      email: "learner@example.com",
      userId: "auth-user-a",
    });
    expect(verifyOtp).toHaveBeenCalledOnce();
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
        verifyOtp: vi.fn().mockResolvedValue({
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
