import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

import type { PasswordRecoveryModule } from "./password-recovery-module.js";
import { CloudFault } from "./cloud-fault.js";
import { errorStatus } from "./cloud-foundation-app.js";
import { createPasswordRecoveryApp } from "./password-recovery-app.js";

const flow = "f".repeat(32);
const code = "c".repeat(32);
const recoverySessionId = "r".repeat(43);
const csrfToken = "s".repeat(43);
const webOrigin = "https://app.huayi.example";

function setup() {
  const module = {
    callback: vi.fn(async () => ({
      csrfToken,
      expiresAt: new Date("2026-08-14T10:15:00.000Z"),
      recoverySessionId,
    })),
    complete: vi.fn(async () => undefined),
    dispatchNext: vi.fn(async () => "sent" as const),
    readSession: vi.fn(async () => ({
      csrfToken,
      expiresAt: new Date("2026-08-14T10:15:00.000Z"),
    })),
    request: vi.fn(async () => undefined),
  } satisfies PasswordRecoveryModule;
  const consume = vi.fn(async () => true);
  const app = new Hono();
  app.onError((error, context) => {
    const fault =
      error instanceof CloudFault
        ? error
        : new CloudFault("invalid_request", "The request could not be completed.");
    return context.json({ code: fault.code }, errorStatus(fault.code));
  });
  app.route(
    "/",
    createPasswordRecoveryApp({
      cronSecret: "q".repeat(32),
      minimumStartResponseMs: 0,
      module,
      rateLimiter: { consume },
      webOrigin,
    }),
  );
  return { app, consume, module };
}

