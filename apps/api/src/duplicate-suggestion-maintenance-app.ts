import { timingSafeEqual } from "node:crypto";

import { Hono } from "hono";
import { z } from "zod/v3";

import { CloudFault } from "./cloud-fault.js";
import type { DuplicateSuggestionMaintenanceResult } from "./postgres-duplicate-suggestion-maintenance.js";

export const duplicateSuggestionCleanupRoute = "/internal/learning-duplicate-suggestions/cleanup";

const cleanupResponseSchema = z.strictObject({
  abandonedCount: z.number().int().nonnegative().max(100),
  deletedCount: z.number().int().nonnegative().max(100),
});

function matchesSecret(presented: string | undefined, expected: string): boolean {
  if (presented === undefined || !presented.startsWith("Bearer ")) return false;
  const left = Buffer.from(presented.slice("Bearer ".length));
  const right = Buffer.from(expected);
  return left.byteLength === right.byteLength && timingSafeEqual(left, right);
}

export function createDuplicateSuggestionMaintenanceApp(options: {
  cronSecret: string;
  maintenance: { runBatch(): Promise<DuplicateSuggestionMaintenanceResult> };
}) {
  const app = new Hono();
  app.get(duplicateSuggestionCleanupRoute, async (context) => {
    if (!matchesSecret(context.req.header("authorization"), options.cronSecret)) {
      throw new CloudFault("authentication_required", "Maintenance authentication is required.");
    }
    context.header("Cache-Control", "private, no-store");
    return context.json(cleanupResponseSchema.parse(await options.maintenance.runBatch()));
  });
  return app;
}
