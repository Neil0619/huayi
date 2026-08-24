import { timingSafeEqual } from "node:crypto";

import type { Context } from "hono";

import { CloudFault } from "./cloud-fault.js";

export function requireCronBearer(context: Context, expected: string, message: string): void {
  context.header("Cache-Control", "private, no-store");
  const presented = context.req.header("authorization");
  if (presented === undefined || !presented.startsWith("Bearer ")) {
    throw new CloudFault("authentication_required", message);
  }
  const left = Buffer.from(presented.slice("Bearer ".length));
  const right = Buffer.from(expected);
  if (left.byteLength !== right.byteLength || !timingSafeEqual(left, right)) {
    throw new CloudFault("authentication_required", message);
  }
}
