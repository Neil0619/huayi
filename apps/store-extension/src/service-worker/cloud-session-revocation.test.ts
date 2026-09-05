import { STORE_MESSAGE_VERSION } from "@huayi/store-domain";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createCloudIdentityApi } from "./cloud-identity-api.js";
import { handleCloudSessionMessage } from "./cloud-session-handler.js";
import { createCloudSessionManager } from "./cloud-session-manager.js";
import { createExtensionPreferenceCache } from "./extension-preference-cache.js";
import { createExtensionSessionVault } from "./extension-session-vault.js";

const runtimeId = "a".repeat(32);
const origin = `chrome-extension://${runtimeId}`;
const session = {
  expiresAt: "2026-12-01T00:00:00.000Z",
  preferences: {
    cloudWordCopyMode: "enabled" as const,
    extensionQueryModelMode: "platform" as const,
    revision: 1,
    studyCaptureMode: "manual" as const,
    updatedAt: "2026-09-04T00:00:00.000Z",
  },
  token: "t".repeat(43),
};

afterEach(() => vi.unstubAllGlobals());

async function setup(status = 401) {
  vi.stubGlobal("location", { origin });
  const values = new Map<string, unknown>();
  const vault = createExtensionSessionVault({
    crypto: globalThis.crypto,
    deviceVault: { getDek: async () => new Uint8Array(32).fill(1) },
    storage: {
      delete: async (key) => {
        values.delete(key);
      },
      read: async (key) => values.get(key),
      write: async (key, value) => {
        values.set(key, value);
      },
    },
  });
  await vault.writeSession(session);
  const api = createCloudIdentityApi({
    apiOrigin: "https://api.huayi.invalid",
    clientVersion: "1.0.0",
    fetch: async (_input, init) => {
      expect(new Headers(init?.headers).get("Origin")).toBe(origin);
      if (init?.method === "DELETE") return new Response(null, { status: 204 });
      if (status === 0) throw new TypeError("offline");
      if (status === 200) return Response.json(session.preferences);
      return Response.json(
        {
          error: {
            code: status === 401 ? "authentication_required" : "forbidden",
            message: "safe fixture failure",
            requestId: "fixture-1",
          },
        },
        { status },
      );
    },
  });
  const clearAccountData = vi.fn(async () => undefined);
  const now = () => Date.parse("2026-09-04T01:00:00.000Z");
  const manager = createCloudSessionManager({
    api,
    clearSubmissions: clearAccountData,
    crypto: globalThis.crypto,
    now,
    open: vi.fn(),
    randomBytes: (length) => new Uint8Array(length),
    vault,
    webOrigin: "https://app.huayi.invalid",
  });
  const preferences = createExtensionPreferenceCache({ api, clearAccountData, now, vault });
  const options = {
    manager,
    runtimeId,
    schedulePoll: vi.fn(),
    sender: { id: runtimeId, url: `${origin}/popup.html` },
    syncPreferences: preferences.sync,
  };
  return {
    clearAccountData,
    manager,
    vault,
    sync: preferences.sync,
    status: () =>
      handleCloudSessionMessage(
        {
          messageVersion: STORE_MESSAGE_VERSION,
          type: "store/cloud-session-status",
        },
        options,
      ),
  };
}

describe("foreground account state after Web revocation", () => {
  it("clears the revoked encrypted session when reopening the popup", async () => {
    const context = await setup();
    await expect(context.status()).resolves.toMatchObject({ status: "connected" });
    await context.sync();
    await expect(context.status()).resolves.toMatchObject({ status: "disconnected" });
    expect(await context.vault.readSession()).toBeNull();
    expect(context.clearAccountData).toHaveBeenCalledOnce();
  });

  it.each([0, 403, 503])(
    "retains revocation proof when verification fails with %s",
    async (status) => {
      const context = await setup(status);
      await context.status().catch(() => undefined);
      await context.sync().catch(() => undefined);
      expect(await context.vault.readSession()).toEqual(session);
      expect(context.clearAccountData).not.toHaveBeenCalled();
    },
  );

  it("lets an already revoked session disconnect after the server's idempotent 204", async () => {
    const context = await setup();
    await expect(context.manager.disconnect()).resolves.toEqual({ status: "disconnected" });
    expect(await context.vault.readSession()).toBeNull();
  });
});