describe("password recovery HTTP", () => {
  it("normalizes a strict start request behind separate hourly IP and email buckets", async () => {
    const { app, consume, module } = setup();
    const response = await app.request("/v1/auth/password/recovery", {
      body: JSON.stringify({ email: " Learner@Example.COM " }),
      headers: {
        "content-type": "application/json",
        "x-vercel-forwarded-for": "203.0.113.7",
      },
      method: "POST",
    });

    expect(response.status).toBe(202);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("set-cookie")).toBeNull();
    await expect(response.json()).resolves.toEqual({ accepted: true });
    expect(consume).toHaveBeenNthCalledWith(1, {
      action: "password-recovery.start.ip",
      limit: 10,
      subject: "203.0.113.7",
      windowMs: 3_600_000,
    });
    expect(consume).toHaveBeenNthCalledWith(2, {
      action: "password-recovery.start.email",
      limit: 3,
      subject: "learner@example.com",
      windowMs: 3_600_000,
    });
    expect(module.request).toHaveBeenCalledWith({
      email: "learner@example.com",
      ipBucket: "203.0.113.7",
    });

    const invalid = await app.request("/v1/auth/password/recovery", {
      body: JSON.stringify({ email: "learner@example.com", returnTo: "https://evil.example" }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(invalid.status).toBe(400);
    expect(module.request).toHaveBeenCalledOnce();
  });

  it("returns a stable 429 before creating a recovery request", async () => {
    const { app, consume, module } = setup();
    consume.mockResolvedValueOnce(false);

    const response = await app.request("/v1/auth/password/recovery", {
      body: JSON.stringify({ email: "learner@example.com" }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });

    expect(response.status).toBe(429);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(module.request).not.toHaveBeenCalled();
  });

  it("holds every accepted start response to the fixed minimum budget", async () => {
    const { consume, module } = setup();
    const wait = vi.fn(async () => undefined);
    const nowMilliseconds = vi
      .fn<() => number>()
      .mockReturnValueOnce(1_000)
      .mockReturnValueOnce(1_075);
    const app = new Hono();
    app.route(
      "/",
      createPasswordRecoveryApp({
        cronSecret: "q".repeat(32),
        minimumStartResponseMs: 250,
        module,
        nowMilliseconds,
        rateLimiter: { consume },
        wait,
        webOrigin,
      }),
    );

    const response = await app.request("/v1/auth/password/recovery", {
      body: JSON.stringify({ email: "learner@example.com" }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });

    expect(response.status).toBe(202);
    expect(wait).toHaveBeenCalledWith(175);
  });

  it("renders only an inert escaped confirmation form without consuming state", async () => {
    const { app, module } = setup();
    const unsafeCode = `${"c".repeat(31)}<`;
    const response = await app.request(
      `/v1/auth/password/recovery/confirm?flow=${flow}&code=${encodeURIComponent(unsafeCode)}`,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("content-security-policy")).toBe(
      `default-src 'none'; form-action 'self' ${webOrigin}; base-uri 'none'; frame-ancestors 'none'`,
    );
    expect(response.headers.get("set-cookie")).toBeNull();
    const html = await response.text();
    expect(html).toContain('action="/v1/auth/password/recovery/callback"');
    expect(html).toContain(`name="flow" value="${flow}"`);
    expect(html).toContain(`name="code" value="${"c".repeat(31)}&lt;"`);
    expect(html).not.toContain(unsafeCode);
    expect(module.callback).not.toHaveBeenCalled();

    const extra = await app.request(
      `/v1/auth/password/recovery/confirm?flow=${flow}&code=${code}&returnTo=x`,
    );
    expect(extra.status).toBe(400);
  });

  it("accepts only an exact form callback and redirects expected proof failures", async () => {
    const { app, module } = setup();
    const response = await app.request("/v1/auth/password/recovery/callback", {
      body: new URLSearchParams({ code, flow }),
      headers: { "content-type": "application/x-www-form-urlencoded" },
      method: "POST",
    });

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(`${webOrigin}/recover?continue=1`);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("content-security-policy")).toBe(
      `default-src 'none'; form-action 'self' ${webOrigin}; base-uri 'none'; frame-ancestors 'none'`,
    );
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("set-cookie")).toBe(
      `huayi_password_recovery=${recoverySessionId}; HttpOnly; Secure; SameSite=Lax; ` +
        "Path=/v1/auth/password/recovery; Max-Age=900",
    );
    expect(module.callback).toHaveBeenCalledWith({ code, flowId: flow });

    for (const request of [
      new Request("https://api.test/v1/auth/password/recovery/callback", {
        body: JSON.stringify({ code, flow }),
        headers: { "content-type": "application/json" },
        method: "POST",
      }),
      new Request("https://api.test/v1/auth/password/recovery/callback", {
        body: `flow=${flow}&code=${code}&code=${code}`,
        headers: { "content-type": "application/x-www-form-urlencoded" },
        method: "POST",
      }),
      new Request("https://api.test/v1/auth/password/recovery/callback", {
        body: `flow=${flow}&code=${code}&returnTo=x`,
        headers: { "content-type": "application/x-www-form-urlencoded" },
        method: "POST",
      }),
    ]) {
      expect((await app.request(request)).status).toBe(400);
    }

    module.callback.mockRejectedValueOnce(
      new CloudFault("authentication_required", "Password recovery is unavailable."),
    );
    const failed = await app.request("/v1/auth/password/recovery/callback", {
      body: new URLSearchParams({ code, flow }),
      headers: { "content-type": "application/x-www-form-urlencoded" },
      method: "POST",
    });
    expect(failed.status).toBe(302);
    expect(failed.headers.get("location")).toBe(`${webOrigin}/recover?continue=1`);
    expect(failed.headers.get("set-cookie")).toBeNull();
  });

  it("reads only a purpose cookie from the exact Web origin", async () => {
    const { app, module } = setup();
    const response = await app.request("/v1/auth/password/recovery/session", {
      headers: {
        cookie: `other=x; huayi_password_recovery=${recoverySessionId}`,
        origin: webOrigin,
      },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    await expect(response.json()).resolves.toEqual({
      csrfToken,
      expiresAt: "2026-08-14T10:15:00.000Z",
    });
    expect(module.readSession).toHaveBeenCalledWith({ origin: webOrigin, recoverySessionId });

    for (const headers of [
      { origin: webOrigin },
      { cookie: `huayi_password_recovery=${recoverySessionId}`, origin: "https://evil.example" },
      {
        cookie: `huayi_password_recovery=${recoverySessionId}; huayi_password_recovery=${"x".repeat(43)}`,
        origin: webOrigin,
      },
    ]) {
      expect((await app.request("/v1/auth/password/recovery/session", { headers })).status).toBe(
        headers.origin === webOrigin ? 401 : 403,
      );
    }
  });

  it("completes once with Origin, CSRF, and purpose Cookie then clears only that Cookie", async () => {
    const { app, module } = setup();
    const response = await app.request("/v1/auth/password/recovery/complete", {
      body: JSON.stringify({ password: "correct horse battery staple" }),
      headers: {
        "content-type": "application/json",
        cookie: `huayi_password_recovery=${recoverySessionId}`,
        origin: webOrigin,
        "x-csrf-token": csrfToken,
      },
      method: "POST",
    });

    expect(response.status).toBe(204);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("set-cookie")).toBe(
      "huayi_password_recovery=; HttpOnly; Secure; SameSite=Lax; " +
        "Path=/v1/auth/password/recovery; Max-Age=0",
    );
    expect(module.complete).toHaveBeenCalledWith({
      csrfToken,
      origin: webOrigin,
      password: "correct horse battery staple",
      recoverySessionId,
    });

    const missingCsrf = await app.request("/v1/auth/password/recovery/complete", {
      body: JSON.stringify({ password: "correct horse battery staple" }),
      headers: {
        "content-type": "application/json",
        cookie: `huayi_password_recovery=${recoverySessionId}`,
        origin: webOrigin,
      },
      method: "POST",
    });
    expect(missingCsrf.status).toBe(403);
  });

  it("runs one bounded dispatch only for the fixed CRON bearer", async () => {
    const { app, module } = setup();
    const missingBearer = await app.request("/internal/password-recovery/run");
    expect(missingBearer.status).toBe(401);
    expect(missingBearer.headers.get("cache-control")).toBe("private, no-store");
    const wrongBearer = await app.request("/internal/password-recovery/run", {
      headers: { authorization: `Bearer ${"x".repeat(32)}` },
    });
    expect(wrongBearer.status).toBe(401);
    expect(wrongBearer.headers.get("cache-control")).toBe("private, no-store");

    const response = await app.request("/internal/password-recovery/run", {
      headers: { authorization: `Bearer ${"q".repeat(32)}` },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    await expect(response.json()).resolves.toEqual({ outcome: "sent" });
    expect(module.dispatchNext).toHaveBeenCalledOnce();
  });
});
