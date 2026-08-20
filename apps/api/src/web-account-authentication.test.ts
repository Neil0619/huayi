import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

import { authenticateWebAccountRequest } from "./web-account-authentication.js";
import { CloudFault } from "./cloud-fault.js";

describe("Web account authentication", () => {
  it("uses Cookie reads and requires Origin plus CSRF for mutations", async () => {
    const identity = {
      authenticateWebMutation: vi.fn(async () => ({ userId: "owner-1" })),
      authenticateWebSession: vi.fn(async () => ({ userId: "owner-1" })),
    };
    const app = new Hono();
    app.onError((error, context) =>
      error instanceof CloudFault
        ? context.json({ code: error.code }, error.code === "forbidden" ? 403 : 401)
        : context.json({ code: "unknown" }, 500),
    );
    app.all("/", async (context) =>
      context.json({ owner: await authenticateWebAccountRequest(identity, context) }),
    );

    const read = await app.request("/", { headers: { cookie: "huayi_session=session-1" } });
    expect(read.status).toBe(200);
    expect(identity.authenticateWebSession).toHaveBeenCalledWith("session-1");

    await expect(
      app.request("/", {
        body: "{}",
        headers: { cookie: "huayi_session=session-1" },
        method: "PATCH",
      }),
    ).resolves.toHaveProperty("status", 403);
    const mutation = await app.request("/", {
      body: "{}",
      headers: {
        cookie: "huayi_session=session-1",
        origin: "https://app.huayi.example",
        "x-csrf-token": "csrf-1",
      },
      method: "PATCH",
    });
    expect(mutation.status).toBe(200);
    expect(identity.authenticateWebMutation).toHaveBeenCalledWith(
      "session-1",
      "https://app.huayi.example",
      "csrf-1",
    );
  });
});
