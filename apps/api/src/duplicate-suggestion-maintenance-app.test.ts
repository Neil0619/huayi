import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

import { CloudFault } from "./cloud-fault.js";
import { errorStatus } from "./cloud-foundation-app.js";
import {
  createDuplicateSuggestionMaintenanceApp,
  duplicateSuggestionCleanupRoute,
} from "./duplicate-suggestion-maintenance-app.js";

describe("duplicate suggestion maintenance HTTP adapter", () => {
  it("accepts only the fixed cron bearer and returns bounded counts without task data", async () => {
    const runBatch = vi.fn(async () => ({ abandonedCount: 2, deletedCount: 3 }));
    const outer = new Hono();
    outer.onError((error, context) => {
      const fault =
        error instanceof CloudFault ? error : new CloudFault("invalid_request", "Request failed.");
      return context.json({ code: fault.code }, errorStatus(fault.code));
    });
    outer.route(
      "/",
      createDuplicateSuggestionMaintenanceApp({
        cronSecret: "s".repeat(32),
        maintenance: { runBatch },
      }),
    );

    const missingBearer = await outer.request(duplicateSuggestionCleanupRoute);
    expect(missingBearer.status).toBe(401);
    expect(missingBearer.headers.get("cache-control")).toBe("private, no-store");
    const wrongBearer = await outer.request(duplicateSuggestionCleanupRoute, {
      headers: { authorization: `Bearer ${"x".repeat(32)}` },
    });
    expect(wrongBearer.status).toBe(401);
    expect(wrongBearer.headers.get("cache-control")).toBe("private, no-store");
    const response = await outer.request(duplicateSuggestionCleanupRoute, {
      headers: { authorization: `Bearer ${"s".repeat(32)}` },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ abandonedCount: 2, deletedCount: 3 });
    expect(runBatch).toHaveBeenCalledOnce();
  });
});
