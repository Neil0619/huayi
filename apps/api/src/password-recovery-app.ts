import {
  passwordRecoveryAcceptedResponseSchema,
  passwordRecoveryCallbackFormSchema,
  passwordRecoveryCompleteRequestSchema,
  passwordRecoveryConfirmQuerySchema,
  passwordRecoveryHttpRoutes,
  passwordRecoveryRunResponseSchema,
  passwordRecoverySessionResponseSchema,
  passwordRecoveryStartRequestSchema,
} from "@huayi/cloud-contracts";
import { Hono, type Context } from "hono";

import { CloudFault } from "./cloud-fault.js";
import { requireCronBearer } from "./cron-authentication.js";
import type { PasswordRecoveryModule } from "./password-recovery-module.js";
import { enforceRateLimit, type RateLimiter } from "./rate-limiter.js";
import { strictJson } from "./strict-json.js";

const recoveryCookieName = "huayi_password_recovery";
const recoveryCookiePath = "/v1/auth/password/recovery";
const recoveryCookieAttributes = `HttpOnly; Secure; SameSite=Lax; Path=${recoveryCookiePath}`;

function confirmationCsp(webOrigin: string): string {
  return `default-src 'none'; form-action 'self' ${new URL(webOrigin).origin}; base-uri 'none'; frame-ancestors 'none'`;
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function invalidRequest(message: string): CloudFault {
  return new CloudFault("invalid_request", message);
}

function parseExactParams<T>(
  params: URLSearchParams,
  schema: { parse(value: unknown): T },
  message: string,
): T {
  const input: Record<string, string> = {};
  for (const [key, value] of params) {
    if (Object.hasOwn(input, key)) throw invalidRequest(message);
    input[key] = value;
  }
  try {
    return schema.parse(input);
  } catch {
    throw invalidRequest(message);
  }
}

function exactQuery<T>(context: Context, schema: { parse(value: unknown): T }): T {
  return parseExactParams(
    new URL(context.req.url).searchParams,
    schema,
    "The password recovery confirmation is invalid.",
  );
}

async function exactForm<T>(context: Context, schema: { parse(value: unknown): T }): Promise<T> {
  const contentType = context.req.header("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/x-www-form-urlencoded") {
    throw invalidRequest("Expected a password recovery form.");
  }
  return parseExactParams(
    new URLSearchParams(await context.req.text()),
    schema,
    "The password recovery form is invalid.",
  );
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function confirmationPage(flow: string, code: string): string {
  return `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>继续重置密码</title>
  </head>
  <body>
    <main>
      <h1>继续重置密码</h1>
      <p>只有在你主动发起密码恢复时，才继续下一步。</p>
      <form method="post" action="${passwordRecoveryHttpRoutes.callback}">
        <input type="hidden" name="flow" value="${escapeHtml(flow)}">
        <input type="hidden" name="code" value="${escapeHtml(code)}">
        <button type="submit">继续重置密码</button>
      </form>
    </main>
  </body>
</html>`;
}

function recoverySessionCookie(context: Context): string | undefined {
  const matches = (context.req.header("cookie") ?? "")
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.startsWith(`${recoveryCookieName}=`))
    .map((part) => part.slice(recoveryCookieName.length + 1));
  if (matches.length !== 1 || !/^[A-Za-z0-9_-]{32,2048}$/u.test(matches[0] ?? "")) {
    return undefined;
  }
  return matches[0];
}

function requireRecoverySession(context: Context): string {
  const sessionId = recoverySessionCookie(context);
  if (sessionId === undefined) {
    throw new CloudFault("authentication_required", "Password recovery proof is required.");
  }
  return sessionId;
}

function requireWebOrigin(context: Context, webOrigin: string): string {
  const origin = context.req.header("origin");
  if (origin !== webOrigin) {
    throw new CloudFault("forbidden", "Origin or CSRF validation failed.");
  }
  return origin;
}

export function createPasswordRecoveryApp(options: {
  cronSecret: string;
  minimumStartResponseMs?: number;
  module: PasswordRecoveryModule;
  nowMilliseconds?: () => number;
  rateLimiter: RateLimiter;
  wait?: (milliseconds: number) => Promise<void>;
  webOrigin: string;
}) {
  const app = new Hono();
  const nowMilliseconds = options.nowMilliseconds ?? (() => performance.now());

  app.post(passwordRecoveryHttpRoutes.start, async (context) => {
    const startedAt = nowMilliseconds();
    context.header("Cache-Control", "private, no-store");
    const input = await strictJson(context, passwordRecoveryStartRequestSchema);
    const ipBucket = context.req.header("x-vercel-forwarded-for") ?? "unavailable";
    await enforceRateLimit(options.rateLimiter, {
      action: "password-recovery.start.ip",
      limit: 10,
      subject: ipBucket,
      windowMs: 3_600_000,
    });
    await enforceRateLimit(options.rateLimiter, {
      action: "password-recovery.start.email",
      limit: 3,
      subject: input.email,
      windowMs: 3_600_000,
    });
    await options.module.request({ email: input.email, ipBucket });
    const minimumResponseMs = options.minimumStartResponseMs ?? 250;
    const elapsedMs = nowMilliseconds() - startedAt;
    const waitMs = minimumResponseMs - elapsedMs;
    if (waitMs > 0) await (options.wait ?? wait)(waitMs);
    return context.json(passwordRecoveryAcceptedResponseSchema.parse({ accepted: true }), 202);
  });

  app.get(passwordRecoveryHttpRoutes.confirm, (context) => {
    context.header("Cache-Control", "private, no-store");
    context.header("Content-Security-Policy", confirmationCsp(options.webOrigin));
    context.header("Referrer-Policy", "no-referrer");
    const input = exactQuery(context, passwordRecoveryConfirmQuerySchema);
    return context.html(confirmationPage(input.flow, input.code));
  });

  app.post(passwordRecoveryHttpRoutes.callback, async (context) => {
    context.header("Cache-Control", "private, no-store");
    context.header("Content-Security-Policy", confirmationCsp(options.webOrigin));
    context.header("Referrer-Policy", "no-referrer");
    const input = await exactForm(context, passwordRecoveryCallbackFormSchema);
    try {
      const session = await options.module.callback({ code: input.code, flowId: input.flow });
      context.header(
        "Set-Cookie",
        `${recoveryCookieName}=${session.recoverySessionId}; ${recoveryCookieAttributes}; Max-Age=900`,
      );
    } catch (error) {
      if (!(error instanceof CloudFault) || error.code !== "authentication_required") throw error;
    }
    return context.redirect(`${options.webOrigin}/recover?continue=1`, 302);
  });

  app.get(passwordRecoveryHttpRoutes.session, async (context) => {
    context.header("Cache-Control", "private, no-store");
    const recoverySessionId = requireRecoverySession(context);
    const origin = requireWebOrigin(context, options.webOrigin);
    const session = await options.module.readSession({ origin, recoverySessionId });
    return context.json(
      passwordRecoverySessionResponseSchema.parse({
        csrfToken: session.csrfToken,
        expiresAt: session.expiresAt.toISOString(),
      }),
    );
  });

  app.post(passwordRecoveryHttpRoutes.complete, async (context) => {
    context.header("Cache-Control", "private, no-store");
    const recoverySessionId = requireRecoverySession(context);
    const origin = requireWebOrigin(context, options.webOrigin);
    const csrfToken = context.req.header("x-csrf-token");
    if (csrfToken === undefined) {
      throw new CloudFault("forbidden", "Origin or CSRF validation failed.");
    }
    const input = await strictJson(context, passwordRecoveryCompleteRequestSchema);
    await options.module.complete({
      csrfToken,
      origin,
      password: input.password,
      recoverySessionId,
    });
    context.header("Set-Cookie", `${recoveryCookieName}=; ${recoveryCookieAttributes}; Max-Age=0`);
    return context.body(null, 204);
  });

  app.get(passwordRecoveryHttpRoutes.run, async (context) => {
    requireCronBearer(context, options.cronSecret, "Worker authentication is required.");
    return context.json(
      passwordRecoveryRunResponseSchema.parse({ outcome: await options.module.dispatchNext() }),
    );
  });

  return app;
}
