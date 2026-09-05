import { z } from "zod/v3";
import { extensionPreferencesResponseSchema } from "@huayi/cloud-contracts";

import type { DeviceVault } from "@huayi/store-domain";

import { decodeBase64, encodeBase64 } from "../vault/vault-codec.js";
import { VaultError } from "../vault/vault-error.js";

const INSTALL_ID_KEY = "huayi.store.cloud.install-id";
const PAIRING_KEY = "huayi.store.cloud.pairing";
const SESSION_KEY = "huayi.store.cloud.session";
const aad = new TextEncoder().encode("huayi-store-cloud-session-v1");

const pendingSchema = z.strictObject({
  expiresAt: z.string().datetime({ offset: true }),
  id: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/u),
  pairingPath: z.string().regex(/^\/pair-extension\/[A-Za-z0-9_-]{1,128}$/u),
  state: z.string().regex(/^[A-Za-z0-9_-]{32,128}$/u),
  verifier: z.string().regex(/^[A-Za-z0-9._~-]{43,128}$/u),
});
const sessionSchema = z.strictObject({
  expiresAt: z.string().datetime({ offset: true }),
  preferences: extensionPreferencesResponseSchema,
  preferencesSyncedAt: z.number().int().nonnegative().optional(),
  token: z.string().min(32).max(2_048),
});
const installIdSchema = z.string().regex(/^[A-Za-z0-9_-]{32,128}$/u);
const envelopeSchema = z.strictObject({
  algorithm: z.literal("AES-256-GCM"),
  ciphertext: z.string().min(24).max(16_384),
  iv: z.string().min(16).max(24),
  kind: z.literal("huayi-store-cloud-session"),
  version: z.literal(1),
});

export type PendingExtensionPairing = z.infer<typeof pendingSchema>;
export type StoredExtensionSession = z.infer<typeof sessionSchema>;

export interface ExtensionSessionVaultStorage {
  delete(key: string): Promise<void>;
  read(key: string): Promise<unknown>;
  write(key: string, value: unknown): Promise<void>;
}

interface ExtensionSessionVaultOptions {
  readonly crypto: Crypto;
  readonly deviceVault: Pick<DeviceVault, "getDek">;
  readonly storage: ExtensionSessionVaultStorage;
}

function base64Url(bytes: Uint8Array): string {
  return encodeBase64(bytes).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

export function createExtensionSessionVault(options: ExtensionSessionVaultOptions) {
  const key = async () =>
    options.crypto.subtle.importKey(
      "raw",
      Uint8Array.from(await options.deviceVault.getDek()).buffer,
      "AES-GCM",
      false,
      ["decrypt", "encrypt"],
    );
  const encrypt = async (value: unknown) => {
    const iv = options.crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await options.crypto.subtle.encrypt(
      {
        additionalData: Uint8Array.from(aad).buffer,
        iv: Uint8Array.from(iv).buffer,
        name: "AES-GCM",
        tagLength: 128,
      },
      await key(),
      new TextEncoder().encode(JSON.stringify(value)),
    );
    return {
      algorithm: "AES-256-GCM" as const,
      ciphertext: encodeBase64(new Uint8Array(ciphertext)),
      iv: encodeBase64(iv),
      kind: "huayi-store-cloud-session" as const,
      version: 1 as const,
    };
  };
  const decrypt = async (raw: unknown): Promise<unknown> => {
    const envelope = envelopeSchema.parse(raw);
    try {
      const plaintext = await options.crypto.subtle.decrypt(
        {
          additionalData: Uint8Array.from(aad).buffer,
          iv: Uint8Array.from(decodeBase64(envelope.iv, 12)).buffer,
          name: "AES-GCM",
          tagLength: 128,
        },
        await key(),
        Uint8Array.from(decodeBase64(envelope.ciphertext, undefined, 16)).buffer,
      );
      return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(plaintext));
    } catch (error) {
      if (error instanceof VaultError) throw error;
      throw new VaultError("authentication-failed");
    }
  };
  return {
    clearPending: () => options.storage.delete(PAIRING_KEY),
    clearSession: () => options.storage.delete(SESSION_KEY),
    async getOrCreateInstallId(): Promise<string> {
      const existing = await options.storage.read(INSTALL_ID_KEY);
      if (existing !== undefined) return installIdSchema.parse(existing);
      const created = base64Url(options.crypto.getRandomValues(new Uint8Array(32)));
      await options.storage.write(INSTALL_ID_KEY, created);
      return created;
    },
    async readPending(): Promise<PendingExtensionPairing | null> {
      const raw = await options.storage.read(PAIRING_KEY);
      return raw === undefined ? null : pendingSchema.parse(await decrypt(raw));
    },
    async readSession(): Promise<StoredExtensionSession | null> {
      const raw = await options.storage.read(SESSION_KEY);
      return raw === undefined ? null : sessionSchema.parse(await decrypt(raw));
    },
    async writePending(value: PendingExtensionPairing): Promise<void> {
      await options.storage.write(PAIRING_KEY, await encrypt(pendingSchema.parse(value)));
    },
    async writeSession(value: StoredExtensionSession): Promise<void> {
      await options.storage.write(SESSION_KEY, await encrypt(sessionSchema.parse(value)));
    },
  };
}

export type ExtensionSessionVault = ReturnType<typeof createExtensionSessionVault>;
