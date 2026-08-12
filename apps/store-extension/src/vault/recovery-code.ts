import { VaultError } from "./vault-error.js";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const RECOVERY_PREFIX = "HUAYI1";
const RANDOM_BYTE_COUNT = 32;
const CHECKSUM_BYTE_COUNT = 4;

function encodeBase32(bytes: Uint8Array): string {
  let bits = 0;
  let buffer = 0;
  let encoded = "";
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      encoded += BASE32_ALPHABET[(buffer >>> bits) & 31];
    }
  }
  if (bits > 0) {
    encoded += BASE32_ALPHABET[(buffer << (5 - bits)) & 31];
  }
  return encoded;
}

function decodeBase32(value: string): Uint8Array {
  let bits = 0;
  let buffer = 0;
  const decoded: number[] = [];
  for (const character of value) {
    const index = BASE32_ALPHABET.indexOf(character);
    if (index < 0) {
      throw new VaultError("invalid-recovery-code");
    }
    buffer = (buffer << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      decoded.push((buffer >>> bits) & 255);
    }
  }
  if (decoded.length !== RANDOM_BYTE_COUNT || bits !== 4 || (buffer & 15) !== 0) {
    throw new VaultError("invalid-recovery-code");
  }
  return Uint8Array.from(decoded);
}

async function checksumHex(crypto: Crypto, bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes).buffer),
  );
  return [...digest.slice(0, CHECKSUM_BYTE_COUNT)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

export async function createRecoveryCode(
  crypto: Crypto,
): Promise<{ readonly code: string; readonly secret: Uint8Array }> {
  const secret = crypto.getRandomValues(new Uint8Array(RANDOM_BYTE_COUNT));
  const encoded = encodeBase32(secret);
  const groups = encoded.match(/.{4}/g);
  if (groups === null || groups.length !== 13) {
    throw new VaultError("invalid-recovery-code");
  }
  const checksum = await checksumHex(crypto, secret);
  return { code: `${RECOVERY_PREFIX}-${groups.join("-")}-${checksum}`, secret };
}

export async function parseRecoveryCode(crypto: Crypto, code: string): Promise<Uint8Array> {
  const pattern = /^HUAYI1-((?:[A-Z2-7]{4}-){12}[A-Z2-7]{4})-([A-F0-9]{8})$/;
  const match = pattern.exec(code);
  if (match === null) {
    throw new VaultError("invalid-recovery-code");
  }
  const encoded = match[1]?.replaceAll("-", "");
  const providedChecksum = match[2];
  if (encoded === undefined || providedChecksum === undefined) {
    throw new VaultError("invalid-recovery-code");
  }
  const secret = decodeBase32(encoded);
  const expectedChecksum = await checksumHex(crypto, secret);
  let difference = 0;
  for (let index = 0; index < expectedChecksum.length; index += 1) {
    difference |= expectedChecksum.charCodeAt(index) ^ providedChecksum.charCodeAt(index);
  }
  if (difference !== 0) {
    throw new VaultError("invalid-recovery-code");
  }
  return secret;
}
