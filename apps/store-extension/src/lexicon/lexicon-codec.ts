import { wordEntrySchema, type WordEntry } from "@huayi/store-domain";

import { LexiconError } from "./lexicon-error.js";

export const LEXICON_PRODUCT_ID = "huayi-store";
export const LEXICON_RECORD_VERSION = 1;

const RECORD_KIND = "huayi-store-lexicon-entry";

export interface EncryptedLexiconRecord {
  readonly algorithm: "AES-256-GCM";
  readonly ciphertext: string;
  readonly iv: string;
  readonly kind: typeof RECORD_KIND;
  readonly opaqueId: string;
  readonly product: typeof LEXICON_PRODUCT_ID;
  readonly revision: number;
  readonly version: typeof LEXICON_RECORD_VERSION;
}

function isStrictRecord(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const actualKeys = Object.keys(value);
  return actualKeys.length === keys.length && actualKeys.every((key) => keys.includes(key));
}

function requireBase64(value: unknown, minimumBytes: number, exactBytes?: number): string {
  if (
    typeof value !== "string" ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
  ) {
    throw new LexiconError("data-corrupt");
  }
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
  } catch {
    throw new LexiconError("data-corrupt");
  }
  if (
    bytes.length < minimumBytes ||
    (exactBytes !== undefined && bytes.length !== exactBytes) ||
    encodeBase64(bytes) !== value
  ) {
    throw new LexiconError("data-corrupt");
  }
  return value;
}

export function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function decodeBase64(value: string, exactBytes?: number): Uint8Array {
  requireBase64(value, 0, exactBytes);
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

export function parseEncryptedRecord(value: unknown): EncryptedLexiconRecord {
  if (
    !isStrictRecord(value, [
      "algorithm",
      "ciphertext",
      "iv",
      "kind",
      "opaqueId",
      "product",
      "revision",
      "version",
    ]) ||
    value.algorithm !== "AES-256-GCM" ||
    value.kind !== RECORD_KIND ||
    value.product !== LEXICON_PRODUCT_ID ||
    value.version !== LEXICON_RECORD_VERSION ||
    typeof value.opaqueId !== "string" ||
    !/^[a-f0-9]{64}$/.test(value.opaqueId) ||
    !Number.isSafeInteger(value.revision) ||
    (value.revision as number) < 1
  ) {
    throw new LexiconError("data-corrupt");
  }
  return {
    algorithm: value.algorithm,
    ciphertext: requireBase64(value.ciphertext, 16),
    iv: requireBase64(value.iv, 12, 12),
    kind: value.kind,
    opaqueId: value.opaqueId,
    product: value.product,
    revision: value.revision as number,
    version: value.version,
  };
}

export function parseWordEntry(value: unknown): WordEntry {
  const parsed = wordEntrySchema.safeParse(value);
  if (!parsed.success) throw new LexiconError("data-corrupt");
  return parsed.data;
}

export function recordAad(
  record: Pick<EncryptedLexiconRecord, "opaqueId" | "revision">,
): Uint8Array {
  return new TextEncoder().encode(
    `product=${LEXICON_PRODUCT_ID};record=lexicon-entry;id=${record.opaqueId};schema=${LEXICON_RECORD_VERSION};revision=${record.revision}`,
  );
}
