import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { createWechatApp } from "./wechat-app.js";
import { createInMemoryRateLimiter } from "./rate-limiter.js";
import type { MiniProgramIdentity } from "./miniprogram-identity.js";

function fixture() {
  const session = {
    state: "authenticated" as const,
    token: "s".repeat(43),
    expiresAt: "2026-09-10T00:00:00Z",
  };
  const identity: MiniProgramIdentity = {
    begin: vi.fn(async () => ({
      state: "onboarding" as const,
      ticket: "t".repeat(43),
      bindingCode: "ABCD012345",
      expiresAt: session.expiresAt,
    })),
    onboard: vi.fn(async () => session),
    bindingStatus: vi.fn(async () => ({ status: "pending" as const })),
    approveBinding: vi.fn(async () => undefined),
    authenticate: vi.fn(async () => ({
      userId: "owner",
      reauthenticatedAt: new Date(),
      sessionHash: "hash",
    })),
    reauthenticate: vi.fn(async () => undefined),
    revoke: vi.fn(async () => undefined),
    account: vi.fn(async () => ({
      id: "00000000-0000-4000-8000-000000000001",
      email: null,
      linkedToWeb: false,
    })),
  };
  const exchange = vi.fn(async () => ({ appId: "wx-test", openId: "trusted-subject" }));
  const webAuthenticate = vi.fn(async () => "web-owner");
  const app = new Hono();
  app.onError((_error, context) => context.json({ error: "denied" }, 403));
  app.route(
    "/",
    createWechatApp({
      identity,
      provider: { exchange },
      authenticateWeb: webAuthenticate,
      pepper: "pepper",
      rateLimiter: createInMemoryRateLimiter({ now: () => new Date() }),
    }),
  );
  const post = (path: string, data: unknown, headers: Record<string, string> = {}) =>
    app.request(`/v1/auth/wechat/${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(data),
    });
  return { app, identity, exchange, webAuthenticate, post };
}
describe("WeChat HTTP boundary", () => {
  it("exchanges server-side proof and creates no account until explicit onboarding", async () => {
    const f = fixture();
    const response = await f.post("login", { code: "one-use" });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.json()).toMatchObject({ state: "onboarding" });
    expect(f.identity.begin).toHaveBeenCalledWith({ appId: "wx-test", openId: "trusted-subject" });
    expect(f.identity.onboard).not.toHaveBeenCalled();
    expect((await f.post("login", { code: "one-use", userId: "victim" })).status).toBe(403);
    expect(f.exchange).toHaveBeenCalledTimes(1);
  });
  it("requires an explicit confirmation and true Web authentication for linking", async () => {
    const f = fixture();
    expect(
      (
        await f.post(
          "binding/approve",
          { bindingCode: "ABCD012345", confirmed: true },
          { cookie: "huayi_session=web-proof" },
        )
      ).status,
    ).toBe(204);
    expect(f.webAuthenticate).toHaveBeenCalledOnce();
    expect(f.identity.approveBinding).toHaveBeenCalledWith(
      "ABCD012345",
      expect.any(String),
      "web-owner",
    );
    expect(
      (
        await f.post(
          "binding/approve",
          { bindingCode: "ABCD012345", confirmed: false },
          { cookie: "huayi_session=web-proof" },
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await f.post(
          "binding/approve",
          { bindingCode: "ABCD012345", confirmed: true },
          { authorization: `HuayiMiniProgram ${"m".repeat(43)}` },
        )
      ).status,
    ).toBe(403);
    expect(f.identity.approveBinding).toHaveBeenCalledTimes(1);
  });
  it("requires a business session before spending a fresh WeChat code", async () => {
    const f = fixture();
    expect((await f.post("reauthenticate", { code: "fresh" })).status).toBe(403);
    expect(f.exchange).not.toHaveBeenCalled();
    const authorization = `HuayiMiniProgram ${"s".repeat(43)}`;
    expect((await f.post("reauthenticate", { code: "fresh" }, { authorization })).status).toBe(204);
    expect(f.identity.reauthenticate).toHaveBeenCalledWith("s".repeat(43), {
      appId: "wx-test",
      openId: "trusted-subject",
    });
    expect((await f.post("logout", {}, { authorization })).status).toBe(204);
    expect(f.identity.revoke).toHaveBeenCalledWith("s".repeat(43));
  });
});
