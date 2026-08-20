import { describe, expect, it } from "vitest";

import type { DeviceVault } from "@huayi/store-domain";

import {
  createExtensionSessionVault,
  type ExtensionSessionVaultStorage,
} from "./extension-session-vault.js";

class MemoryStorage implements ExtensionSessionVaultStorage {
  readonly values = new Map<string, unknown>();
  async delete(key: string) {
    this.values.delete(key);
  }
  async read(key: string) {
    return this.values.get(key);
  }
  async write(key: string, value: unknown) {
    this.values.set(key, structuredClone(value));
  }
}

const deviceVault = {
  getDek: async () => new Uint8Array(32).fill(7),
} as Pick<DeviceVault, "getDek">;

describe("SW-only ExtensionSessionVault", () => {
  it("encrypts pending state and verifier plus the session token", async () => {
    const storage = new MemoryStorage();
    const vault = createExtensionSessionVault({ crypto: globalThis.crypto, deviceVault, storage });
    const pending = {
      expiresAt: "2026-08-13T01:00:00.000Z",
      id: "pairing-1",
      pairingPath: "/pair-extension/pairing-1",
      state: "s".repeat(32),
      verifier: "v".repeat(43),
    };
    await vault.writePending(pending);
    const preferences = {
      cloudWordCopyMode: "enabled" as const,
      extensionQueryModelMode: "platform" as const,
      revision: 1,
      studyCaptureMode: "manual" as const,
      updatedAt: "2026-08-13T00:00:00.000Z",
    };
    await vault.writeSession({ expiresAt: pending.expiresAt, preferences, token: "t".repeat(32) });

    expect(JSON.stringify([...storage.values])).not.toContain(pending.state);
    expect(JSON.stringify([...storage.values])).not.toContain(pending.verifier);
    expect(JSON.stringify([...storage.values])).not.toContain("t".repeat(32));
    await expect(vault.readPending()).resolves.toEqual(pending);
    await expect(vault.readSession()).resolves.toEqual({
      expiresAt: pending.expiresAt,
      preferences,
      token: "t".repeat(32),
    });
  });

  it("stores only a stable non-secret install ID in plaintext", async () => {
    const storage = new MemoryStorage();
    const vault = createExtensionSessionVault({ crypto: globalThis.crypto, deviceVault, storage });
    await expect(vault.getOrCreateInstallId()).resolves.toMatch(/^[A-Za-z0-9_-]{32,128}$/u);
    const first = await vault.getOrCreateInstallId();
    await expect(vault.getOrCreateInstallId()).resolves.toBe(first);
  });
});
