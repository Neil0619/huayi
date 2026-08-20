import { googleLinkStartRequestSchema, identityHttpRoutes } from "@huayi/cloud-contracts";
import { Hono } from "hono";

import { CloudFault } from "./cloud-fault.js";
import type { GoogleLinkModule } from "./google-link-module.js";
import { enforceRateLimit, type RateLimiter } from "./rate-limiter.js";
import { strictJson } from "./strict-json.js";
import { cookieValue, webSessionCookie } from "./web-session-cookie.js";

const intentName = "huayi_google_link";
const continuePath = identityHttpRoutes.googleLinkContinue;
const intentAttributes = `HttpOnly; Secure; SameSite=Strict; Path=${continuePath}`;

export function createGoogleLinkApp(options: {
  link: GoogleLinkModule;
  rateLimiter: RateLimiter;
  webOrigin: string;
}) {
  const app = new Hono();

  app.post(identityHttpRoutes.googleLinkStart, async (context) => {
    context.header("Cache-Control", "private, no-store");
    const sessionId = webSessionCookie(context);
    const csrfToken = context.req.header("x-csrf-token");
    const origin = context.req.header("origin");
    if (sessionId === undefined || csrfToken === undefined || origin === undefined) {
      throw new CloudFault("authentication_required", "Web session proof is required.");
    }
    await strictJson(context, googleLinkStartRequestSchema);
    await enforceRateLimit(options.rateLimiter, {
      action: "account.google-link",
      limit: 5,
      subject: `${context.req.header("x-vercel-forwarded-for") ?? "unavailable"}:${sessionId}`,
      windowMs: 60_000,
    });
    const flow = await options.link.create(sessionId, origin, csrfToken);
    context.header("Set-Cookie", `${intentName}=${flow.flowId}; ${intentAttributes}; Max-Age=900`);
    return context.json({ continuePath });
  });

  app.get(continuePath, async (context) => {
    const sessionId = webSessionCookie(context);
    const flowId = cookieValue(context, intentName);
    if (sessionId === undefined || flowId === undefined) {
      throw new CloudFault("authentication_required", "Google link proof is required.");
    }
    const result = await options.link.continue(flowId, sessionId);
    context.header("Set-Cookie", `${intentName}=; ${intentAttributes}; Max-Age=0`);
    context.header("Cache-Control", "private, no-store");
    return context.redirect(result.redirectUrl, 302);
  });

  app.get("/v1/account/sign-in-methods/google:callback", async (context) => {
    const code = context.req.query("code");
    const flowId = context.req.query("flow");
    const sessionId = webSessionCookie(context);
    if (code === undefined || flowId === undefined || sessionId === undefined) {
      throw new CloudFault("authentication_required", "Google link proof is required.");
    }
    const session = await options.link.complete(flowId, sessionId, code);
    context.header("Set-Cookie", session.setCookie);
    context.header("Cache-Control", "private, no-store");
    return context.redirect(`${options.webOrigin}/settings/account`, 302);
  });

  return app;
}
