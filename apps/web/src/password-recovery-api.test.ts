import { describe, expect, it, vi } from "vitest";

import { createWebIdentityApi } from "./identity-api.js";

const origin = "https://api.huayi.invalid";
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status,
  });

describe("Web password recovery API", () => {
  it("requests recovery without Cookie and parses only the uniform acceptance", async () => {
    const request = vi.fn(async () => json({ accepted: true }, 202));
    const api = createWebIdentityApi({ apiOrigin: origin, fetch: request });

    await expect(api.requestPasswordRecovery(" Learner@Example.COM ")).resolves.toEqual({
      accepted: true,
    });
    expect(request).toHaveBeenCalledWith(new URL("/v1/auth/password/recovery", origin), {
      body: JSON.stringify({ email: "learner@example.com" }),
      credentials: "omit",
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    const invalid = createWebIdentityApi({
      apiOrigin: origin,
      fetch: async () => json({ accepted: true, flow: "secret" }, 202),
    });
    await expect(invalid.requestPasswordRecovery("learner@example.com")).rejects.toThrow();
  });

  it("reads only the purpose session and completes with Cookie plus CSRF", async () => {
    const session = {
      csrfToken: "c".repeat(32),
      expiresAt: "2026-08-14T10:15:00.000Z",
    };
    const request = vi
      .fn()
      .mockResolvedValueOnce(json(session))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const api = createWebIdentityApi({ apiOrigin: origin, fetch: request });

    await expect(api.getPasswordRecoverySession()).resolves.toEqual(session);
    expect(request).toHaveBeenNthCalledWith(
      1,
      new URL("/v1/auth/password/recovery/session", origin),
      {
        credentials: "include",
        headers: { Accept: "application/json" },
      },
    );
    await expect(
      api.completePasswordRecovery("correct horse battery staple", "c".repeat(32)),
    ).resolves.toBeUndefined();
    expect(request).toHaveBeenNthCalledWith(
      2,
      new URL("/v1/auth/password/recovery/complete", origin),
      {
        body: JSON.stringify({ password: "correct horse battery staple" }),
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": "c".repeat(32),
        },
        method: "POST",
      },
    );
  });

  it("fails before fetch for invalid email, password, or CSRF proof", async () => {
    const request = vi.fn();
    const api = createWebIdentityApi({ apiOrigin: origin, fetch: request });

    await expect(api.requestPasswordRecovery("not-an-email")).rejects.toThrow();
    await expect(api.completePasswordRecovery("short", "c".repeat(32))).rejects.toThrow();
    await expect(
      api.completePasswordRecovery("correct horse battery staple", "short"),
    ).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
  });
});
