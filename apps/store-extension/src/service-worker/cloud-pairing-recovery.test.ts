import { STORE_MESSAGE_VERSION } from "@huayi/store-domain";
import { describe, expect, it, vi } from "vitest";

import { createCloudSessionManager } from "./cloud-session-manager.js";
import { CloudIdentityApiError } from "./cloud-identity-api.js";
import { handleCloudSessionMessage } from "./cloud-session-handler.js";
import { createExtensionSessionVault } from "./extension-session-vault.js";

function setup() {
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
  let approved = false;
  let consumed = false;
  const pairing = {
    expiresAt: "2026-09-04T01:10:00.000Z",
    id: "pairing-recovery",
    pairingPath: "/pair-extension/pairing-recovery",
    status: "pending" as const,
  };
  const api = {
    createPairing: vi.fn(async () => pairing),
    getPairing: vi.fn(async () => ({
      ...pairing,
      status: approved ? ("approved" as const) : ("pending" as const),
    })),
    exchangePairing: vi.fn(async () => {
      if (consumed) throw new Error("Pairing was already consumed");
      consumed = true;
      return {
        expiresAt: "2026-12-01T01:00:00.000Z",
        sessionToken: "t".repeat(32),
        preferences: {
          cloudWordCopyMode: "enabled" as const,
          extensionQueryModelMode: "platform" as const,
          revision: 1,
          studyCaptureMode: "manual" as const,
          updatedAt: "2026-09-04T01:00:00.000Z",
        },
      };
    }),
    getExtensionPreferences: vi.fn(),
    disconnectExtensionSession: vi.fn(async () => undefined),
  };
  const open = vi.fn(async () => undefined);
  const manager = createCloudSessionManager({
    api,
    clearSubmissions: async () => undefined,
    crypto: globalThis.crypto,
    now: () => Date.parse("2026-09-04T01:00:00.000Z"),
    open,
    randomBytes: (length) => crypto.getRandomValues(new Uint8Array(length)),
    vault,
    webOrigin: "https://web.huayi.invalid",
  });
  return {
    api,
    approve: () => {
      approved = true;
    },
    manager,
    open,
    vault,
  };
}

describe("pairing recovery through the real encrypted session manager", () => {
  it("starts a fresh approval when a consumed pairing can no longer be recovered", async () => {
    const context = setup();
    await context.manager.start();
    context.api.getPairing.mockRejectedValueOnce(new CloudIdentityApiError("not_found", 404));
    await expect(context.manager.start()).resolves.toMatchObject({ status: "pairing" });
    expect(context.api.createPairing).toHaveBeenCalledTimes(2);
  });

  it("keeps pending proof when a temporary polling failure occurs", async () => {
    const context = setup();
    await context.manager.start();
    const pending = await context.vault.readPending();
    context.api.getPairing.mockRejectedValueOnce(new TypeError("offline"));
    await expect(context.manager.continuePairing()).rejects.toThrow("offline");
    expect(await context.vault.readPending()).toEqual(pending);
  });
  it("reopens the same pending approval and preserves its PKCE state", async () => {
    const context = setup();
    await context.manager.start();
    const pending = await context.vault.readPending();
    await context.manager.start();
    expect(await context.vault.readPending()).toEqual(pending);
    expect(context.api.createPairing).toHaveBeenCalledOnce();
    expect(context.open).toHaveBeenLastCalledWith(
      "https://web.huayi.invalid/pair-extension/pairing-recovery",
    );
  });

  it("exchanges during a foreground status request instead of waiting for an alarm", async () => {
    const context = setup();
    await context.manager.start();
    context.approve();
    const state = await handleCloudSessionMessage(
      {
        messageVersion: STORE_MESSAGE_VERSION,
        type: "store/cloud-session-status",
      },
      {
        manager: context.manager,
        runtimeId: "extension-id",
        schedulePoll: vi.fn(),
        syncPreferences: vi.fn(),
        sender: { id: "extension-id", url: "chrome-extension://extension-id/options.html" },
      },
    );
    expect(state?.status).toBe("connected");
    expect(await context.vault.readPending()).toBeNull();
    expect(await context.vault.readSession()).not.toBeNull();
  });

  it("exchanges once when the popup, settings and alarm check approval together", async () => {
    const context = setup();
    await context.manager.start();
    context.approve();
    const states = await Promise.all([
      context.manager.continuePairing(),
      context.manager.continuePairing(),
      context.manager.start(),
    ]);
    expect(states.map((state) => state.status)).toEqual(["connected", "connected", "connected"]);
    expect(context.api.exchangePairing).toHaveBeenCalledOnce();
    expect(context.api.createPairing).toHaveBeenCalledOnce();
  });

  it("a disconnect during exchange finishes with the new session revoked and cleared", async () => {
    const context = setup();
    await context.manager.start();
    context.approve();
    const exchange = context.api.exchangePairing.getMockImplementation();
    if (exchange === undefined) throw new Error("Exchange fixture missing");
    let release: (() => void) | undefined;
    let entered: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    context.api.exchangePairing.mockImplementation(async () => {
      entered?.();
      await hold;
      return exchange();
    });
    const polling = context.manager.continuePairing();
    await started;
    const disconnecting = context.manager.disconnect();
    release?.();
    await Promise.all([polling, disconnecting]);
    expect(await context.manager.status()).toEqual({ status: "disconnected" });
    expect(context.api.disconnectExtensionSession).toHaveBeenCalledOnce();
    expect(await context.vault.readPending()).toBeNull();
  });
});
