import { expect, it, vi } from "vitest";
import { Hono } from "hono";
import { z } from "zod/v3";
import { createShanbayBackfillApp } from "./shanbay-backfill-app.js";
import { CloudFault } from "./cloud-fault.js";
import { errorStatus } from "./cloud-foundation-app.js";

function server(kind: "extension" | "web" | "miniprogram", deviceOwner = "owner") {
  const status = {
    scopeId: "00000000-0000-4000-8000-000000000001",
    enabled: true,
    dailyHour: 8,
    revision: 0,
    pendingCount: 0,
    unresolvedCount: 0,
    unknownCount: 0,
    lastCheckedAt: null,
  };
  const execute = vi.fn(async () => ({ status, accepted: true, batch: null, nextCursor: null }));
  const authenticateDevice = vi.fn(async () => ({
    userId: deviceOwner,
    holder: "server-device-hash",
  }));
  const app = new Hono();
  app.onError((error, context) => {
    if (error instanceof CloudFault)
      return context.json({ error: error.code }, errorStatus(error.code));
    if (error instanceof z.ZodError) return context.json({ error: "invalid_request" }, 400);
    throw error;
  });
  app.route(
    "/",
    createShanbayBackfillApp({
      authenticate: async () => ({ kind, userId: "owner" }),
      authenticateDevice,
      module: {
        status: async () => status,
        execute,
        unresolved: async () => ({ items: [], unknownBatches: [], nextCursor: null, revision: 0 }),
      },
    }),
  );
  const post = (command: unknown) =>
    app.request("/v1/shanbay-backfill", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": "backfill-test-key",
        authorization: "HuayiExtension device-token",
      },
      body: JSON.stringify(command),
    });
  return { execute, post, authenticateDevice };
}
it("binds claims to the server-authenticated device rather than a caller-supplied identity", async () => {
  const h = server("extension");
  expect((await h.post({ action: "claim" })).status).toBe(200);
  expect(h.authenticateDevice).toHaveBeenCalledWith("device-token");
  expect(h.execute).toHaveBeenCalledWith("owner", "server-device-hash", "backfill-test-key", {
    action: "claim",
  });
  expect((await h.post({ action: "claim", holder: "attacker" })).status).toBe(400);
  expect(h.execute).toHaveBeenCalledTimes(1);
});
it("rejects a device whose verified owner differs from the principal", async () => {
  const h = server("extension", "different-owner");
  expect((await h.post({ action: "claim" })).status).toBe(403);
  expect(h.execute).not.toHaveBeenCalled();
});
it.each(["web", "miniprogram"] as const)(
  "does not let %s clients claim extension batches",
  async (kind) => {
    const h = server(kind);
    expect((await h.post({ action: "claim" })).status).toBe(403);
    expect(h.execute).not.toHaveBeenCalled();
  },
);
