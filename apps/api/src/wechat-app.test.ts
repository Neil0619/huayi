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
    loginAndLink: vi.fn(async () => session),
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
  const signIn = vi.fn(async () => ({
    userId: "web-owner",
    email: "friend@example.com",
    refreshToken: "offline-refresh",
  }));
  const app = new Hono();
  app.onError((_error, context) => context.json({ error: "denied" }, 403));
  app.route(
    "/",
    createWechatApp({
      identity,
      auth: { signInWithPassword: signIn },
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
  return { app, identity, exchange, webAuthenticate, post, signIn };
}
describe("WeChat HTTP boundary", () => {
  const credentials = {
    ticket: "t".repeat(43),
    email: "friend@example.com",
    password: "correct horse battery staple",
    confirmed: true,
  };
  it("links only the provider-authenticated owner and never exposes a Web refresh token", async () => {
    const f = fixture();
    const response = await f.post("binding/login", credentials);
    expect(response.status).toBe(200);
    expect(f.signIn).toHaveBeenCalledWith({
      email: credentials.email,
      password: credentials.password,
    });
    expect(f.identity.loginAndLink).toHaveBeenCalledWith(credentials.ticket, "web-owner");
    expect(await response.text()).not.toMatch(/offline-refresh|password|csrf/);
    expect(f.webAuthenticate).not.toHaveBeenCalled();
    expect((await f.post("binding/login", { ...credentials, userId: "victim" })).status).toBe(403);
    expect((await f.post("binding/login", { ...credentials, confirmed: false })).status).toBe(403);
    expect(f.signIn).toHaveBeenCalledOnce();
  });
  it("rejects expired tickets before contacting the password provider and hides provider errors", async () => {
    const f = fixture();
    vi.mocked(f.identity.bindingStatus).mockResolvedValueOnce({ status: "expired" });
    expect((await f.post("binding/login", credentials)).status).toBe(403);
    expect(f.signIn).not.toHaveBeenCalled();
    f.signIn.mockRejectedValueOnce(new Error("private provider response"));
    const failed = await f.post("binding/login", credentials);
    expect(failed.status).toBe(403);
    expect(await failed.text()).not.toContain("private provider response");
    expect(f.identity.loginAndLink).not.toHaveBeenCalled();
  });
  it.each(["ip", "email", "ticket"])(
    "limits password attempts independently by %s",
    async (bucket) => {
      const f = fixture();
      for (let attempt = 0; attempt < 6; attempt++) {
        const response = await f.post(
          "binding/login",
          {
            ...credentials,
            email:
              bucket === "email"
                ? attempt % 2
                  ? " FRIEND@EXAMPLE.COM "
                  : credentials.email
                : `friend${attempt}@example.com`,
            ticket: bucket === "ticket" ? credentials.ticket : String(attempt).repeat(43),
          },
          { "x-vercel-forwarded-for": bucket === "ip" ? "192.0.2.1" : `192.0.2.${attempt + 1}` },
        );
        expect(response.status).toBe(attempt === 5 ? 403 : 200);
      }
      expect(f.signIn).toHaveBeenCalledTimes(5);
    },
  );
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
