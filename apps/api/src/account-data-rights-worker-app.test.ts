import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

import { createAccountDataRightsWorkerApp } from "./account-data-rights-worker-app.js";
import { CloudFault } from "./cloud-fault.js";
import { errorStatus } from "./cloud-foundation-app.js";

describe("account data rights worker HTTP", () => {
  it("accepts only the fixed cron bearer and returns a bounded outcome", async () => {
    const runOne = vi.fn(async () => ({
      deletion: "idle" as const,
      export: "processed" as const,
    }));
    const outer = new Hono();
    outer.onError((error, context) => {
      const fault =
        error instanceof CloudFault ? error : new CloudFault("invalid_request", "Request failed.");
      return context.json({ code: fault.code }, errorStatus(fault.code));
    });
    outer.route(
      "/",
      createAccountDataRightsWorkerApp({ cronSecret: "s".repeat(32), worker: { runOne } }),
    );
    expect((await outer.request("/internal/data-rights/run")).status).toBe(401);
    expect(
      (
        await outer.request("/internal/data-rights/run", {
          headers: { authorization: `Bearer ${"x".repeat(32)}` },
        })
      ).status,
    ).toBe(401);
    const response = await outer.request("/internal/data-rights/run", {
      headers: { authorization: `Bearer ${"s".repeat(32)}` },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ deletion: "idle", export: "processed" });
    expect(runOne).toHaveBeenCalledOnce();
  });
});
