import { createHmac, timingSafeEqual } from "node:crypto";

import { resourceIdSchema } from "@huayi/cloud-contracts";
import { z } from "zod/v3";

import { CloudFault } from "./cloud-fault.js";

const envelopeSchema = z.strictObject({
  mac: z.string().regex(/^[A-Za-z0-9_-]{43}$/u),
  payload: z.string().min(1).max(1_024),
});
const payloadSchema = z.strictObject({
  createdAt: z.string().datetime({ offset: true }),
  id: resourceIdSchema,
  version: z.literal(1),
});

export function createExternalWordbookCursor(key: Uint8Array) {
  if (key.byteLength < 32) throw new Error("Wordbook cursor key must contain at least 256 bits.");
  const sign = (payload: string) =>
    createHmac("sha256", key)
      .update("huayi:external-wordbook-cursor:v1\0")
      .update(payload)
      .digest("base64url");
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
        return payloadSchema.parse(JSON.parse(envelope.payload));
      } catch {
        throw new CloudFault("invalid_request", "The external wordbook cursor is invalid.");
      }
    },
    encode(value: Omit<z.infer<typeof payloadSchema>, "version">) {
      const payload = JSON.stringify(payloadSchema.parse({ ...value, version: 1 }));
      return Buffer.from(JSON.stringify({ mac: sign(payload), payload })).toString("base64url");
    },
  };
}
