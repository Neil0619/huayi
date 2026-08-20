import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import { createCloudSessionManager } from "./cloud-session-manager.js";
import type { PendingExtensionPairing, StoredExtensionSession } from "./extension-session-vault.js";

describe("Store SW cloud session manager", () => {
  it("persists secrets before opening the fixed pairing path and exchanges only after approval", async () => {
    let pending: PendingExtensionPairing | null = null;
    let session: StoredExtensionSession | null = null;
    const vault = {
      clearPending: vi.fn(async () => {
        pending = null;
      }),
      clearSession: vi.fn(async () => {
        session = null;
      }),
      getOrCreateInstallId: vi.fn(async () => "i".repeat(32)),
      readPending: vi.fn(async () => pending),
      readSession: vi.fn(async () => session),
      writePending: vi.fn(async (value) => {
        pending = value;
      }),
      writeSession: vi.fn(async (value) => {
        session = value;
      }),
    };
    const api = {
      createPairing: vi.fn(async () => ({
        expiresAt: "2026-08-13T01:00:00.000Z",
        id: "pairing-1",
        pairingPath: "/pair-extension/pairing-1",
        status: "pending" as const,
      })),
      disconnectExtensionSession: vi.fn(async () => undefined),
      exchangePairing: vi.fn(async () => ({
        expiresAt: "2026-09-13T01:00:00.000Z",
        preferences: {
          cloudWordCopyMode: "enabled" as const,
          extensionQueryModelMode: "platform" as const,
          revision: 1,
          studyCaptureMode: "manual" as const,
          updatedAt: "2026-08-13T00:00:00.000Z",
        },
        sessionToken: "t".repeat(32),
      })),
      getPairing: vi.fn(async () => ({
        expiresAt: "2026-08-13T01:00:00.000Z",
        id: "pairing-1",
        pairingPath: "/pair-extension/pairing-1",
        status: "approved" as const,
      })),
      getExtensionPreferences: vi.fn(),
    };
    const open = vi.fn(async () => undefined);
    const clearSubmissions = vi.fn(async () => undefined);
    const bytes = (length: number) => new Uint8Array(length).fill(5);
    const manager = createCloudSessionManager({
      api,
      clearSubmissions,
      crypto: globalThis.crypto,
      now: () => Date.parse("2026-08-13T00:00:00.000Z"),
      open,
      randomBytes: bytes,
      vault,
      webOrigin: "https://app.huayi.invalid",
    });

    await expect(manager.start()).resolves.toMatchObject({ status: "pairing" });
    expect(vault.writePending).toHaveBeenCalledBefore(open);
    expect(api.createPairing).toHaveBeenCalledWith(
      expect.objectContaining({
        installIdHash: createHash("sha256").update("i".repeat(32)).digest("base64url"),
      }),
    );
    expect(open).toHaveBeenCalledWith("https://app.huayi.invalid/pair-extension/pairing-1");
    await expect(manager.continuePairing()).resolves.toMatchObject({ status: "connected" });
    expect(session).toMatchObject({ token: "t".repeat(32) });
    expect(clearSubmissions).toHaveBeenCalledOnce();
    await expect(manager.disconnect()).resolves.toEqual({ status: "disconnected" });
    expect(api.disconnectExtensionSession).toHaveBeenCalledWith("t".repeat(32));
    expect(api.disconnectExtensionSession).toHaveBeenCalledBefore(vault.clearSession);
    expect(clearSubmissions).toHaveBeenCalledTimes(2);
  });

  it("keeps the encrypted session and account-bound queue when remote revocation fails", async () => {
    const clearSession = vi.fn(async () => undefined);
    const clearSubmissions = vi.fn(async () => undefined);
    const api = {
      disconnectExtensionSession: vi.fn(async () => {
        throw new TypeError("network unavailable");
      }),
    };
    const manager = createCloudSessionManager({
      api: api as never,
      clearSubmissions,
      crypto: globalThis.crypto,
      open: vi.fn(),
      randomBytes: (length) => crypto.getRandomValues(new Uint8Array(length)),
      vault: {
        clearPending: vi.fn(),
        clearSession,
        readSession: vi.fn(async () => ({
          expiresAt: "2026-09-13T01:00:00.000Z",
          preferences: {
            cloudWordCopyMode: "enabled",
            extensionQueryModelMode: "platform",
            revision: 1,
            studyCaptureMode: "manual",
            updatedAt: "2026-08-13T00:00:00.000Z",
          },
          token: "t".repeat(32),
        })),
      } as never,
      webOrigin: "https://app.huayi.invalid",
    });

    await expect(manager.disconnect()).rejects.toThrow("network unavailable");
    expect(clearSession).not.toHaveBeenCalled();
    expect(clearSubmissions).not.toHaveBeenCalled();
  });

  it("clears pending pairing state without calling self-revoke before a session exists", async () => {
    const disconnectExtensionSession = vi.fn();
    const clearPending = vi.fn(async () => undefined);
    const clearSession = vi.fn(async () => undefined);
    const clearSubmissions = vi.fn(async () => undefined);
    const manager = createCloudSessionManager({
      api: { disconnectExtensionSession } as never,
      clearSubmissions,
      crypto: globalThis.crypto,
      open: vi.fn(),
      randomBytes: (length) => crypto.getRandomValues(new Uint8Array(length)),
      vault: {
        clearPending,
        clearSession,
        readSession: vi.fn(async () => null),
      } as never,
      webOrigin: "https://app.huayi.invalid",
    });

    await expect(manager.disconnect()).resolves.toEqual({ status: "disconnected" });
    expect(disconnectExtensionSession).not.toHaveBeenCalled();
    expect(clearPending).toHaveBeenCalledOnce();
    expect(clearSession).toHaveBeenCalledOnce();
    expect(clearSubmissions).toHaveBeenCalledOnce();
  });

  it("fails closed without release-owned origins", async () => {
    const manager = createCloudSessionManager({
      api: null,
      clearSubmissions: vi.fn(async () => undefined),
      crypto: globalThis.crypto,
      open: vi.fn(),
      randomBytes: (length) => crypto.getRandomValues(new Uint8Array(length)),
      vault: {} as never,
      webOrigin: null,
    });
    await expect(manager.start()).resolves.toEqual({ status: "not-configured" });
  });

  it("clears an expired encrypted session instead of reporting connected", async () => {
    const clearSession = vi.fn(async () => undefined);
    const manager = createCloudSessionManager({
      api: {} as never,
      clearSubmissions: vi.fn(async () => undefined),
      crypto: globalThis.crypto,
      now: () => Date.parse("2026-08-13T02:00:00.000Z"),
      open: vi.fn(),
      randomBytes: (length) => crypto.getRandomValues(new Uint8Array(length)),
      vault: {
        clearSession,
        readSession: vi.fn(async () => ({
          expiresAt: "2026-08-13T01:00:00.000Z",
          preferences: {
            cloudWordCopyMode: "enabled",
            extensionQueryModelMode: "platform",
            revision: 1,
            studyCaptureMode: "manual",
            updatedAt: "2026-08-13T00:00:00.000Z",
          },
          token: "t".repeat(32),
        })),
      } as never,
      webOrigin: "https://app.huayi.invalid",
    });

    await expect(manager.status()).resolves.toEqual({ status: "expired" });
    expect(clearSession).toHaveBeenCalledOnce();
  });
});
