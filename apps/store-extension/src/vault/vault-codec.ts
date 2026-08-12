import { credentialSlotSchema, type CredentialSlot } from "@huayi/store-domain";

import { VaultError } from "./vault-error.js";

export const VAULT_PRODUCT_ID = "huayi-store";
export const VAULT_SCHEMA_VERSION = 1;
export const RECOVERY_CONFIRMATION_VERSION = 1;

const WRAPPER_KIND = "huayi-store-vault-wrapper";
const METADATA_KIND = "huayi-store-vault-metadata";
const CREDENTIAL_KIND = "huayi-store-vault-credential";
const SESSION_KIND = "huayi-store-vault-session";
const DEVICE_KEY_KIND = "huayi-store-device-vault-key";

export type WrapperSlot = "passphrase" | "recovery";

export interface CipherEnvelope {
  readonly algorithm: "AES-256-GCM";
  readonly ciphertext: string;
  readonly iv: string;
}

export interface WrappedDekEnvelope {
  readonly cipher: CipherEnvelope;
  readonly kdf: {
    readonly algorithm: "PBKDF2";
    readonly hash: "SHA-256";
    readonly iterations: number;
    readonly salt: string;
  };
  readonly kind: typeof WRAPPER_KIND;
  readonly slot: WrapperSlot;
  readonly version: typeof VAULT_SCHEMA_VERSION;
}

export interface VaultMetadataEnvelope {
  readonly kind: typeof METADATA_KIND;
  readonly passphraseWrapper: WrappedDekEnvelope;
  readonly product: typeof VAULT_PRODUCT_ID;
  readonly recoveryConfirmation: {
    readonly confirmed: boolean;
    readonly version: typeof RECOVERY_CONFIRMATION_VERSION;
  };
  readonly recoveryWrapper: WrappedDekEnvelope;
  readonly version: typeof VAULT_SCHEMA_VERSION;
}

export interface CredentialEnvelope {
  readonly cipher: CipherEnvelope;
  readonly kind: typeof CREDENTIAL_KIND;
  readonly product: typeof VAULT_PRODUCT_ID;
  readonly slot: CredentialSlot;
  readonly version: typeof VAULT_SCHEMA_VERSION;
}

export interface SessionEnvelope {
  readonly dek: string;
  readonly kind: typeof SESSION_KIND;
  readonly product: typeof VAULT_PRODUCT_ID;
  readonly version: typeof VAULT_SCHEMA_VERSION;
}

export interface DeviceKeyEnvelope {
  readonly dek: string;
  readonly kind: typeof DEVICE_KEY_KIND;
  readonly product: typeof VAULT_PRODUCT_ID;
  readonly version: typeof VAULT_SCHEMA_VERSION;
}

function isStrictRecord(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const actualKeys = Object.keys(value);
  return actualKeys.length === keys.length && actualKeys.every((key) => keys.includes(key));
}

function parseCipherEnvelope(value: unknown): CipherEnvelope {
  if (
    !isStrictRecord(value, ["algorithm", "ciphertext", "iv"]) ||
    value.algorithm !== "AES-256-GCM" ||
    typeof value.ciphertext !== "string" ||
    typeof value.iv !== "string"
  ) {
    throw new VaultError("invalid-persisted-data");
  }
  decodeBase64(value.iv, 12);
  decodeBase64(value.ciphertext, undefined, 16);
  return {
    algorithm: value.algorithm,
    ciphertext: value.ciphertext,
    iv: value.iv,
  };
}

function parseWrappedDekEnvelope(
  value: unknown,
  slot: WrapperSlot,
  expectedIterations: number,
): WrappedDekEnvelope {
  if (
    !isStrictRecord(value, ["cipher", "kdf", "kind", "slot", "version"]) ||
    value.kind !== WRAPPER_KIND ||
    value.slot !== slot ||
    value.version !== VAULT_SCHEMA_VERSION ||
    !isStrictRecord(value.kdf, ["algorithm", "hash", "iterations", "salt"]) ||
    value.kdf.algorithm !== "PBKDF2" ||
    value.kdf.hash !== "SHA-256" ||
    value.kdf.iterations !== expectedIterations ||
    typeof value.kdf.salt !== "string"
  ) {
    throw new VaultError("invalid-persisted-data");
  }
  decodeBase64(value.kdf.salt, 16);
  return {
    cipher: parseCipherEnvelope(value.cipher),
    kdf: {
      algorithm: value.kdf.algorithm,
      hash: value.kdf.hash,
      iterations: value.kdf.iterations,
      salt: value.kdf.salt,
    },
    kind: value.kind,
    slot,
    version: value.version,
  };
}

export function parseVaultMetadata(
  value: unknown,
  expectedIterations: number,
): VaultMetadataEnvelope {
  if (
    !isStrictRecord(value, [
      "kind",
      "passphraseWrapper",
      "product",
      "recoveryConfirmation",
      "recoveryWrapper",
      "version",
    ]) ||
    value.kind !== METADATA_KIND ||
    value.product !== VAULT_PRODUCT_ID ||
    value.version !== VAULT_SCHEMA_VERSION ||
    !isStrictRecord(value.recoveryConfirmation, ["confirmed", "version"]) ||
    typeof value.recoveryConfirmation.confirmed !== "boolean" ||
    value.recoveryConfirmation.version !== RECOVERY_CONFIRMATION_VERSION
  ) {
    throw new VaultError("invalid-persisted-data");
  }
  return {
    kind: value.kind,
    passphraseWrapper: parseWrappedDekEnvelope(
      value.passphraseWrapper,
      "passphrase",
      expectedIterations,
    ),
    product: value.product,
    recoveryConfirmation: {
      confirmed: value.recoveryConfirmation.confirmed,
      version: value.recoveryConfirmation.version,
    },
    recoveryWrapper: parseWrappedDekEnvelope(value.recoveryWrapper, "recovery", expectedIterations),
    version: value.version,
  };
}

