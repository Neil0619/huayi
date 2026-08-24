import { describe, expect, it, vi } from "vitest";

import { contractFixtures } from "@huayi/cloud-contracts";

import { createWebIdentityApi, type WebIdentityApiError } from "./identity-api.js";

const origin = "https://api.huayi.invalid";
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status,
  });

describe("Web identity API", () => {
  it("reads the strict current account snapshot through the fixed Cookie route", async () => {
    const account = {
      email: "learner@example.com",
      extensionSessions: [],
      minSupportedExtensionVersion: "1.0.0",
      preferences: {
        cloudWordCopyMode: "enabled",
        dailyGoal: 5,
        extensionQueryModelMode: "platform",
        revision: 1,
        studyCaptureMode: "manual",
        timezone: "UTC",
        updatedAt: "2026-08-13T10:00:00.000Z",
      },
    };
    const request = vi.fn(async () => json(account));
    const api = createWebIdentityApi({ apiOrigin: origin, fetch: request });

    await expect(api.getAccount()).resolves.toEqual(account);
    expect(request).toHaveBeenCalledWith(new URL("/v1/account", origin), {
      credentials: "include",
      headers: { Accept: "application/json" },
    });
  });

  it("reads only the strict account sign-in method projection", async () => {
    const methods = {
      methods: [{ linkedAt: "2026-08-14T00:00:00.000Z", method: "password" }],
    };
    const request = vi.fn(async () => json(methods));
    const api = createWebIdentityApi({ apiOrigin: origin, fetch: request });

    await expect(api.getAccountSignInMethods()).resolves.toEqual(methods);
    expect(request).toHaveBeenCalledWith(new URL("/v1/account/sign-in-methods", origin), {
      credentials: "include",
      headers: { Accept: "application/json" },
    });
    const invalid = createWebIdentityApi({
      apiOrigin: origin,
      fetch: async () => json({ methods: [{ ...methods.methods[0], token: "secret" }] }),
    });
    await expect(invalid.getAccountSignInMethods()).rejects.toThrow();
  });

  it("uses fixed same-API recent-auth and link routes with Cookie and CSRF", async () => {
    const methods = {
      methods: [
        { linkedAt: "2026-08-14T00:00:00.000Z", method: "password" },
        { linkedAt: "2026-08-14T00:01:00.000Z", method: "google" },
      ],
    };
    const request = vi
      .fn()
      .mockResolvedValueOnce(json({ access: "full", csrfToken: "n".repeat(32) }))
      .mockResolvedValueOnce(json({ continuePath: "/v1/account/sign-in-methods/google:continue" }))
      .mockResolvedValueOnce(json({ continuePath: "/v1/auth/reauthenticate/google/continue" }))
      .mockResolvedValueOnce(json(methods));
    const api = createWebIdentityApi({ apiOrigin: origin, fetch: request });

    await expect(
      api.reauthenticatePassword("correct horse battery staple", "c".repeat(32)),
    ).resolves.toEqual({ access: "full", csrfToken: "n".repeat(32) });
    await expect(api.startGoogleLink("n".repeat(32))).resolves.toEqual({
      continueUrl: "https://api.huayi.invalid/v1/account/sign-in-methods/google:continue",
    });
    await expect(api.startGoogleReauthentication("n".repeat(32))).resolves.toEqual({
      continueUrl: "https://api.huayi.invalid/v1/auth/reauthenticate/google/continue",
    });
    await expect(api.linkPassword("correct horse battery staple", "n".repeat(32))).resolves.toEqual(
      methods,
    );
    for (const call of request.mock.calls) {
      expect(call[1]).toMatchObject({ credentials: "include", method: "POST" });
      expect(call[1]?.headers).toMatchObject({ "X-CSRF-Token": expect.any(String) });
    }
    expect(JSON.stringify(request.mock.calls)).not.toContain("learner@example.com");
  });

  it("reads and updates strict account preferences through Cookie and CSRF", async () => {
    const response = {
      cloudWordCopyMode: "enabled",
      dailyGoal: 5,
      extensionQueryModelMode: "byok",
      revision: 2,
      studyCaptureMode: "manual",
      timezone: "Asia/Shanghai",
      updatedAt: "2026-08-13T10:00:00.000Z",
    };
    const input = {
      dailyGoal: 5,
      expectedRevision: 1,
      extensionQueryModelMode: "byok" as const,
      timezone: "Asia/Shanghai",
    };
    const request = vi.fn(async () => json(response));
    const api = createWebIdentityApi({ apiOrigin: origin, fetch: request });

    await expect(api.getAccountPreferences()).resolves.toEqual(response);
    expect(request).toHaveBeenNthCalledWith(1, new URL("/v1/account/preferences", origin), {
      credentials: "include",
      headers: { Accept: "application/json" },
    });
    await expect(api.updateAccountPreferences(input, "c".repeat(32))).resolves.toEqual(response);
    expect(request).toHaveBeenNthCalledWith(2, new URL("/v1/account/preferences", origin), {
      body: JSON.stringify(input),
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": "c".repeat(32),
      },
      method: "PATCH",
    });
  });

  it("reads the strict account quota through the fixed Cookie route", async () => {
    const request = vi.fn(async () => json(contractFixtures.quota));
    const api = createWebIdentityApi({ apiOrigin: origin, fetch: request });

    await expect(api.getQuota()).resolves.toEqual(contractFixtures.quota);
    expect(request).toHaveBeenCalledWith(new URL("/v1/quota", origin), {
      credentials: "include",
      headers: { Accept: "application/json" },
    });

    const invalid = createWebIdentityApi({
      apiOrigin: origin,
      fetch: async () => json({ ...contractFixtures.quota, ownerUserId: "attacker" }),
    });
    await expect(invalid.getQuota()).rejects.toThrow();
  });
  it("bootstraps the Cookie session through strict CSRF response parsing", async () => {
    const request = vi.fn(async () => json({ access: "full", csrfToken: "c".repeat(32) }));
    const api = createWebIdentityApi({ apiOrigin: origin, fetch: request });

    await expect(api.bootstrap()).resolves.toEqual({
      access: "full",
      csrfToken: "c".repeat(32),
    });
    expect(request).toHaveBeenCalledWith(new URL("/v1/auth/csrf", origin), {
      credentials: "include",
      headers: { Accept: "application/json" },
    });
  });

  it("preserves a safe authentication code without exposing response content", async () => {
    const api = createWebIdentityApi({
      apiOrigin: origin,
      fetch: async () =>
        json(
          {
            error: {
              code: "authentication_required",
              message: "hidden",
              requestId: "request-1",
            },
          },
          401,
        ),
    });

    await expect(api.bootstrap()).rejects.toMatchObject({
      code: "authentication_required",
    } satisfies Partial<WebIdentityApiError>);
  });

  it("preserves the stable already-linked conflict for stale account views", async () => {
    const api = createWebIdentityApi({
      apiOrigin: origin,
      fetch: async () =>
        json(
          {
            error: {
              code: "sign_in_method_already_linked",
              message: "hidden",
              requestId: "request-1",
            },
          },
          409,
        ),
    });

    await expect(
      api.linkPassword("correct horse battery staple", "c".repeat(32)),
    ).rejects.toMatchObject({
      code: "sign_in_method_already_linked",
      status: 409,
    } satisfies Partial<WebIdentityApiError>);
  });

  it("approves only a strict pairing through Cookie, Origin, and CSRF", async () => {
    const request = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async () => new Response(null, { status: 204 }),
    );
    const api = createWebIdentityApi({ apiOrigin: origin, fetch: request });

    const input = {
      cloudWordCopyMode: "enabled" as const,
      deviceLabel: "Work Mac",
      expectedPreferencesRevision: 1,
      extensionQueryModelMode: "platform" as const,
      studyCaptureMode: "manual" as const,
    };
    await api.approvePairing("pairing-1", input, "c".repeat(32));
    expect(request).toHaveBeenCalledWith(
      new URL("/v1/extension-pairings/pairing-1/approve", origin),
      expect.objectContaining({
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": "c".repeat(32),
        },
        method: "POST",
      }),
    );
    expect(JSON.parse(String(request.mock.calls[0]?.[1]?.body))).toEqual(input);
    await expect(api.approvePairing("../escape", input, "c".repeat(32))).rejects.toThrow();
  });

  it("lists strict account-owned device sessions with the Web Cookie", async () => {
    const response = {
      items: [
        {
          createdAt: "2026-08-13T00:00:00.000Z",
          deviceLabel: "Writing laptop",
          expiresAt: "2026-11-13T00:00:00.000Z",
          id: "session-1",
          lastUsedAt: null,
        },
      ],
    };
    const request = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async () => json(response),
    );
    const api = createWebIdentityApi({ apiOrigin: origin, fetch: request });

    await expect(api.listExtensionSessions()).resolves.toEqual(response);
    expect(request).toHaveBeenCalledWith(new URL("/v1/extension-sessions", origin), {
      credentials: "include",
      headers: { Accept: "application/json" },
    });
  });

  it("revokes one validated server session through Cookie, Origin, and CSRF", async () => {
    const request = vi.fn(async () => new Response(null, { status: 204 }));
    const api = createWebIdentityApi({ apiOrigin: origin, fetch: request });

    await api.revokeExtensionSession("session-1", "c".repeat(32));
    expect(request).toHaveBeenCalledWith(new URL("/v1/extension-sessions/session-1", origin), {
      credentials: "include",
      headers: { "X-CSRF-Token": "c".repeat(32) },
      method: "DELETE",
    });
    const before = request.mock.calls.length;
    await expect(api.revokeExtensionSession("../escape", "c".repeat(32))).rejects.toThrow();
    expect(request).toHaveBeenCalledTimes(before);
  });

  it("claims an invitation and keeps the claim ticket in the JSON response only", async () => {
    const response = {
      claimTicket: "c".repeat(32),
      expiresAt: "2026-08-13T01:00:00.000Z",
    };
    const request = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async () => json(response),
    );
    const api = createWebIdentityApi({ apiOrigin: origin, fetch: request });

    await expect(api.claimInvitation("i".repeat(32))).resolves.toEqual(response);
    expect(request).toHaveBeenCalledWith(new URL("/v1/invitations/claim", origin), {
      body: JSON.stringify({ invitationToken: "i".repeat(32) }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
      referrerPolicy: "no-referrer",
    });
    expect(String(request.mock.calls[0]?.[0])).not.toContain("i".repeat(32));
  });

  it("registers and logs in with strict password bodies and Cookie responses", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(json({ emailConfirmationRequired: true }, 202))
      .mockResolvedValueOnce(
        json({
          access: "full",
          csrfToken: "r".repeat(32),
          emailConfirmationRequired: false,
        }),
      )
      .mockResolvedValueOnce(json({ access: "full", csrfToken: "c".repeat(32) }));
    const api = createWebIdentityApi({ apiOrigin: origin, fetch: request });

    await expect(
      api.registerPassword("c".repeat(32), "learner@example.com", "password long enough"),
    ).resolves.toEqual({ emailConfirmationRequired: true });
    await expect(
      api.resumePasswordRegistration("i".repeat(43), "learner@example.com", "password long enough"),
    ).resolves.toMatchObject({ access: "full", emailConfirmationRequired: false });
    await expect(api.loginPassword("learner@example.com", "password long enough")).resolves.toEqual(
      { access: "full", csrfToken: "c".repeat(32) },
    );
    expect(request.mock.calls[0]?.[1]).toMatchObject({ credentials: "include", method: "POST" });
    expect(request).toHaveBeenNthCalledWith(
      2,
      new URL("/v1/auth/password/register/resume", origin),
      expect.objectContaining({
        body: JSON.stringify({
          email: "learner@example.com",
          invitationToken: "i".repeat(43),
          password: "password long enough",
        }),
      }),
    );
    expect(request.mock.calls[1]?.[1]?.body).not.toContain("claimTicket");
    expect(request.mock.calls[1]?.[1]?.body).not.toContain("userId");
    expect(request.mock.calls[2]?.[1]).toMatchObject({ credentials: "include", method: "POST" });
    expect(api.googleAuthStartUrl).toBe("https://api.huayi.invalid/v1/auth/google/start");
  });

  it("resends signup confirmation with only the memory-held invitation token", async () => {
    const request = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async () => json({ accepted: true }, 202),
    );
    const api = createWebIdentityApi({ apiOrigin: origin, fetch: request });

    await expect(api.resendPasswordRegistration("i".repeat(43))).resolves.toEqual({
      accepted: true,
    });
    expect(request).toHaveBeenCalledWith(new URL("/v1/auth/password/register/resend", origin), {
      body: JSON.stringify({ invitationToken: "i".repeat(43) }),
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    expect(String(request.mock.calls[0]?.[0])).not.toContain("i".repeat(43));
  });

  it.each([
    "http://api.huayi.invalid",
    "https://user@api.huayi.invalid",
    "https://api.huayi.invalid/base",
  ])("rejects a non-origin API configuration before any request: %s", (apiOrigin) => {
    const request = vi.fn();
    expect(() => createWebIdentityApi({ apiOrigin, fetch: request })).toThrow(
      "Huayi API origin is invalid",
    );
    expect(request).not.toHaveBeenCalled();
  });
});
