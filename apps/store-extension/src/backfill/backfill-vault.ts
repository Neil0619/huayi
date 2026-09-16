import { z } from "zod/v3";
import { backfillStateSchema, createBackfillState } from "@huayi/store-domain";
import { shanbayBackfillCommandSchema, shanbayBackfillStatusSchema } from "@huayi/cloud-contracts";
import type { DeviceVault } from "@huayi/store-domain";
import type { ExtensionSessionVaultStorage } from "../service-worker/extension-session-vault.js";
import { decodeBase64, encodeBase64 } from "../vault/vault-codec.js";
import { backfillPageReviewStateSchema } from "./backfill-review-state.js";

const progressSchema = z.strictObject({
  eudicPage: z.number().int().min(0).max(50).nullable(),
  eudicCompletedAt: z.string().nullable(),
  cloudCursor: z.string().uuid().nullable(),
  lastCheckedAt: z.string().nullable(),
  checkError: z.string().nullable(),
  incomplete: z.boolean(),
  localDiscovered: z.array(z.string()).default([]),
  checking: z.boolean().default(false),
  forceRequested: z.boolean().default(false),
});
const cloudScopeSchema = z.strictObject({
  status: shanbayBackfillStatusSchema,
  progress: progressSchema,
  adopted: z.boolean(),
  localExcluded: z.array(z.string()).default([]),
  adoptIndex: z.number().int().nonnegative(),
  adoptPhase: z.enum(["evidence", "sources"]).default("evidence"),
  pending: z
    .strictObject({ key: z.string().uuid(), command: shanbayBackfillCommandSchema })
    .nullable(),
});
export const backfillStorageSchema = z.strictObject({
  version: z.literal(1),
  local: backfillStateSchema,
  localEnabled: z.boolean(),
  localRevision: z.number().int().nonnegative(),
  localProgress: progressSchema,
  migratedTo: z.string().nullable(),
  activeScope: z.string(),
  sessionBinding: z
    .strictObject({ tokenHash: z.string().regex(/^[a-f0-9]{64}$/), scope: z.string() })
    .nullable()
    .default(null),
  initializationError: z
    .strictObject({
      tokenHash: z.string().regex(/^[a-f0-9]{64}$/),
      code: z.enum(["unavailable", "connection", "authentication", "request-failed", "permission"]),
    })
    .nullable()
    .default(null),
  scopes: z.record(cloudScopeSchema),
  page: z
    .strictObject({
      scope: z.string(),
      tabId: z.number().int(),
      documentId: z.string().nullable(),
      reviewRequested: z.boolean().optional(),
      review: backfillPageReviewStateSchema.nullable().optional(),
      batch: z
        .strictObject({
          token: z.string(),
          alias: z.string().uuid(),
          items: z
            .array(z.strictObject({ alias: z.string().uuid(), headword: z.string() }))
            .max(100),
        })
        .nullable(),
    })
    .nullable(),
});
export type BackfillStorage = z.infer<typeof backfillStorageSchema>;
export function initialBackfillProgress(): BackfillStorage["localProgress"] {
  return {
    eudicPage: null,
    eudicCompletedAt: null,
    cloudCursor: null,
    lastCheckedAt: null,
    checkError: null,
    incomplete: false,
    localDiscovered: [],
    checking: false,
    forceRequested: false,
  };
}
export function initialBackfillStorage(): BackfillStorage {
  return {
    version: 1,
    local: createBackfillState(),
    localEnabled: false,
    localRevision: 0,
    localProgress: initialBackfillProgress(),
    migratedTo: null,
    activeScope: "local",
    sessionBinding: null,
    initializationError: null,
    scopes: {},
    page: null,
  };
}
export const BACKFILL_STORAGE_KEY = "huayi.store.shanbay-backfill.v1";
const aad = new TextEncoder().encode(BACKFILL_STORAGE_KEY);
const envelope = z.strictObject({
  version: z.literal(1),
  iv: z.string().max(24),
  ciphertext: z.string().max(32_000_000),
});
export function createBackfillVault(
  device: Pick<DeviceVault, "getDek">,
  storage: ExtensionSessionVaultStorage,
) {
  const key = async () =>
    crypto.subtle.importKey("raw", Uint8Array.from(await device.getDek()), "AES-GCM", false, [
      "encrypt",
      "decrypt",
    ]);
  return {
    async read(): Promise<BackfillStorage> {
      const raw = await storage.read(BACKFILL_STORAGE_KEY);
      if (raw === undefined) return initialBackfillStorage();
      const saved = envelope.parse(raw);
      const plaintext = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: Uint8Array.from(decodeBase64(saved.iv, 12)), additionalData: aad },
        await key(),
        Uint8Array.from(decodeBase64(saved.ciphertext)),
      );
      return backfillStorageSchema.parse(JSON.parse(new TextDecoder().decode(plaintext)));
    },
    async write(value: BackfillStorage) {
      const bytes = new TextEncoder().encode(JSON.stringify(backfillStorageSchema.parse(value)));
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ciphertext = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv, additionalData: aad },
        await key(),
        bytes,
      );
      await storage.write(
        BACKFILL_STORAGE_KEY,
        envelope.parse({
          version: 1,
          iv: encodeBase64(iv),
          ciphertext: encodeBase64(new Uint8Array(ciphertext)),
        }),
      );
    },
  };
}