export function parseCredentialEnvelope(value: unknown, slot: CredentialSlot): CredentialEnvelope {
  if (
    !isStrictRecord(value, ["cipher", "kind", "product", "slot", "version"]) ||
    value.kind !== CREDENTIAL_KIND ||
    value.product !== VAULT_PRODUCT_ID ||
    value.slot !== slot ||
    value.version !== VAULT_SCHEMA_VERSION
  ) {
    throw new VaultError("invalid-persisted-data");
  }
  const parsedSlot = credentialSlotSchema.safeParse(value.slot);
  if (!parsedSlot.success) {
    throw new VaultError("invalid-persisted-data");
  }
  return {
    cipher: parseCipherEnvelope(value.cipher),
    kind: value.kind,
    product: value.product,
    slot: parsedSlot.data,
    version: value.version,
  };
}

export function parseSessionEnvelope(value: unknown): SessionEnvelope {
  if (
    !isStrictRecord(value, ["dek", "kind", "product", "version"]) ||
    value.kind !== SESSION_KIND ||
    value.product !== VAULT_PRODUCT_ID ||
    value.version !== VAULT_SCHEMA_VERSION ||
    typeof value.dek !== "string"
  ) {
    throw new VaultError("invalid-persisted-data");
  }
  decodeBase64(value.dek, 32);
  return {
    dek: value.dek,
    kind: value.kind,
    product: value.product,
    version: value.version,
  };
}

export function parseDeviceKeyEnvelope(value: unknown): DeviceKeyEnvelope {
  if (
    !isStrictRecord(value, ["dek", "kind", "product", "version"]) ||
    value.kind !== DEVICE_KEY_KIND ||
    value.product !== VAULT_PRODUCT_ID ||
    value.version !== VAULT_SCHEMA_VERSION ||
    typeof value.dek !== "string"
  ) {
    throw new VaultError("invalid-persisted-data");
  }
  decodeBase64(value.dek, 32);
  return { dek: value.dek, kind: value.kind, product: value.product, version: value.version };
}

export function createVaultMetadata(
  passphraseWrapper: WrappedDekEnvelope,
  recoveryWrapper: WrappedDekEnvelope,
  recoveryConfirmed: boolean,
): VaultMetadataEnvelope {
  return {
    kind: METADATA_KIND,
    passphraseWrapper,
    product: VAULT_PRODUCT_ID,
    recoveryConfirmation: {
      confirmed: recoveryConfirmed,
      version: RECOVERY_CONFIRMATION_VERSION,
    },
    recoveryWrapper,
    version: VAULT_SCHEMA_VERSION,
  };
}

export function createCredentialEnvelope(
  slot: CredentialSlot,
  cipher: CipherEnvelope,
): CredentialEnvelope {
  return {
    cipher,
    kind: CREDENTIAL_KIND,
    product: VAULT_PRODUCT_ID,
    slot,
    version: VAULT_SCHEMA_VERSION,
  };
}

export function createSessionEnvelope(dek: Uint8Array): SessionEnvelope {
  return {
    dek: encodeBase64(dek),
    kind: SESSION_KIND,
    product: VAULT_PRODUCT_ID,
    version: VAULT_SCHEMA_VERSION,
  };
}

export function createDeviceKeyEnvelope(dek: Uint8Array): DeviceKeyEnvelope {
  return {
    dek: encodeBase64(dek),
    kind: DEVICE_KEY_KIND,
    product: VAULT_PRODUCT_ID,
    version: VAULT_SCHEMA_VERSION,
  };
}

export function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

export function decodeBase64(
  value: string,
  exactLength?: number,
  minimumLength?: number,
): Uint8Array {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new VaultError("invalid-persisted-data");
  }
  let binary: string;
  try {
    binary = atob(value);
  } catch {
    throw new VaultError("invalid-persisted-data");
  }
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  if (encodeBase64(bytes) !== value) {
    throw new VaultError("invalid-persisted-data");
  }
  if (
    (exactLength !== undefined && bytes.length !== exactLength) ||
    (minimumLength !== undefined && bytes.length < minimumLength)
  ) {
    throw new VaultError("invalid-persisted-data");
  }
  return bytes;
}

export function wrapperAad(slot: WrapperSlot): Uint8Array {
  return new TextEncoder().encode(
    `product=${VAULT_PRODUCT_ID};record=vault-wrapper:${slot};schema=${VAULT_SCHEMA_VERSION}`,
  );
}

export function credentialAad(slot: CredentialSlot): Uint8Array {
  return new TextEncoder().encode(
    `product=${VAULT_PRODUCT_ID};record=credential:${slot};schema=${VAULT_SCHEMA_VERSION}`,
  );
}
