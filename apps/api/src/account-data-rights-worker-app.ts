import { timingSafeEqual } from "node:crypto";

import {
  accountDataRightsHttpRoutes,
  dataRightsWorkerResponseSchema,
} from "@huayi/cloud-contracts";
import { Hono } from "hono";

import type { AccountDataRightsWorker } from "./account-data-rights-worker.js";
import { CloudFault } from "./cloud-fault.js";

function matchesSecret(presented: string | undefined, expected: string): boolean {
  if (presented === undefined || !presented.startsWith("Bearer ")) return false;
  const left = Buffer.from(presented.slice("Bearer ".length));
  const right = Buffer.from(expected);
  return left.byteLength === right.byteLength && timingSafeEqual(left, right);
}

export function createAccountDataRightsWorkerApp(options: {
  cronSecret: string;
  worker: AccountDataRightsWorker;
}) {
  const app = new Hono();
  app.get(accountDataRightsHttpRoutes.runWorker, async (context) => {
    if (!matchesSecret(context.req.header("authorization"), options.cronSecret)) {
      throw new CloudFault("authentication_required", "Worker authentication is required.");
    }
    context.header("Cache-Control", "private, no-store");
    return context.json(dataRightsWorkerResponseSchema.parse(await options.worker.runOne()));
  });
  return app;
}
