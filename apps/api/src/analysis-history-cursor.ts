import { resourceIdSchema } from "@huayi/cloud-contracts";
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod/v3";

import { CloudFault } from "./cloud-fault.js";

const payloadSchema = z.strictObject({
  createdAt: z.string().datetime({ offset: true }),
  id: resourceIdSchema,
  version: z.literal(1),
});
const envelopeSchema = z.strictObject({
  mac: z.string().regex(/^[A-Za-z0-9_-]{43}$/u),
  payload: z.string().min(1).max(1_024),
});
const signatureContext = "huayi:analysis-history-cursor:v1\0";

function sign(key: Uint8Array, payload: string): string {
  return createHmac("sha256", key).update(signatureContext).update(payload).digest("base64url");
}

export function createAnalysisHistoryCursor(key: Uint8Array) {
  if (key.byteLength < 32) throw new Error("Analysis cursor key must contain at least 256 bits.");
  return {
    decode(value: string) {
      try {
        const decoded = Buffer.from(value, "base64url");
        if (decoded.toString("base64url") !== value) throw new Error("Non-canonical cursor.");
        const envelope = envelopeSchema.parse(
          JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(decoded)),
        );
        const expected = Buffer.from(sign(key, envelope.payload), "base64url");
        const received = Buffer.from(envelope.mac, "base64url");
        if (expected.byteLength !== received.byteLength || !timingSafeEqual(expected, received)) {
          throw new Error("Invalid cursor signature.");
        }
        return payloadSchema.parse(JSON.parse(envelope.payload));
      } catch {
        throw new CloudFault("invalid_request", "The analysis cursor is invalid.");
      }
    },
    encode(boundary: { createdAt: string; id: string }) {
      const payload = JSON.stringify(payloadSchema.parse({ ...boundary, version: 1 }));
      return Buffer.from(JSON.stringify({ mac: sign(key, payload), payload })).toString(
        "base64url",
      );
    },
  };
}
