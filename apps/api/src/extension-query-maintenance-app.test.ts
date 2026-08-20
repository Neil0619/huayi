import { extensionQueryHttpRoutes } from "@huayi/cloud-contracts";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

import { CloudFault } from "./cloud-fault.js";
import { errorStatus } from "./cloud-foundation-app.js";
import { createExtensionQueryMaintenanceApp } from "./extension-query-maintenance-app.js";

describe("ExtensionQuery maintenance HTTP adapter", () => {
  it("accepts only the fixed cron bearer and returns bounded public counts", async () => {
    const runBatch = vi.fn(async () => ({ abandonedCount: 2, deletedCount: 3 }));
    const outer = new Hono();
    outer.onError((error, context) => {
      const fault =
        error instanceof CloudFault ? error : new CloudFault("invalid_request", "Request failed.");
      return context.json({ code: fault.code }, errorStatus(fault.code));
    });
    outer.route(
      "/",
      createExtensionQueryMaintenanceApp({
        cronSecret: "s".repeat(32),
        maintenance: { runBatch },
      }),
    );

    expect((await outer.request(extensionQueryHttpRoutes.cleanup)).status).toBe(401);
    expect(
      (
        await outer.request(extensionQueryHttpRoutes.cleanup, {
          headers: { authorization: `Bearer ${"x".repeat(32)}` },
        })
      ).status,
    ).toBe(401);
    const response = await outer.request(extensionQueryHttpRoutes.cleanup, {
      headers: { authorization: `Bearer ${"s".repeat(32)}` },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ abandonedCount: 2, deletedCount: 3 });
    expect(runBatch).toHaveBeenCalledOnce();
  });
});
