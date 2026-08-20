import {
  cloudWordCopyRequestSchema,
  idempotencyKeySchema,
  studyCaptureCreateRequestSchema,
} from "@huayi/cloud-contracts";
import type { DeviceVault } from "@huayi/store-domain";
import { z } from "zod/v3";

import { decodeBase64, encodeBase64 } from "../vault/vault-codec.js";
import { VaultError } from "../vault/vault-error.js";

const STORAGE_KEY = "huayi.store.cloud.submission-outbox";
const aad = new TextEncoder().encode("huayi-store-learning-outbox-v3");
const extensionVersionSchema = z
  .string()
  .regex(/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/u)
  .refine((value) => value.split(".").every((part) => Number.isSafeInteger(Number(part))));

export const submissionOutboxInputSchema = z.discriminatedUnion("type", [
  z.strictObject({ payload: studyCaptureCreateRequestSchema, type: z.literal("study-capture") }),
  z.strictObject({ payload: cloudWordCopyRequestSchema, type: z.literal("cloud-word-copy") }),
]);
export type SubmissionOutboxInput = z.infer<typeof submissionOutboxInputSchema>;

const stateSchema = z
  .strictObject({
    clientUpgradeRequiredAtVersion: extensionVersionSchema.optional(),
    items: z
      .array(
        z.strictObject({
          createdAt: z.string().datetime({ offset: true }),
          idempotencyKey: idempotencyKeySchema,
          input: submissionOutboxInputSchema,
        }),
      )
      .max(20),
  })
  .refine(
    (state) => new Set(state.items.map((item) => item.idempotencyKey)).size === state.items.length,
    {
      message: "Submission idempotency keys must be unique.",
    },
  )
  .refine((state) => state.clientUpgradeRequiredAtVersion === undefined || state.items.length > 0, {
    message: "An upgrade block requires queued submissions.",
  });
const envelopeSchema = z.strictObject({
  algorithm: z.literal("AES-256-GCM"),
  ciphertext: z.string().min(24).max(8_000_000),
  iv: z.string().min(16).max(24),
  kind: z.literal("huayi-store-learning-outbox"),
  version: z.literal(3),
});
const legacyEnvelopeSchema = z.strictObject({
  algorithm: z.literal("AES-256-GCM"),
  ciphertext: z.string().min(24).max(8_000_000),
  iv: z.string().min(16).max(24),
  kind: z.literal("huayi-store-submission-outbox"),
  version: z.literal(1),
});
const legacyStudyCaptureEnvelopeSchema = z.strictObject({
  algorithm: z.literal("AES-256-GCM"),
  ciphertext: z.string().min(24).max(8_000_000),
  iv: z.string().min(16).max(24),
  kind: z.literal("huayi-store-study-capture-outbox"),
  version: z.literal(2),
});

export type SubmissionOutboxState = z.infer<typeof stateSchema>;

export interface SubmissionOutboxVaultStorage {
  delete(key: string): Promise<void>;
  read(key: string): Promise<unknown>;
  write(key: string, value: unknown): Promise<void>;
}

interface SubmissionOutboxVaultOptions {
  readonly crypto: Crypto;
  readonly deviceVault: Pick<DeviceVault, "getDek">;
  readonly storage: SubmissionOutboxVaultStorage;
}

export function createSubmissionOutboxVault(options: SubmissionOutboxVaultOptions) {
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
    async read(): Promise<SubmissionOutboxState> {
      const raw = await options.storage.read(STORAGE_KEY);
      if (raw === undefined) return { items: [] };
      if (
        legacyEnvelopeSchema.safeParse(raw).success ||
        legacyStudyCaptureEnvelopeSchema.safeParse(raw).success
      ) {
        await options.storage.delete(STORAGE_KEY);
        return { items: [] };
      }
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
    async write(value: SubmissionOutboxState): Promise<void> {
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
        kind: "huayi-store-learning-outbox",
        version: 3,
      });
    },
  };
}

export type SubmissionOutboxVault = ReturnType<typeof createSubmissionOutboxVault>;
