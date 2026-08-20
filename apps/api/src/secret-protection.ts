import { createCipheriv, createDecipheriv } from "node:crypto";

import type { SecretSource } from "./security.js";

const VERSION = "v1";

export function createSecretProtector(options: { key: Uint8Array; secrets: SecretSource }) {
  if (options.key.byteLength !== 32) throw new Error("Secret protection requires a 256-bit key.");
  const key = Buffer.from(options.key);

  return {
    protect(plaintext: string): string {
      const nonce = Buffer.from(options.secrets.bytes(12));
      const cipher = createCipheriv("aes-256-gcm", key, nonce);
      cipher.setAAD(Buffer.from(VERSION));
      const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
      return [
        VERSION,
        nonce.toString("base64url"),
        ciphertext.toString("base64url"),
        cipher.getAuthTag().toString("base64url"),
      ].join(".");
    },

    unprotect(protectedValue: string): string {
      const [version, encodedNonce, encodedCiphertext, encodedTag, extra] =
        protectedValue.split(".");
      if (
        version !== VERSION ||
        encodedNonce === undefined ||
        encodedCiphertext === undefined ||
        encodedTag === undefined ||
        extra !== undefined
      ) {
        throw new Error("The protected secret envelope is invalid.");
      }
      const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(encodedNonce, "base64url"));
      decipher.setAAD(Buffer.from(VERSION));
      decipher.setAuthTag(Buffer.from(encodedTag, "base64url"));
      return Buffer.concat([
        decipher.update(Buffer.from(encodedCiphertext, "base64url")),
        decipher.final(),
      ]).toString("utf8");
    },
  };
}
