import { describe, expect, it, vi } from "vitest";

import { createSupabaseAuthProvider } from "./supabase-auth-provider.js";

function authClient(methods: Record<string, unknown>) {
  return { auth: methods } as never;
}

describe("Supabase Auth provider", () => {
  it("persists per-flow PKCE storage and restores it for code exchange", async () => {
    const storages: {
      getItem(key: string): Promise<string | null>;
      setItem(key: string, value: string): Promise<void>;
    }[] = [];
    const provider = createSupabaseAuthProvider((storage) => {
      storages.push(storage);
      return authClient({
        exchangeCodeForSession: vi.fn(async () => {
          expect(await storage.getItem("pkce-code-verifier")).toBe("verifier-value");
          return {
            data: {
              session: { refresh_token: "refresh" },
              user: { email: "Learner@Example.COM", id: "auth-user-a" },
            },
            error: null,
          };
        }),
        signInWithOAuth: vi.fn(async () => {
          await storage.setItem("pkce-code-verifier", "verifier-value");
          return {
            data: { provider: "google", url: "https://project.supabase.co/auth/v1/authorize" },
            error: null,
          };
        }),
        signInWithPassword: vi.fn(),
        signUp: vi.fn(),
      });
    });

    const started = await provider.beginGoogle({
      redirectTo: "https://api/callback?flow=opaque-flow-id",
    });
    expect(started).toEqual({
      authState: { "pkce-code-verifier": "verifier-value" },
      redirectUrl: "https://project.supabase.co/auth/v1/authorize",
    });
    await expect(
      provider.completeCode({ authState: started.authState, code: "auth-code" }),
    ).resolves.toEqual({
      email: "learner@example.com",
      refreshToken: "refresh",
      userId: "auth-user-a",
    });
    expect(storages).toHaveLength(2);
  });

  it("keeps invitation proof out of provider metadata and normalizes login failures", async () => {
    const signUp = vi.fn().mockResolvedValue({
      data: { session: null, user: { email: "learner@example.com", id: "auth-user-a" } },
      error: null,
    });
    const provider = createSupabaseAuthProvider(() =>
      authClient({
        exchangeCodeForSession: vi.fn(),
        signInWithOAuth: vi.fn(),
        signInWithPassword: vi.fn().mockResolvedValue({
          data: { session: null, user: null },
          error: new Error("provider detail"),
        }),
        signUp,
      }),
    );

    await expect(
      provider.registerPassword({
        email: "learner@example.com",
        password: "correct horse battery staple",
        redirectTo: "https://api/callback",
      }),
    ).resolves.toEqual({
      authState: {},
      email: "learner@example.com",
      emailConfirmationRequired: true,
      userId: "auth-user-a",
    });
    expect(JSON.stringify(signUp.mock.calls)).not.toContain("claim-ticket");
    await expect(
      provider.signInWithPassword({ email: "learner@example.com", password: "wrong-password" }),
    ).rejects.toMatchObject({
      code: "authentication_required",
      message: "Email or password is invalid.",
    });
  });

  it("verifies password registration only from an explicit email OTP submission", async () => {
    const verifyOtp = vi.fn().mockResolvedValue({
      data: {
        session: { refresh_token: "refresh" },
        user: { email: "Learner@Example.COM", id: "auth-user-a" },
      },
      error: null,
    });
    const provider = createSupabaseAuthProvider(() => authClient({ verifyOtp }));

    await expect(
      provider.verifyPasswordRegistrationOtp({
        email: "learner@example.com",
        token: "123456",
      }),
    ).resolves.toEqual({
      email: "learner@example.com",
      refreshToken: "refresh",
      userId: "auth-user-a",
    });
    expect(verifyOtp).toHaveBeenCalledWith({
      email: "learner@example.com",
      token: "123456",
      type: "email",
    });
  });

  it("resends only the existing signup confirmation to the rotated flow", async () => {
    const resend = vi.fn().mockResolvedValue({ data: {}, error: null });
    const provider = createSupabaseAuthProvider(() => authClient({ resend }));

    await expect(
      provider.resendPasswordRegistrationOtp({
        email: "learner@example.com",
        redirectTo: "https://api.example/v1/auth/password/confirm?flow=rotated-flow",
      }),
    ).resolves.toBeUndefined();
    expect(resend).toHaveBeenCalledWith({
      email: "learner@example.com",
      options: {
        emailRedirectTo: "https://api.example/v1/auth/password/confirm?flow=rotated-flow",
      },
      type: "signup",
    });

    resend.mockResolvedValueOnce({ data: null, error: new Error("provider detail") });
    await expect(
      provider.resendPasswordRegistrationOtp({
        email: "learner@example.com",
        redirectTo: "https://api.example/v1/auth/password/confirm?flow=another-flow",
      }),
    ).rejects.toMatchObject({
      code: "authentication_required",
      message: "Email verification could not be resent.",
    });
  });

  it("refreshes a server-side session before starting manual Google identity linking", async () => {
    const provider = createSupabaseAuthProvider((storage) =>
      authClient({
        linkIdentity: vi.fn(async (command) => {
          expect(command).toEqual({
            options: {
              redirectTo: "https://api.example/v1/account/sign-in-methods/google:callback",
              skipBrowserRedirect: true,
            },
            provider: "google",
          });
          expect(await storage.getItem("provider-session")).toBe("refreshed-state");
          await storage.setItem("pkce-code-verifier", "link-verifier");
          return { data: { url: "https://accounts.google.test/link" }, error: null };
        }),
        refreshSession: vi.fn(async ({ refresh_token: refreshToken }) => {
          expect(refreshToken).toBe("current-refresh");
          await storage.setItem("provider-session", "refreshed-state");
          return {
            data: {
              session: { refresh_token: "rotated-refresh" },
              user: { email: "Learner@Example.COM", id: "auth-user-a" },
            },
            error: null,
          };
        }),
      }),
    );

    const refreshed = await provider.refreshSession({ refreshToken: "current-refresh" });
    expect(refreshed).toEqual({
      authState: { "provider-session": "refreshed-state" },
      session: {
        email: "learner@example.com",
        refreshToken: "rotated-refresh",
        userId: "auth-user-a",
      },
    });
    await expect(
      provider.beginGoogleLink({
        authState: refreshed.authState,
        redirectTo: "https://api.example/v1/account/sign-in-methods/google:callback",
      }),
    ).resolves.toEqual({
      authState: {
        "pkce-code-verifier": "link-verifier",
        "provider-session": "refreshed-state",
      },
      redirectUrl: "https://accounts.google.test/link",
    });
  });

  it("sets a password only through a restored authenticated provider session", async () => {
    const provider = createSupabaseAuthProvider((storage) =>
      authClient({
        updateUser: vi.fn(async (attributes) => {
          expect(attributes).toEqual({ password: "correct horse battery staple" });
          expect(await storage.getItem("provider-session")).toBe("authenticated-state");
          return {
            data: { user: { email: "learner@example.com", id: "auth-user-a" } },
            error: null,
          };
        }),
      }),
    );

    await expect(
      provider.setPassword({
        authState: { "provider-session": "authenticated-state" },
        password: "correct horse battery staple",
      }),
    ).resolves.toEqual({
      authState: { "provider-session": "authenticated-state" },
      userId: "auth-user-a",
    });
  });
});
