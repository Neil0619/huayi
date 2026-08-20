import { createHmac, timingSafeEqual } from "node:crypto";

import { externalWordbookDirectionSchema, resourceIdSchema } from "@huayi/cloud-contracts";
import { z } from "zod/v3";

import { CloudFault } from "./cloud-fault.js";

const kindSchema = z.enum(["eudic-import", "export"]);
const payloadSchema = z.strictObject({
  expiresAt: z.string().datetime({ offset: true }),
  jobId: resourceIdSchema,
  kind: kindSchema,
  nonce: z
    .string()
    .min(43)
    .max(128)
    .regex(/^[A-Za-z0-9_-]+$/u),
  version: z.literal(1),
});
const envelopeSchema = z.strictObject({
  mac: z.string().regex(/^[A-Za-z0-9_-]{43}$/u),
  payload: z.string().min(1).max(1_024),
});

export type ExternalWordbookLeaseTokenPayload = Omit<z.infer<typeof payloadSchema>, "version">;

export function createExternalWordbookLeaseToken(key: Uint8Array) {
  if (key.byteLength < 32) throw new Error("Wordbook lease key must contain at least 256 bits.");
  const sign = (payload: string) =>
    createHmac("sha256", key)
      .update("huayi:external-wordbook-lease:v1\0")
      .update(payload)
      .digest("base64url");
  return {
    decode(value: string) {
      try {
        const decoded = Buffer.from(value, "base64url");
        if (decoded.toString("base64url") !== value) throw new Error("Non-canonical token.");
        const envelope = envelopeSchema.parse(JSON.parse(decoded.toString("utf8")));
        const expected = Buffer.from(sign(envelope.payload), "base64url");
        const received = Buffer.from(envelope.mac, "base64url");
        if (expected.byteLength !== received.byteLength || !timingSafeEqual(expected, received)) {
          throw new Error("Invalid token signature.");
        }
        return payloadSchema.parse(JSON.parse(envelope.payload));
      } catch {
        throw new CloudFault("wordbook_lease_stale", "The external wordbook lease is invalid.");
      }
    },
    encode(value: ExternalWordbookLeaseTokenPayload) {
      externalWordbookDirectionSchema.parse(value.kind === "export" ? "export" : "import");
      const payload = JSON.stringify(payloadSchema.parse({ ...value, version: 1 }));
      return Buffer.from(JSON.stringify({ mac: sign(payload), payload })).toString("base64url");
    },
  };
}
