import { describe, expect, it, vi } from "vitest";

import { createWebIdentityApi } from "./identity-api.js";

const apiOrigin = "https://api.huayi.example";

describe("device revocation across Web tabs", () => {
  it("can approve an open pairing form after disconnect rotates the shared proof", async () => {
    let version = 0;
    const request = vi.fn<typeof fetch>(async (input, init) => {
      if (new URL(String(input)).pathname === "/v1/auth/csrf") {
        return Response.json({ access: "full", csrfToken: String(++version).padStart(32, "c") });
      }
      return new Headers(init?.headers).get("X-CSRF-Token") === String(version).padStart(32, "c")
        ? new Response(null, { status: 204 })
        : Response.json(
            { error: { code: "forbidden", message: "Invalid proof.", requestId: "pairing" } },
            { status: 403 },
          );
    });
    const api = createWebIdentityApi({ apiOrigin, fetch: request });
    await api.bootstrap();
    await api.revokeExtensionSession("old-session");

    await expect(
      api.approvePairing("pairing-1", {
        cloudWordCopyMode: "enabled",
        deviceLabel: "Chrome",
        expectedPreferencesRevision: 1,
        extensionQueryModelMode: "platform",
        studyCaptureMode: "manual",
      }),
    ).resolves.toBeUndefined();
  });

  it("refreshes proof after another tab has rotated the session CSRF token", async () => {
    let csrfToken = "a".repeat(32);
    let connected = true;
    const request = vi.fn<typeof fetch>(async (input, init) => {
      if (new URL(String(input)).pathname === "/v1/auth/csrf") {
        return Response.json({ access: "full", csrfToken });
      }
      if (new Headers(init?.headers).get("X-CSRF-Token") !== csrfToken) {
        return Response.json(
          { error: { code: "forbidden", message: "Invalid proof.", requestId: "revoke" } },
          { status: 403 },
        );
      }
      connected = false;
      return new Response(null, { status: 204 });
    });
    const api = createWebIdentityApi({ apiOrigin, fetch: request });
    await api.bootstrap();
    csrfToken = "b".repeat(32);

    await api.revokeExtensionSession("session-1");

    expect(connected).toBe(false);
    expect(request).toHaveBeenLastCalledWith(
      new URL("/v1/extension-sessions/session-1", apiOrigin),
      {
        credentials: "include",
        headers: { "X-CSRF-Token": csrfToken },
        method: "DELETE",
      },
    );
  });

  it("does not revoke or retry when refreshing the login proof fails", async () => {
    const request = vi.fn<typeof fetch>(async () => new Response(null, { status: 401 }));
    const api = createWebIdentityApi({ apiOrigin, fetch: request });

    await expect(api.revokeExtensionSession("session-1")).rejects.toMatchObject({ status: 401 });
    expect(request).toHaveBeenCalledTimes(1);
    expect(new URL(String(request.mock.calls[0]?.[0])).pathname).toBe("/v1/auth/csrf");
  });
});
