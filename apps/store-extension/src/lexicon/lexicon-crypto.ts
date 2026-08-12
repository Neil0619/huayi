import type { WordEntry } from "@huayi/store-domain";

import {
  decodeBase64,
  encodeBase64,
  LEXICON_PRODUCT_ID,
  parseWordEntry,
  recordAad,
  type EncryptedLexiconRecord,
} from "./lexicon-codec.js";
import { LexiconError } from "./lexicon-error.js";

const IV_BYTES = 12;
const KEY_BITS = 256;

function bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function buffer(value: Uint8Array): ArrayBuffer {
  return Uint8Array.from(value).buffer;
}

async function deriveKey(
  crypto: Crypto,
  material: CryptoKey,
  algorithm: "AES-GCM" | "HMAC",
  purpose: string,
): Promise<CryptoKey> {
  const derivedAlgorithm: AesDerivedKeyParams | HmacImportParams =
    algorithm === "AES-GCM"
      ? { length: KEY_BITS, name: "AES-GCM" }
      : { hash: "SHA-256", length: KEY_BITS, name: "HMAC" };
  return crypto.subtle.deriveKey(
    {
      hash: "SHA-256",
      info: buffer(bytes(`huayi-store/lexicon/${purpose}/v1`)),
      name: "HKDF",
      salt: buffer(bytes("huayi-store/lexicon/hkdf-salt/v1")),
    },
    material,
    derivedAlgorithm,
    false,
    algorithm === "AES-GCM" ? ["decrypt", "encrypt"] : ["sign"],
  );
}

async function importDek(crypto: Crypto, dek: Uint8Array): Promise<CryptoKey> {
  if (dek.length !== 32) {
    throw new LexiconError("data-corrupt");
  }
  return crypto.subtle.importKey("raw", buffer(dek), "HKDF", false, ["deriveKey"]);
}

function toHex(value: Uint8Array): string {
  return Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export interface LexiconCryptoContext {
  decryptRecord(record: EncryptedLexiconRecord): Promise<WordEntry>;
  encryptRecord(
    entry: WordEntry,
    opaqueId: string,
    revision: number,
  ): Promise<EncryptedLexiconRecord>;
  opaqueId(headword: string): Promise<string>;
}

export async function createLexiconCryptoContext(
  crypto: Crypto,
  dek: Uint8Array,
): Promise<LexiconCryptoContext> {
  const material = await importDek(crypto, dek);
  const [encryptionKey, indexKey] = await Promise.all([
    deriveKey(crypto, material, "AES-GCM", "record-encryption"),
    deriveKey(crypto, material, "HMAC", "opaque-index"),
  ]);
  const opaqueId = async (headword: string): Promise<string> => {
    const signature = await crypto.subtle.sign("HMAC", indexKey, buffer(bytes(headword)));
    return toHex(new Uint8Array(signature));
  };
  return {
    async decryptRecord(record) {
      let plaintext: ArrayBuffer;
      try {
        plaintext = await crypto.subtle.decrypt(
          {
            additionalData: buffer(recordAad(record)),
            iv: buffer(decodeBase64(record.iv, IV_BYTES)),
            name: "AES-GCM",
            tagLength: 128,
          },
          encryptionKey,
          buffer(decodeBase64(record.ciphertext)),
        );
      } catch {
        throw new LexiconError("data-corrupt");
      }
      let decoded: unknown;
      try {
        decoded = JSON.parse(
          new TextDecoder("utf-8", { fatal: true }).decode(plaintext),
        ) as unknown;
      } catch {
        throw new LexiconError("data-corrupt");
      }
      const entry = parseWordEntry(decoded);
      if ((await opaqueId(entry.id)) !== record.opaqueId) {
        throw new LexiconError("data-corrupt");
      }
      return entry;
    },
    async encryptRecord(entry, opaqueId, revision) {
      const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
      const recordIdentity = { opaqueId, revision };
      const ciphertext = await crypto.subtle.encrypt(
        {
          additionalData: buffer(recordAad(recordIdentity)),
          iv: buffer(iv),
          name: "AES-GCM",
          tagLength: 128,
        },
        encryptionKey,
        buffer(bytes(JSON.stringify(entry))),
      );
      return {
        algorithm: "AES-256-GCM",
        ciphertext: encodeBase64(new Uint8Array(ciphertext)),
        iv: encodeBase64(iv),
        kind: "huayi-store-lexicon-entry",
        opaqueId,
        product: LEXICON_PRODUCT_ID,
        revision,
        version: 1,
      };
    },
    opaqueId,
  };
}
