import { createHmac, timingSafeEqual } from "node:crypto";

import { resourceIdSchema } from "@huayi/cloud-contracts";
import { z } from "zod/v3";

import { CloudFault } from "./cloud-fault.js";

const envelopeSchema = z.strictObject({
  mac: z.string().regex(/^[A-Za-z0-9_-]{43}$/u),
  payload: z.string().min(1).max(1_024),
});
const wordPayloadSchema = z.strictObject({
  createdAt: z.string().datetime({ offset: true }),
  id: resourceIdSchema,
  version: z.literal(1),
});
const contextPayloadSchema = z.strictObject({
  id: resourceIdSchema,
  observedAt: z.string().datetime({ offset: true }),
  version: z.literal(1),
  wordId: resourceIdSchema,
});

function codec<T>(key: Uint8Array, context: string, schema: z.ZodType<T>) {
  const sign = (payload: string) =>
    createHmac("sha256", key).update(context).update(payload).digest("base64url");
  return {
    decode(value: string) {
      try {
        const decoded = Buffer.from(value, "base64url");
        if (decoded.toString("base64url") !== value) throw new Error("Non-canonical cursor.");
        const envelope = envelopeSchema.parse(JSON.parse(decoded.toString("utf8")));
        const expected = Buffer.from(sign(envelope.payload), "base64url");
        const received = Buffer.from(envelope.mac, "base64url");
        if (expected.byteLength !== received.byteLength || !timingSafeEqual(expected, received)) {
          throw new Error("Invalid cursor signature.");
        }
        return schema.parse(JSON.parse(envelope.payload));
      } catch {
        throw new CloudFault("invalid_request", "The word library cursor is invalid.");
      }
    },
    encode(value: Omit<T, "version">) {
      const payload = JSON.stringify(schema.parse({ ...value, version: 1 }));
      return Buffer.from(JSON.stringify({ mac: sign(payload), payload })).toString("base64url");
    },
  };
}

export function createWordLibraryCursor(key: Uint8Array) {
  if (key.byteLength < 32) throw new Error("Word cursor key must contain at least 256 bits.");
  return {
    contexts: codec(key, "huayi:word-context-cursor:v1\0", contextPayloadSchema),
    words: codec(key, "huayi:word-library-cursor:v1\0", wordPayloadSchema),
  };
}
