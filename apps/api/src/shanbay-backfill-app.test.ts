import { expect, it, vi } from "vitest";
import { Hono } from "hono";
import { z } from "zod/v3";
import { createShanbayBackfillApp } from "./shanbay-backfill-app.js";
import { CloudFault } from "./cloud-fault.js";
import { errorStatus } from "./cloud-foundation-app.js";

function server(
  kind: "extension" | "web" | "miniprogram",
  deviceOwner = "owner",
  authenticated = true,
) {
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
      authenticate: async () => {
        if (!authenticated) throw new CloudFault("authentication_required", "Session required.");
        return { kind, userId: "owner" };
      },
      authenticateDevice,
      module: {
        status: async () => status,
        execute,
        unresolved: async () => ({ items: [], unknownBatches: [], nextCursor: null, revision: 0 }),
      },
    }),
  );
  const post = (command: unknown, headers: Record<string, string> = {}) =>
    app.request("/v1/shanbay-backfill", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": "backfill-test-key",
        authorization: "HuayiExtension device-token",
        ...headers,
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
it("accepts an explicit limit of 100 and rejects invalid limits before claiming", async () => {
  const h = server("extension");
  expect((await h.post({ action: "claim", limit: 100 })).status).toBe(200);
  expect(h.execute).toHaveBeenCalledWith("owner", "server-device-hash", "backfill-test-key", {
    action: "claim",
    limit: 100,
  });
  for (const limit of [0, 101, 1.5, "100"])
    expect((await h.post({ action: "claim", limit })).status).toBe(400);
  expect(h.execute).toHaveBeenCalledTimes(1);
});
it.each(["web", "miniprogram"] as const)(
  "does not let %s clients claim extension batches",
  async (kind) => {
    const h = server(kind);
    expect((await h.post({ action: "claim" })).status).toBe(403);
    expect(h.execute).not.toHaveBeenCalled();
  },
);

it.each(["web", "extension"] as const)(
  "authenticates %s bulk discard as one existing mutation",
  async (kind) => {
    const h = server(kind);
    const command = { action: "discard-unresolved", expectedRevision: 3 };
    expect((await h.post(command)).status).toBe(200);
    expect(h.execute).toHaveBeenCalledExactlyOnceWith(
      "owner",
      kind === "web" ? "web:owner" : "server-device-hash",
      "backfill-test-key",
      command,
    );
    expect((await h.post({ ...command, owner: "different-owner" })).status).toBe(400);
    expect(h.execute).toHaveBeenCalledTimes(1);
  },
);

it("rejects unauthenticated, cross-account, miniprogram and non-idempotent bulk discards before writing", async () => {
  const command = { action: "discard-unresolved", expectedRevision: 0 };
  for (const [h, expectedStatus] of [
    [server("web", "owner", false), 401],
    [server("extension", "different-owner"), 403],
    [server("miniprogram"), 403],
  ] as const) {
    expect((await h.post(command)).status).toBe(expectedStatus);
    expect(h.execute).not.toHaveBeenCalled();
  }
  const h = server("extension");
  expect((await h.post(command, { "idempotency-key": "" })).status).toBe(400);
  expect((await h.post(command, { authorization: "" })).status).toBe(401);
  expect(h.execute).not.toHaveBeenCalled();
});
