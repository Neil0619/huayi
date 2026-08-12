import { describe, expect, it } from "vitest";

import type { DeviceVault } from "@huayi/store-domain";

import { createRecoveryCode } from "./recovery-code.js";
import {
  PRODUCTION_KDF_ITERATIONS,
  createBrowserDeviceVault,
  createRequiredDeviceVaultLock,
  type DeviceVaultExclusiveLock,
  type VaultStorageAdapter,
} from "./browser-device-vault.js";
import { createVaultMetadata } from "./vault-codec.js";
import { createDek, encryptCredential, wrapDek } from "./vault-crypto.js";
import {
  credentialStorageKey,
  DEVICE_VAULT_KEY_STORAGE_KEY,
  VAULT_METADATA_STORAGE_KEY,
  VAULT_SESSION_STORAGE_KEY,
} from "./vault-storage.js";

const TEST_KDF_ITERATIONS = 1_000;

class MemoryVaultStorage implements VaultStorageAdapter {
  readonly persistent = new Map<string, unknown>();
  readonly session = new Map<string, unknown>();
  failDeviceWrite = false;
  failSessionDelete = false;
  deviceWrites = 0;

  prepare(): Promise<void> {
    return Promise.resolve();
  }
  async readPersistent(key: string): Promise<unknown> {
    return this.persistent.get(key);
  }
  async writePersistent(key: string, value: unknown): Promise<void> {
    if (this.failDeviceWrite && key === DEVICE_VAULT_KEY_STORAGE_KEY)
      throw new Error("write failed");
    if (key === DEVICE_VAULT_KEY_STORAGE_KEY) this.deviceWrites += 1;
    this.persistent.set(key, structuredClone(value));
  }
  async deletePersistent(key: string): Promise<void> {
    this.persistent.delete(key);
  }
  async readSession(key: string): Promise<unknown> {
    return this.session.get(key);
  }
  async writeSession(key: string, value: unknown): Promise<void> {
    this.session.set(key, structuredClone(value));
  }
  async deleteSession(key: string): Promise<void> {
    if (this.failSessionDelete && key === VAULT_SESSION_STORAGE_KEY) {
      throw new Error("cleanup interrupted");
    }
    this.session.delete(key);
  }
}

function createVault(
  storage = new MemoryVaultStorage(),
  exclusiveLock?: DeviceVaultExclusiveLock,
): {
  readonly storage: MemoryVaultStorage;
  readonly vault: DeviceVault;
} {
  return {
    storage,
    vault: createBrowserDeviceVault({
      crypto: globalThis.crypto,
      ...(exclusiveLock === undefined ? {} : { exclusiveLock }),
      kdfIterations: TEST_KDF_ITERATIONS,
      storage,
    }),
  };
}

async function seedLegacyVault(storage: MemoryVaultStorage): Promise<{
  readonly dek: Uint8Array;
  readonly recoveryCode: string;
}> {
  const dek = createDek(globalThis.crypto);
  const recovery = await createRecoveryCode(globalThis.crypto);
  const [passphraseWrapper, recoveryWrapper] = await Promise.all([
    wrapDek(
      globalThis.crypto,
      dek,
      new TextEncoder().encode("old-password"),
      "passphrase",
      TEST_KDF_ITERATIONS,
    ),
    wrapDek(globalThis.crypto, dek, recovery.secret, "recovery", TEST_KDF_ITERATIONS),
  ]);
  storage.persistent.set(
    VAULT_METADATA_STORAGE_KEY,
    createVaultMetadata(passphraseWrapper, recoveryWrapper, true),
  );
  storage.session.set(VAULT_SESSION_STORAGE_KEY, { obsolete: true });
  storage.persistent.set(
    credentialStorageKey("openai-api-key"),
    await encryptCredential(globalThis.crypto, dek, "openai-api-key", "preserved-secret"),
  );
  return { dek, recoveryCode: recovery.code };
}

