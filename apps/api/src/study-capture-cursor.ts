import { cursorSchema, resourceIdSchema } from "@huayi/cloud-contracts";
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod/v3";

import { CloudFault } from "./cloud-fault.js";

const payloadSchema = z.strictObject({
  id: resourceIdSchema,
  updatedAt: z.string().datetime({ offset: true }),
  version: z.literal(1),
});
const envelopeSchema = z.strictObject({
  mac: z.string().regex(/^[A-Za-z0-9_-]{43}$/u),
  payload: z.string().min(1).max(1_024),
});
const context = "huayi:study-capture-cursor:v1\0";

function sign(key: Uint8Array, payload: string) {
  return createHmac("sha256", key).update(context).update(payload).digest("base64url");
}

export function createStudyCaptureCursor(key: Uint8Array) {
  if (key.byteLength < 32) throw new Error("StudyCapture cursor key is too short.");
  return {
    decode(value: string) {
      try {
        const canonical = cursorSchema.parse(value);
        const bytes = Buffer.from(canonical, "base64url");
        if (bytes.toString("base64url") !== canonical) throw new Error("Non-canonical cursor.");
        const envelope = envelopeSchema.parse(JSON.parse(bytes.toString("utf8")));
        const expected = Buffer.from(sign(key, envelope.payload), "base64url");
        const received = Buffer.from(envelope.mac, "base64url");
        if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
          throw new Error("Invalid cursor signature.");
        }
        return payloadSchema.parse(JSON.parse(envelope.payload));
      } catch {
        throw new CloudFault("invalid_request", "The StudyCapture cursor is invalid.");
      }
    },
    encode(boundary: { id: string; updatedAt: string }) {
      const payload = JSON.stringify(payloadSchema.parse({ ...boundary, version: 1 }));
      return Buffer.from(JSON.stringify({ mac: sign(key, payload), payload })).toString(
        "base64url",
      );
    },
  };
}
