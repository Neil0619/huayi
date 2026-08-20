import { cloudWordCopyBatchRequestSchema, idempotencyKeySchema } from "@huayi/cloud-contracts";
import type { DeviceVault } from "@huayi/store-domain";
import { z } from "zod/v3";

import { decodeBase64, encodeBase64 } from "../vault/vault-codec.js";
import { VaultError } from "../vault/vault-error.js";

const STORAGE_KEY = "huayi.store.cloud.local-word-import";
const aad = new TextEncoder().encode("huayi-store-local-word-import-v1");
const MAX_PLAINTEXT_BYTES = 5_000_000;

const summarySchema = z.strictObject({
  contextCount: z.number().int().min(0).max(1_000_000),
  createdContextCount: z.number().int().min(0).max(1_000_000),
  createdWordCount: z.number().int().min(0).max(100_000),
  duplicateContextCount: z.number().int().min(0).max(1_000_000),
  existingWordCount: z.number().int().min(0).max(100_000),
  wordCount: z.number().int().min(0).max(100_000),
});
const extensionVersionSchema = z
  .string()
  .regex(/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/u);

const jobSchema = z
  .strictObject({
    batches: z
      .array(
        z.strictObject({
          idempotencyKey: idempotencyKeySchema,
          request: cloudWordCopyBatchRequestSchema,
        }),
      )
      .min(1)
      .max(1_000),
    clientUpgradeRequiredAtVersion: extensionVersionSchema.optional(),
    nextBatchIndex: z.number().int().min(0).max(1_000),
    status: z.enum(["client-upgrade-required", "completed", "failed", "pending", "retry-pending"]),
    summary: summarySchema,
  })
  .superRefine((job, context) => {
    if (job.nextBatchIndex > job.batches.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Local word import progress exceeds its batch count.",
        path: ["nextBatchIndex"],
      });
    }
    if ((job.status === "completed") !== (job.nextBatchIndex === job.batches.length)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Only a fully processed local word import may be completed.",
        path: ["status"],
      });
    }
  });

const envelopeSchema = z.strictObject({
  algorithm: z.literal("AES-256-GCM"),
  ciphertext: z.string().min(24).max(8_000_000),
  iv: z.string().min(16).max(24),
  kind: z.literal("huayi-store-local-word-import"),
  version: z.literal(1),
});

export type LocalWordImportJob = z.infer<typeof jobSchema>;

export interface LocalWordImportVaultStorage {
  delete(key: string): Promise<void>;
  read(key: string): Promise<unknown>;
  write(key: string, value: unknown): Promise<void>;
}

interface LocalWordImportVaultOptions {
  readonly crypto: Crypto;
  readonly deviceVault: Pick<DeviceVault, "getDek">;
  readonly storage: LocalWordImportVaultStorage;
}

export function createLocalWordImportVault(options: LocalWordImportVaultOptions) {
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
    async read(): Promise<LocalWordImportJob | null> {
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
        return jobSchema.parse(
          JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(plaintext)),
        );
      } catch (error) {
        if (error instanceof VaultError) throw error;
        throw new VaultError("authentication-failed");
      }
    },
    async write(value: LocalWordImportJob): Promise<void> {
      const plaintext = new TextEncoder().encode(JSON.stringify(jobSchema.parse(value)));
      if (plaintext.byteLength > MAX_PLAINTEXT_BYTES) {
        throw new RangeError("Local word import snapshot exceeds the encrypted job limit.");
      }
      const iv = options.crypto.getRandomValues(new Uint8Array(12));
      const ciphertext = await options.crypto.subtle.encrypt(
        {
          additionalData: Uint8Array.from(aad).buffer,
          iv: Uint8Array.from(iv).buffer,
          name: "AES-GCM",
          tagLength: 128,
        },
        await key(),
        plaintext,
      );
      await options.storage.write(STORAGE_KEY, {
        algorithm: "AES-256-GCM",
        ciphertext: encodeBase64(new Uint8Array(ciphertext)),
        iv: encodeBase64(iv),
        kind: "huayi-store-local-word-import",
        version: 1,
      });
    },
  };
}

export type LocalWordImportVault = ReturnType<typeof createLocalWordImportVault>;
