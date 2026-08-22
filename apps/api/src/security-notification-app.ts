import { timingSafeEqual } from "node:crypto";

import {
  securityNotificationHttpRoutes,
  securityNotificationRunResponseSchema,
} from "@huayi/cloud-contracts";
import { Hono } from "hono";

import { CloudFault } from "./cloud-fault.js";
import type { SecurityNotificationWorker } from "./security-notification-worker.js";

function matchesSecret(presented: string | undefined, expected: string): boolean {
  if (presented === undefined || !presented.startsWith("Bearer ")) return false;
  const left = Buffer.from(presented.slice("Bearer ".length));
  const right = Buffer.from(expected);
  return left.byteLength === right.byteLength && timingSafeEqual(left, right);
}

export function createSecurityNotificationApp(options: {
  cronSecret: string;
  worker: Pick<SecurityNotificationWorker, "runOne">;
}) {
  const app = new Hono();
  app.get(securityNotificationHttpRoutes.run, async (context) => {
    if (!matchesSecret(context.req.header("authorization"), options.cronSecret)) {
      throw new CloudFault("authentication_required", "Worker authentication is required.");
    }
    context.header("Cache-Control", "private, no-store");
    return context.json(
      securityNotificationRunResponseSchema.parse({ outcome: await options.worker.runOne() }),
    );
  });
  return app;
}
