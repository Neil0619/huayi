import {
  accountDataRightsHttpRoutes,
  dataRightsWorkerResponseSchema,
} from "@huayi/cloud-contracts";
import { Hono } from "hono";

import type { AccountDataRightsWorker } from "./account-data-rights-worker.js";
import { requireCronBearer } from "./cron-authentication.js";

export function createAccountDataRightsWorkerApp(options: {
  cronSecret: string;
  worker: AccountDataRightsWorker;
}) {
  const app = new Hono();
  app.get(accountDataRightsHttpRoutes.runWorker, async (context) => {
    requireCronBearer(context, options.cronSecret, "Worker authentication is required.");
    return context.json(dataRightsWorkerResponseSchema.parse(await options.worker.runOne()));
  });
  return app;
}
