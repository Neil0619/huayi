import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

import { securityNotificationHttpRoutes } from "@huayi/cloud-contracts";
import { createSecurityNotificationApp } from "./security-notification-app.js";
import { CloudFault } from "./cloud-fault.js";
import { errorStatus } from "./cloud-foundation-app.js";

describe("security notification internal route", () => {
  it("accepts only the fixed bearer and returns one bounded outcome", async () => {
    const runOne = vi.fn(async () => "terminalized" as const);
    const app = new Hono();
    app.onError((error, context) => {
      const fault =
        error instanceof CloudFault ? error : new CloudFault("invalid_request", "Request failed.");
      return context.json({ code: fault.code }, errorStatus(fault.code));
    });
    app.route(
      "/",
      createSecurityNotificationApp({ cronSecret: "s".repeat(32), worker: { runOne } }),
    );

    const missingBearer = await app.request(securityNotificationHttpRoutes.run);
    expect(missingBearer.status).toBe(401);
    expect(missingBearer.headers.get("cache-control")).toBe("private, no-store");
    const wrongBearer = await app.request(securityNotificationHttpRoutes.run, {
      headers: { authorization: `Bearer ${"x".repeat(32)}` },
    });
    expect(wrongBearer.status).toBe(401);
    expect(wrongBearer.headers.get("cache-control")).toBe("private, no-store");
    const response = await app.request(securityNotificationHttpRoutes.run, {
      headers: { authorization: `Bearer ${"s".repeat(32)}` },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    await expect(response.json()).resolves.toEqual({ outcome: "terminalized" });
    expect(runOne).toHaveBeenCalledTimes(1);
  });
});
