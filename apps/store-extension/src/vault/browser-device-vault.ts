import {
  credentialSlotSchema,
  type CredentialSlot,
  type DeviceVault,
  type DeviceVaultReadiness,
  type LegacyVaultMigrationInput,
} from "@huayi/store-domain";

import { createChromeVaultStorageAdapter } from "./chrome-vault-storage.js";
import { parseRecoveryCode } from "./recovery-code.js";
import {
  createDeviceKeyEnvelope,
  decodeBase64,
  parseCredentialEnvelope,
  parseDeviceKeyEnvelope,
  parseVaultMetadata,
} from "./vault-codec.js";
import { createDek, decryptCredential, encryptCredential, unwrapDek } from "./vault-crypto.js";
import { VaultError } from "./vault-error.js";
import {
  credentialStorageKey,
  DEVICE_VAULT_KEY_STORAGE_KEY,
  VAULT_METADATA_STORAGE_KEY,
  VAULT_SESSION_STORAGE_KEY,
  type VaultStorageAdapter,
} from "./vault-storage.js";

export type { VaultStorageAdapter } from "./vault-storage.js";
export { VaultError } from "./vault-error.js";

export const PRODUCTION_KDF_ITERATIONS = 600_000;

interface BrowserDeviceVaultOptions {
  readonly crypto: Crypto;
  readonly exclusiveLock?: DeviceVaultExclusiveLock;
  readonly kdfIterations?: number;
  readonly storage: VaultStorageAdapter;
}

export type DeviceVaultExclusiveLock = <T>(operation: () => Promise<T>) => Promise<T>;

interface WebLocksLike {
  request<T>(
    name: string,
    options: { readonly mode: "exclusive" },
    operation: () => Promise<T>,
  ): Promise<T>;
}

export function createRequiredDeviceVaultLock(
  locks: WebLocksLike | undefined,
): DeviceVaultExclusiveLock {
  return async (operation) => {
    if (locks === undefined) throw new VaultError("locking-unavailable");
    return await locks.request("huayi-store-device-vault", { mode: "exclusive" }, operation);
  };
}

const CREDENTIAL_SLOTS = [
  "openai-api-key",
  "deepseek-api-key",
  "eudic-authorization",
] as const satisfies readonly CredentialSlot[];

