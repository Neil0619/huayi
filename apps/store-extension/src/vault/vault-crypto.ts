import type { CredentialSlot } from "@huayi/store-domain";

import {
  createCredentialEnvelope,
  credentialAad,
  decodeBase64,
  encodeBase64,
  wrapperAad,
  type CipherEnvelope,
  type CredentialEnvelope,
  type WrappedDekEnvelope,
  type WrapperSlot,
} from "./vault-codec.js";
import { VaultError } from "./vault-error.js";

const AES_KEY_BITS = 256;
const AES_IV_BYTES = 12;
const KDF_SALT_BYTES = 16;
const DEK_BYTES = 32;

function randomBytes(crypto: Crypto, length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length));
}

async function importAesKey(crypto: Crypto, bytes: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", Uint8Array.from(bytes).buffer, "AES-GCM", false, [
    "decrypt",
    "encrypt",
  ]);
}

async function deriveKek(
  crypto: Crypto,
  secret: Uint8Array,
  salt: Uint8Array,
  iterations: number,
): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    "raw",
    Uint8Array.from(secret).buffer,
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { hash: "SHA-256", iterations, name: "PBKDF2", salt: Uint8Array.from(salt).buffer },
    material,
    { length: AES_KEY_BITS, name: "AES-GCM" },
    false,
    ["decrypt", "encrypt"],
  );
}

async function encrypt(
  crypto: Crypto,
  key: CryptoKey,
  plaintext: Uint8Array,
  aad: Uint8Array,
): Promise<CipherEnvelope> {
  const iv = randomBytes(crypto, AES_IV_BYTES);
  const ciphertext = await crypto.subtle.encrypt(
    {
      additionalData: Uint8Array.from(aad).buffer,
      iv: Uint8Array.from(iv).buffer,
      name: "AES-GCM",
      tagLength: 128,
    },
    key,
    Uint8Array.from(plaintext).buffer,
  );
  return {
    algorithm: "AES-256-GCM",
    ciphertext: encodeBase64(new Uint8Array(ciphertext)),
    iv: encodeBase64(iv),
  };
}

async function decrypt(
  crypto: Crypto,
  key: CryptoKey,
  cipher: CipherEnvelope,
  aad: Uint8Array,
): Promise<Uint8Array> {
  try {
    const plaintext = await crypto.subtle.decrypt(
      {
        additionalData: Uint8Array.from(aad).buffer,
        iv: Uint8Array.from(decodeBase64(cipher.iv, AES_IV_BYTES)).buffer,
        name: "AES-GCM",
        tagLength: 128,
      },
      key,
      Uint8Array.from(decodeBase64(cipher.ciphertext, undefined, 16)).buffer,
    );
    return new Uint8Array(plaintext);
  } catch (error) {
    if (error instanceof VaultError && error.code === "invalid-persisted-data") {
      throw error;
    }
    throw new VaultError("authentication-failed");
  }
}

export function createDek(crypto: Crypto): Uint8Array {
  return randomBytes(crypto, DEK_BYTES);
}

export async function wrapDek(
  crypto: Crypto,
  dek: Uint8Array,
  secret: Uint8Array,
  slot: WrapperSlot,
  iterations: number,
): Promise<WrappedDekEnvelope> {
  const salt = randomBytes(crypto, KDF_SALT_BYTES);
  const kek = await deriveKek(crypto, secret, salt, iterations);
  return {
    cipher: await encrypt(crypto, kek, dek, wrapperAad(slot)),
    kdf: {
      algorithm: "PBKDF2",
      hash: "SHA-256",
      iterations,
      salt: encodeBase64(salt),
    },
    kind: "huayi-store-vault-wrapper",
    slot,
    version: 1,
  };
}

export async function unwrapDek(
  crypto: Crypto,
  wrapper: WrappedDekEnvelope,
  secret: Uint8Array,
): Promise<Uint8Array> {
  const kek = await deriveKek(
    crypto,
    secret,
    decodeBase64(wrapper.kdf.salt, KDF_SALT_BYTES),
    wrapper.kdf.iterations,
  );
  const dek = await decrypt(crypto, kek, wrapper.cipher, wrapperAad(wrapper.slot));
  if (dek.length !== DEK_BYTES) {
    throw new VaultError("authentication-failed");
  }
  return dek;
}

export async function encryptCredential(
  crypto: Crypto,
  dek: Uint8Array,
  slot: CredentialSlot,
  value: string,
): Promise<CredentialEnvelope> {
  const key = await importAesKey(crypto, dek);
  const cipher = await encrypt(crypto, key, new TextEncoder().encode(value), credentialAad(slot));
  return createCredentialEnvelope(slot, cipher);
}

export async function decryptCredential(
  crypto: Crypto,
  dek: Uint8Array,
  record: CredentialEnvelope,
): Promise<string> {
  const key = await importAesKey(crypto, dek);
  const plaintext = await decrypt(crypto, key, record.cipher, credentialAad(record.slot));
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(plaintext);
  } catch {
    throw new VaultError("authentication-failed");
  }
}
