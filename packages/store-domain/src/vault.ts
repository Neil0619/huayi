import { z } from "zod/v3";

export const credentialSlotSchema = z.enum([
  "openai-api-key",
  "deepseek-api-key",
  "eudic-authorization",
]);
export type CredentialSlot = z.infer<typeof credentialSlotSchema>;

export type LegacyVaultMigrationInput =
  | { readonly kind: "passphrase"; readonly secret: string }
  | { readonly kind: "recovery-code"; readonly secret: string };

export type DeviceVaultReadiness = "migration-required" | "ready";

/**
 * The trusted-extension seam for encrypted local data.
 *
 * Callers never manage passwords or lock state. `ensureReady` creates or loads the device DEK;
 * only a legacy installation can require the explicit one-time migration method.
 */
export interface DeviceVault {
  ensureReady(): Promise<void>;
  getReadiness(): Promise<DeviceVaultReadiness>;
  migrateLegacy(input: LegacyVaultMigrationInput): Promise<void>;
  getCredential(slot: CredentialSlot): Promise<string | null>;
  setCredential(slot: CredentialSlot, value: string): Promise<void>;
  deleteCredential(slot: CredentialSlot): Promise<void>;
  getDek(): Promise<Uint8Array>;
}