class PasswordlessDeviceVault implements DeviceVault {
  private operationQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly crypto: Crypto,
    private readonly storage: VaultStorageAdapter,
    private readonly kdfIterations: number,
    private readonly crossContextLock: DeviceVaultExclusiveLock,
  ) {}

  ensureReady(): Promise<void> {
    return this.exclusive(async () => {
      await this.storage.prepare();
      await this.readOrCreateDek();
    });
  }

  getReadiness(): Promise<DeviceVaultReadiness> {
    return this.exclusive(async () => {
      await this.storage.prepare();
      const deviceKey = await this.storage.readPersistent(DEVICE_VAULT_KEY_STORAGE_KEY);
      const legacy = await this.storage.readPersistent(VAULT_METADATA_STORAGE_KEY);
      if (deviceKey !== undefined) {
        parseDeviceKeyEnvelope(deviceKey);
        if (legacy !== undefined) await this.cleanupLegacyState(legacy);
        return "ready";
      }
      if (legacy !== undefined) {
        parseVaultMetadata(legacy, this.kdfIterations);
        return "migration-required";
      }
      await this.assertNoPartialLegacyState();
      return "ready";
    });
  }

  migrateLegacy(input: LegacyVaultMigrationInput): Promise<void> {
    return this.exclusive(async () => {
      await this.storage.prepare();
      const existingDeviceKey = await this.storage.readPersistent(DEVICE_VAULT_KEY_STORAGE_KEY);
      if (existingDeviceKey !== undefined) {
        parseDeviceKeyEnvelope(existingDeviceKey);
        const legacy = await this.storage.readPersistent(VAULT_METADATA_STORAGE_KEY);
        if (legacy !== undefined) await this.cleanupLegacyState(legacy);
        return;
      }
      const rawMetadata = await this.storage.readPersistent(VAULT_METADATA_STORAGE_KEY);
      if (rawMetadata === undefined) throw new VaultError("invalid-persisted-data");
      const metadata = parseVaultMetadata(rawMetadata, this.kdfIterations);
      const secret =
        input.kind === "passphrase"
          ? new TextEncoder().encode(this.requireSecret(input.secret))
          : await parseRecoveryCode(this.crypto, input.secret);
      const wrapper =
        input.kind === "passphrase" ? metadata.passphraseWrapper : metadata.recoveryWrapper;
      const dek = await unwrapDek(this.crypto, wrapper, secret);

      // This single write is the migration commit point. Legacy wrappers remain intact on any
      // unwrap/write failure and are deleted only after the device key is durably present.
      await this.storage.writePersistent(
        DEVICE_VAULT_KEY_STORAGE_KEY,
        createDeviceKeyEnvelope(dek),
      );
      await this.cleanupLegacyState(rawMetadata);
    });
  }

  getCredential(slot: CredentialSlot): Promise<string | null> {
    return this.exclusive(async () => {
      const parsedSlot = credentialSlotSchema.parse(slot);
      const dek = await this.readOrCreateDek();
      const raw = await this.storage.readPersistent(credentialStorageKey(parsedSlot));
      return raw === undefined
        ? null
        : decryptCredential(this.crypto, dek, parseCredentialEnvelope(raw, parsedSlot));
    });
  }

  setCredential(slot: CredentialSlot, value: string): Promise<void> {
    return this.exclusive(async () => {
      const parsedSlot = credentialSlotSchema.parse(slot);
      const dek = await this.readOrCreateDek();
      await this.storage.writePersistent(
        credentialStorageKey(parsedSlot),
        await encryptCredential(this.crypto, dek, parsedSlot, value),
      );
    });
  }

  deleteCredential(slot: CredentialSlot): Promise<void> {
    return this.exclusive(async () => {
      const parsedSlot = credentialSlotSchema.parse(slot);
      await this.readOrCreateDek();
      await this.storage.deletePersistent(credentialStorageKey(parsedSlot));
    });
  }

  getDek(): Promise<Uint8Array> {
    return this.exclusive(async () => Uint8Array.from(await this.readOrCreateDek()));
  }

  private async readOrCreateDek(): Promise<Uint8Array> {
    await this.storage.prepare();
    const rawDeviceKey = await this.storage.readPersistent(DEVICE_VAULT_KEY_STORAGE_KEY);
    const rawLegacy = await this.storage.readPersistent(VAULT_METADATA_STORAGE_KEY);
    if (rawDeviceKey !== undefined) {
      const dek = decodeBase64(parseDeviceKeyEnvelope(rawDeviceKey).dek, 32);
      if (rawLegacy !== undefined) await this.cleanupLegacyState(rawLegacy);
      return dek;
    }
    if (rawLegacy !== undefined) {
      parseVaultMetadata(rawLegacy, this.kdfIterations);
      throw new VaultError("legacy-migration-required");
    }
    await this.assertNoPartialLegacyState();
    const dek = createDek(this.crypto);
    await this.storage.writePersistent(DEVICE_VAULT_KEY_STORAGE_KEY, createDeviceKeyEnvelope(dek));
    return dek;
  }

  private async assertNoPartialLegacyState(): Promise<void> {
    if ((await this.storage.readSession(VAULT_SESSION_STORAGE_KEY)) !== undefined) {
      throw new VaultError("invalid-persisted-data");
    }
    for (const slot of CREDENTIAL_SLOTS) {
      if ((await this.storage.readPersistent(credentialStorageKey(slot))) !== undefined) {
        throw new VaultError("invalid-persisted-data");
      }
    }
  }

  private async cleanupLegacyState(rawMetadata: unknown): Promise<void> {
    parseVaultMetadata(rawMetadata, this.kdfIterations);
    await this.storage.deleteSession(VAULT_SESSION_STORAGE_KEY);
    await this.storage.deletePersistent(VAULT_METADATA_STORAGE_KEY);
  }

  private requireSecret(secret: string): string {
    if (secret.length === 0) throw new VaultError("invalid-passphrase");
    return secret;
  }

  private exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const queued = async (): Promise<T> => await this.crossContextLock(operation);
    const result = this.operationQueue.then(queued, queued);
    this.operationQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

export function createBrowserDeviceVault(options: BrowserDeviceVaultOptions): DeviceVault {
  const iterations = options.kdfIterations ?? PRODUCTION_KDF_ITERATIONS;
  if (!Number.isSafeInteger(iterations) || iterations <= 0) {
    throw new RangeError("KDF iterations must be a positive safe integer.");
  }
  const exclusiveLock: DeviceVaultExclusiveLock =
    options.exclusiveLock ??
    (async (operation) => {
      const locks = globalThis.navigator?.locks;
      return locks === undefined
        ? await operation()
        : await locks.request("huayi-store-device-vault", { mode: "exclusive" }, operation);
    });
  return new PasswordlessDeviceVault(options.crypto, options.storage, iterations, exclusiveLock);
}

export function createProductionDeviceVault(): DeviceVault {
  return createBrowserDeviceVault({
    crypto: globalThis.crypto,
    exclusiveLock: createRequiredDeviceVaultLock(globalThis.navigator?.locks),
    storage: createChromeVaultStorageAdapter(chrome.storage),
  });
}
