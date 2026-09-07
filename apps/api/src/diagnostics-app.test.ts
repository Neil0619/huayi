import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { createDiagnosticsApp } from "./diagnostics-app.js";
import { CloudFault } from "./cloud-fault.js";
import { errorStatus } from "./cloud-foundation-app.js";
import { createInMemoryRateLimiter } from "./rate-limiter.js";

const owner = "71000000-0000-4000-8000-000000000001";
const event = {
  version: 1,
  id: owner,
  occurredAt: new Date().toISOString(),
  source: "store",
  severity: "error",
  operation: "instant-query",
  code: "provider-error",
  stage: "http",
  httpStatus: 429,
};
function setup(denied = false) {
  const write = vi.fn(async () => undefined);
  const list = vi.fn(async () => ({
    items: [],
    nextCursor: null,
    summary: { events: 0, errors: 0, affectedUsers: 0, affectedRequests: 0, groups: [] },
  }));
  const app = new Hono();
  app.onError((error, c) =>
    c.json(
      { error: "rejected" },
      error instanceof CloudFault ? errorStatus(error.code) : errorStatus("invalid_request"),
    ),
  );
  app.route(
    "/",
    createDiagnosticsApp({
      write,
      list,
      rateLimiter: createInMemoryRateLimiter({ now: () => new Date() }),
      authenticateClient: async () => ({ kind: "extension", userId: owner }),
      authenticateAdmin: async () => {
        if (denied) throw new CloudFault("forbidden", "Denied.");
        return { actorUserId: owner, reauthenticatedAt: new Date() };
      },
    }),
  );
  return { app, write, list };
}
describe("diagnostic HTTP boundary", () => {
  it("returns a retryable response when persistence fails", async () => {
    const { app, write } = setup();
    write.mockRejectedValueOnce(new Error("database offline"));
    const response = await app.request("/v1/diagnostics", {
      method: "POST",
      body: JSON.stringify({ consentVersion: 1, events: [event] }),
    });
    expect(response.status).toBe(503);
  });
  it("binds the authenticated owner and refuses extra data or a forged server source", async () => {
    const { app, write } = setup();
    const send = (body: unknown) =>
      app.request("/v1/diagnostics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    expect((await send({ consentVersion: 1, events: [event] })).status).toBe(204);
    expect(write).toHaveBeenCalledWith([{ userId: owner, event }]);
    for (const extra of [
      { message: "secret" },
      { source: "api" },
      { userId: owner },
      { release: "abcdef123" },
    ])
      expect((await send({ consentVersion: 1, events: [{ ...event, ...extra }] })).status).toBe(
        400,
      );
    expect(write).toHaveBeenCalledTimes(1);
  });
  it("limits upload rate and requires admin proof before querying", async () => {
    const f = setup();
    for (let i = 0; i < 20; i++)
      await f.app.request("/v1/diagnostics", {
        method: "POST",
        body: JSON.stringify({ consentVersion: 1, events: [event] }),
      });
    expect(
      (
        await f.app.request("/v1/diagnostics", {
          method: "POST",
          body: JSON.stringify({ consentVersion: 1, events: [event] }),
        })
      ).status,
    ).toBe(429);
    const denied = setup(true);
    expect((await denied.app.request("/v1/admin/error-logs")).status).toBe(403);
    expect(denied.list).not.toHaveBeenCalled();
    expect((await f.app.request("/v1/admin/error-logs?reference=secret")).status).toBe(400);
  });
});
