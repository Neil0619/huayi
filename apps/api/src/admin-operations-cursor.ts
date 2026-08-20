import { createHmac, timingSafeEqual } from "node:crypto";

import { resourceIdSchema } from "@huayi/cloud-contracts";
import { z } from "zod/v3";

import { CloudFault } from "./cloud-fault.js";

const payloadSchema = z.strictObject({
  createdAt: z.string().datetime({ offset: true }),
  id: resourceIdSchema,
  kind: z.enum(["audit", "invitations", "users"]),
  version: z.literal(1),
});
const envelopeSchema = z.strictObject({
  mac: z.string().regex(/^[A-Za-z0-9_-]{43}$/u),
  payload: z.string().min(1).max(1_024),
});
const context = "huayi:admin-operations-cursor:v1\0";

function sign(key: Uint8Array, payload: string): string {
  return createHmac("sha256", key).update(context).update(payload).digest("base64url");
}

export function createAdminOperationsCursor(key: Uint8Array) {
  if (key.byteLength < 32) throw new Error("Admin cursor key must contain at least 256 bits.");
  return {
    decode(value: string, kind: "audit" | "invitations" | "users") {
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
        const payload = payloadSchema.parse(JSON.parse(envelope.payload));
        if (payload.kind !== kind) throw new Error("Wrong cursor context.");
        return { createdAt: payload.createdAt, id: payload.id };
      } catch {
        throw new CloudFault("invalid_request", "The admin cursor is invalid.");
      }
    },
    encode(kind: "audit" | "invitations" | "users", boundary: { createdAt: string; id: string }) {
      const payload = JSON.stringify(payloadSchema.parse({ ...boundary, kind, version: 1 }));
      return Buffer.from(JSON.stringify({ mac: sign(key, payload), payload })).toString(
        "base64url",
      );
    },
  };
}
