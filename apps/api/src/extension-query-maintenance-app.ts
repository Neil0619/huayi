import {
  extensionQueryCleanupResponseSchema,
  extensionQueryHttpRoutes,
} from "@huayi/cloud-contracts";
import { Hono } from "hono";

import { requireCronBearer } from "./cron-authentication.js";
import type { ExtensionQueryMaintenance } from "./extension-query-maintenance.js";

export function createExtensionQueryMaintenanceApp(options: {
  cronSecret: string;
  maintenance: ExtensionQueryMaintenance;
}) {
  const app = new Hono();
  app.get(extensionQueryHttpRoutes.cleanup, async (context) => {
    requireCronBearer(context, options.cronSecret, "Maintenance authentication is required.");
    return context.json(
      extensionQueryCleanupResponseSchema.parse(await options.maintenance.runBatch()),
    );
  });
  return app;
}
