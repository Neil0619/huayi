import { Hono } from "hono";
import { z } from "zod/v3";

import { requireCronBearer } from "./cron-authentication.js";
import type { DuplicateSuggestionMaintenanceResult } from "./postgres-duplicate-suggestion-maintenance.js";

export const duplicateSuggestionCleanupRoute = "/internal/learning-duplicate-suggestions/cleanup";

const cleanupResponseSchema = z.strictObject({
  abandonedCount: z.number().int().nonnegative().max(100),
  deletedCount: z.number().int().nonnegative().max(100),
});

export function createDuplicateSuggestionMaintenanceApp(options: {
  cronSecret: string;
  maintenance: { runBatch(): Promise<DuplicateSuggestionMaintenanceResult> };
}) {
  const app = new Hono();
  app.get(duplicateSuggestionCleanupRoute, async (context) => {
    requireCronBearer(context, options.cronSecret, "Maintenance authentication is required.");
    return context.json(cleanupResponseSchema.parse(await options.maintenance.runBatch()));
  });
  return app;
}