describe("PasswordlessDeviceVault", () => {
  it("fails closed when production cross-context Web Locks are unavailable", async () => {
    const lock = createRequiredDeviceVaultLock(undefined);

    await expect(lock(async () => "must-not-run")).rejects.toMatchObject({
      code: "locking-unavailable",
    });
  });

  it("serializes clean initialization across extension contexts and commits one DEK", async () => {
    const storage = new MemoryVaultStorage();
    let lockQueue = Promise.resolve();
    const lock: DeviceVaultExclusiveLock = async (operation) => {
      const result = lockQueue.then(operation, operation);
      lockQueue = result.then(
        () => undefined,
        () => undefined,
      );
      return await result;
    };
    const first = createVault(storage, lock).vault;
    const second = createVault(storage, lock).vault;

    const [firstDek, secondDek] = await Promise.all([first.getDek(), second.getDek()]);

    expect(firstDek).toEqual(secondDek);
    expect(storage.deviceWrites).toBe(1);
  });

  it("auto-initializes a random device key and is immediately ready", async () => {
    const { storage, vault } = createVault();

    await expect(vault.ensureReady()).resolves.toBeUndefined();
    await expect(vault.getReadiness()).resolves.toBe("ready");
    expect(storage.persistent.has(DEVICE_VAULT_KEY_STORAGE_KEY)).toBe(true);
    await expect(vault.getDek()).resolves.toHaveLength(32);
  });

  it("remains ready after restart without session state or user input", async () => {
    const first = createVault();
    await first.vault.ensureReady();
    await first.vault.setCredential("deepseek-api-key", "secret");
    const restarted = createVault(first.storage);

    await expect(restarted.vault.ensureReady()).resolves.toBeUndefined();
    await expect(restarted.vault.getCredential("deepseek-api-key")).resolves.toBe("secret");
  });

  it("encrypts credentials and never persists their plaintext", async () => {
    const { storage, vault } = createVault();
    await vault.setCredential("eudic-authorization", "authorization-secret");

    await expect(vault.getCredential("eudic-authorization")).resolves.toBe("authorization-secret");
    expect(JSON.stringify([...storage.persistent])).not.toContain("authorization-secret");
    await vault.deleteCredential("eudic-authorization");
    await expect(vault.getCredential("eudic-authorization")).resolves.toBeNull();
  });

  it("migrates a legacy passphrase vault once and preserves its DEK and credentials", async () => {
    const { storage, vault } = createVault();
    const legacy = await seedLegacyVault(storage);

    await expect(vault.ensureReady()).rejects.toMatchObject({
      code: "legacy-migration-required",
    });
    await vault.migrateLegacy({ kind: "passphrase", secret: "old-password" });

    await expect(vault.getDek()).resolves.toEqual(legacy.dek);
    await expect(vault.getCredential("openai-api-key")).resolves.toBe("preserved-secret");
    expect(storage.persistent.has(VAULT_METADATA_STORAGE_KEY)).toBe(false);
    expect(storage.session.has(VAULT_SESSION_STORAGE_KEY)).toBe(false);
  });

  it("also migrates with the legacy recovery code", async () => {
    const { storage, vault } = createVault();
    const legacy = await seedLegacyVault(storage);

    await vault.migrateLegacy({ kind: "recovery-code", secret: legacy.recoveryCode });

    await expect(vault.getDek()).resolves.toEqual(legacy.dek);
    await expect(vault.getCredential("openai-api-key")).resolves.toBe("preserved-secret");
  });

  it("keeps all legacy state retryable when authentication or the commit write fails", async () => {
    const { storage, vault } = createVault();
    await seedLegacyVault(storage);
    const before = structuredClone([...storage.persistent]);

    await expect(
      vault.migrateLegacy({ kind: "passphrase", secret: "wrong-password" }),
    ).rejects.toMatchObject({ code: "authentication-failed" });
    expect([...storage.persistent]).toEqual(before);

    storage.failDeviceWrite = true;
    await expect(
      vault.migrateLegacy({ kind: "passphrase", secret: "old-password" }),
    ).rejects.toThrow("write failed");
    expect([...storage.persistent]).toEqual(before);
    expect(storage.session.has(VAULT_SESSION_STORAGE_KEY)).toBe(true);
  });

  it("recovers idempotently when legacy cleanup is interrupted after the device-key commit", async () => {
    const first = createVault();
    await seedLegacyVault(first.storage);
    first.storage.failSessionDelete = true;

    await expect(
      first.vault.migrateLegacy({ kind: "passphrase", secret: "old-password" }),
    ).rejects.toThrow("cleanup interrupted");
    expect(first.storage.persistent.has(DEVICE_VAULT_KEY_STORAGE_KEY)).toBe(true);
    expect(first.storage.persistent.has(VAULT_METADATA_STORAGE_KEY)).toBe(true);

    first.storage.failSessionDelete = false;
    const restarted = createVault(first.storage);
    await expect(restarted.vault.ensureReady()).resolves.toBeUndefined();
    await expect(restarted.vault.getCredential("openai-api-key")).resolves.toBe("preserved-secret");
    expect(first.storage.persistent.has(VAULT_METADATA_STORAGE_KEY)).toBe(false);
    expect(first.storage.session.has(VAULT_SESSION_STORAGE_KEY)).toBe(false);
  });

  it("fails closed for malformed or partial legacy state instead of resetting", async () => {
    const malformed = createVault();
    malformed.storage.persistent.set(VAULT_METADATA_STORAGE_KEY, { malformed: true });
    await expect(malformed.vault.ensureReady()).rejects.toMatchObject({
      code: "invalid-persisted-data",
    });
    expect(malformed.storage.persistent.has(DEVICE_VAULT_KEY_STORAGE_KEY)).toBe(false);

    const partial = createVault();
    partial.storage.session.set(VAULT_SESSION_STORAGE_KEY, { orphan: true });
    await expect(partial.vault.ensureReady()).rejects.toMatchObject({
      code: "invalid-persisted-data",
    });
    expect(partial.storage.session.has(VAULT_SESSION_STORAGE_KEY)).toBe(true);

    const credentialWithoutMetadata = createVault();
    credentialWithoutMetadata.storage.persistent.set(credentialStorageKey("deepseek-api-key"), {
      existing: "ciphertext",
    });
    await expect(credentialWithoutMetadata.vault.ensureReady()).rejects.toMatchObject({
      code: "invalid-persisted-data",
    });
    expect(credentialWithoutMetadata.storage.persistent.has(DEVICE_VAULT_KEY_STORAGE_KEY)).toBe(
      false,
    );
  });

  it("keeps the production legacy KDF compatibility cost fixed", () => {
    expect(PRODUCTION_KDF_ITERATIONS).toBe(600_000);
  });
});
