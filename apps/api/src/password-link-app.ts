import {
  accountSignInMethodsResponseSchema,
  identityHttpRoutes,
  passwordLinkRequestSchema,
} from "@huayi/cloud-contracts";
import { Hono } from "hono";

import { CloudFault } from "./cloud-fault.js";
import type { PasswordLinkModule } from "./password-link-module.js";
import { enforceRateLimit, type RateLimiter } from "./rate-limiter.js";
import { strictJson } from "./strict-json.js";
import { webSessionCookie } from "./web-session-cookie.js";

export function createPasswordLinkApp(options: {
  link: PasswordLinkModule;
  rateLimiter: RateLimiter;
}) {
  const app = new Hono();
  app.post(identityHttpRoutes.passwordLink, async (context) => {
    context.header("Cache-Control", "private, no-store");
    const sessionId = webSessionCookie(context);
    const csrfToken = context.req.header("x-csrf-token");
    const origin = context.req.header("origin");
    if (sessionId === undefined || csrfToken === undefined || origin === undefined) {
      throw new CloudFault("authentication_required", "Web session proof is required.");
    }
    const input = await strictJson(context, passwordLinkRequestSchema);
    await enforceRateLimit(options.rateLimiter, {
      action: "account.password-link",
      limit: 5,
      subject: `${context.req.header("x-vercel-forwarded-for") ?? "unavailable"}:${sessionId}`,
      windowMs: 60_000,
    });
    const result = await options.link.execute(sessionId, origin, csrfToken, input.password);
    const response = accountSignInMethodsResponseSchema.parse({
      methods: result.methods.map((method) => ({
        ...method,
        linkedAt: method.linkedAt.toISOString(),
      })),
    });
    context.header("Set-Cookie", result.session.setCookie);
    return context.json(response);
  });
  return app;
}
