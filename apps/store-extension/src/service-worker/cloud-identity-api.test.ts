import { describe, expect, it, vi } from "vitest";

import { createCloudIdentityApi, type CloudIdentityApiError } from "./cloud-identity-api.js";
import { extensionSessionHeaders } from "../cloud/extension-session-headers.js";

const origin = "https://api.huayi.invalid";
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status,
  });

describe("Store SW cloud identity API", () => {
  it("uses strict public pairing contracts without Cookie credentials", async () => {
    const request = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      json({
        expiresAt: "2026-08-13T01:00:00.000Z",
        id: "pairing-1",
        pairingPath: "/pair-extension/pairing-1",
        status: "pending",
      }),
    );
    const api = createCloudIdentityApi({
      apiOrigin: origin,
      clientVersion: "1.0.0",
      fetch: request,
    });

    await api.createPairing({
      installIdHash: "i".repeat(32),
      pkceChallenge: "c".repeat(43),
      state: "s".repeat(32),
    });
    expect(request).toHaveBeenCalledWith(new URL("/v1/extension-pairings", origin), {
      body: JSON.stringify({
        installIdHash: "i".repeat(32),
        pkceChallenge: "c".repeat(43),
        state: "s".repeat(32),
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
  });

  it("strictly parses the one-time exchange response", async () => {
    const api = createCloudIdentityApi({
      apiOrigin: origin,
      clientVersion: "1.0.0",
      fetch: async () =>
        json({
          expiresAt: "2026-09-13T01:00:00.000Z",
          preferences: {
            cloudWordCopyMode: "enabled",
            extensionQueryModelMode: "platform",
            revision: 1,
            studyCaptureMode: "manual",
            updatedAt: "2026-08-13T00:00:00.000Z",
          },
          sessionToken: "t".repeat(32),
        }),
    });

    await expect(
      api.exchangePairing("pairing-1", {
        pkceVerifier: "v".repeat(43),
        state: "s".repeat(32),
      }),
    ).resolves.toMatchObject({ sessionToken: "t".repeat(32) });
    await expect(
      api.exchangePairing("../escape", {
        pkceVerifier: "v".repeat(43),
        state: "s".repeat(32),
      }),
    ).rejects.toThrow();
  });

  it("polls the encoded fixed route and preserves only a safe error code", async () => {
    const request = vi.fn(async () =>
      json(
        {
          error: {
            code: "not_found",
            message: "must not reach the client error",
            requestId: "request-1",
          },
        },
        404,
      ),
    );
    const api = createCloudIdentityApi({
      apiOrigin: origin,
      clientVersion: "1.0.0",
      fetch: request,
    });

    await expect(api.getPairing("pairing-1")).rejects.toMatchObject({
      code: "not_found",
      status: 404,
    } satisfies Partial<CloudIdentityApiError>);
    expect(request).toHaveBeenCalledWith(new URL("/v1/extension-pairings/pairing-1", origin), {
      headers: { Accept: "application/json" },
    });
    const before = request.mock.calls.length;
    await expect(api.getPairing("../escape")).rejects.toThrow();
    expect(request).toHaveBeenCalledTimes(before);
  });

  it("reads a strict extension-only preference snapshot with the session header", async () => {
    const request = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      json({
        cloudWordCopyMode: "disabled",
        extensionQueryModelMode: "byok",
        revision: 4,
        studyCaptureMode: "automatic",
        updatedAt: "2026-08-13T02:00:00.000Z",
      }),
    );
    const api = createCloudIdentityApi({
      apiOrigin: origin,
      clientVersion: "1.0.0",
      fetch: request,
    });

    await expect(api.getExtensionPreferences("t".repeat(32))).resolves.toMatchObject({
      extensionQueryModelMode: "byok",
      revision: 4,
    });
    expect(request.mock.calls[0]?.[1]).toMatchObject({
      credentials: "omit",
      headers: expect.objectContaining({
        Authorization: `HuayiExtension ${"t".repeat(32)}`,
        "X-Huayi-Client-Version": "1.0.0",
      }),
    });
  });

  it("revokes the current Extension session with no body or Cookie credentials", async () => {
    const request = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response(null, { status: 204 }));
    const api = createCloudIdentityApi({
      apiOrigin: origin,
      clientVersion: "0.1.0",
      fetch: request,
    });

    await expect(api.disconnectExtensionSession("t".repeat(32))).resolves.toBeUndefined();
    expect(request).toHaveBeenCalledWith(new URL("/v1/extension-session", origin), {
      credentials: "omit",
      headers: extensionSessionHeaders("t".repeat(32), "0.1.0"),
      method: "DELETE",
    });
  });
});
