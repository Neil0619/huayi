import {
  securityNotificationHttpRoutes,
  securityNotificationRunResponseSchema,
} from "@huayi/cloud-contracts";
import { Hono } from "hono";

import { requireCronBearer } from "./cron-authentication.js";
import type { SecurityNotificationWorker } from "./security-notification-worker.js";

export function createSecurityNotificationApp(options: {
  cronSecret: string;
  worker: Pick<SecurityNotificationWorker, "runOne">;
}) {
  const app = new Hono();
  app.get(securityNotificationHttpRoutes.run, async (context) => {
    requireCronBearer(context, options.cronSecret, "Worker authentication is required.");
    return context.json(
      securityNotificationRunResponseSchema.parse({ outcome: await options.worker.runOne() }),
    );
  });
  return app;
}
