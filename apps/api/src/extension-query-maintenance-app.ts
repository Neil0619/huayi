import { timingSafeEqual } from "node:crypto";

import {
  extensionQueryCleanupResponseSchema,
  extensionQueryHttpRoutes,
} from "@huayi/cloud-contracts";
import { Hono } from "hono";

import { CloudFault } from "./cloud-fault.js";
import type { ExtensionQueryMaintenance } from "./extension-query-maintenance.js";

function matchesSecret(presented: string | undefined, expected: string): boolean {
  if (presented === undefined || !presented.startsWith("Bearer ")) return false;
  const left = Buffer.from(presented.slice("Bearer ".length));
  const right = Buffer.from(expected);
  return left.byteLength === right.byteLength && timingSafeEqual(left, right);
}

export function createExtensionQueryMaintenanceApp(options: {
  cronSecret: string;
  maintenance: ExtensionQueryMaintenance;
}) {
  const app = new Hono();
  app.get(extensionQueryHttpRoutes.cleanup, async (context) => {
    if (!matchesSecret(context.req.header("authorization"), options.cronSecret)) {
      throw new CloudFault("authentication_required", "Maintenance authentication is required.");
    }
    context.header("Cache-Control", "private, no-store");
    return context.json(
      extensionQueryCleanupResponseSchema.parse(await options.maintenance.runBatch()),
    );
  });
  return app;
}
