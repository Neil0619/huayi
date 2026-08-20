import type { DeviceVault } from "@huayi/store-domain";
import { z } from "zod/v3";

import { decodeBase64, encodeBase64 } from "../vault/vault-codec.js";
import { VaultError } from "../vault/vault-error.js";

const STORAGE_KEY = "huayi.store.cloud.external-wordbook-lease";
const aad = new TextEncoder().encode("huayi-store-external-wordbook-lease-v1");
const stateSchema = z.strictObject({
  batchToken: z.string().regex(/^[A-Za-z0-9_-]{32,128}$/u),
  entries: z
    .array(
      z.strictObject({
        alias: z.string().regex(/^[A-Za-z0-9_-]{32,128}$/u),
        headword: z.string().trim().min(1).max(200),
        itemId: z.string().min(1).max(128),
      }),
    )
    .min(1)
    .max(20),
  expiresAt: z.string().datetime({ offset: true }),
  jobId: z.string().min(1).max(128),
  leaseToken: z.string().min(43).max(512),
});
const envelopeSchema = z.strictObject({
  algorithm: z.literal("AES-256-GCM"),
  ciphertext: z.string().min(24).max(64_000),
  iv: z.string().min(16).max(24),
  kind: z.literal("huayi-store-external-wordbook-lease"),
  version: z.literal(1),
});
export type ExternalWordbookLeaseState = z.infer<typeof stateSchema>;

export function createExternalWordbookLeaseVault(options: {
  crypto: Crypto;
  deviceVault: Pick<DeviceVault, "getDek">;
  storage: {
    delete(key: string): Promise<void>;
    read(key: string): Promise<unknown>;
    write(key: string, value: unknown): Promise<void>;
  };
}) {
  const key = async () =>
    options.crypto.subtle.importKey(
      "raw",
      Uint8Array.from(await options.deviceVault.getDek()).buffer,
      "AES-GCM",
      false,
      ["decrypt", "encrypt"],
    );
  return {
    clear: () => options.storage.delete(STORAGE_KEY),
    async read(): Promise<ExternalWordbookLeaseState | null> {
      const raw = await options.storage.read(STORAGE_KEY);
      if (raw === undefined) return null;
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
        return stateSchema.parse(
          JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(plaintext)),
        );
      } catch (error) {
        if (error instanceof VaultError) throw error;
        throw new VaultError("authentication-failed");
      }
    },
    async write(value: ExternalWordbookLeaseState): Promise<void> {
      const parsed = stateSchema.parse(value);
      const iv = options.crypto.getRandomValues(new Uint8Array(12));
      const ciphertext = await options.crypto.subtle.encrypt(
        {
          additionalData: Uint8Array.from(aad).buffer,
          iv: Uint8Array.from(iv).buffer,
          name: "AES-GCM",
          tagLength: 128,
        },
        await key(),
        new TextEncoder().encode(JSON.stringify(parsed)),
      );
      await options.storage.write(STORAGE_KEY, {
        algorithm: "AES-256-GCM",
        ciphertext: encodeBase64(new Uint8Array(ciphertext)),
        iv: encodeBase64(iv),
        kind: "huayi-store-external-wordbook-lease",
        version: 1,
      });
    },
  };
}

export type ExternalWordbookLeaseVault = ReturnType<typeof createExternalWordbookLeaseVault>;
