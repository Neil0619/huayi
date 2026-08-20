import { identityHttpRoutes, passwordReauthenticationRequestSchema } from "@huayi/cloud-contracts";
import { Hono } from "hono";

import type { CloudFoundationDependencies } from "./cloud-foundation-dependencies.js";
import { CloudFault } from "./cloud-fault.js";
import { enforceRateLimit } from "./rate-limiter.js";
import { strictJson } from "./strict-json.js";
import { webSessionCookie } from "./web-session-cookie.js";

export function createPasswordReauthenticationApp(dependencies: CloudFoundationDependencies) {
  const app = new Hono();

  app.post(identityHttpRoutes.passwordReauthentication, async (context) => {
    context.header("Cache-Control", "private, no-store");
    const sessionId = webSessionCookie(context);
    const csrfToken = context.req.header("x-csrf-token");
    const origin = context.req.header("origin");
    if (sessionId === undefined || csrfToken === undefined || origin === undefined) {
      throw new CloudFault("authentication_required", "Web session proof is required.");
    }
    const input = await strictJson(context, passwordReauthenticationRequestSchema);
    const owner = await dependencies.identity.preparePasswordReauthentication(
      sessionId,
      origin,
      csrfToken,
    );
    const clientIp = context.req.header("x-vercel-forwarded-for") ?? "unavailable";
    await enforceRateLimit(dependencies.rateLimiter, {
      action: "auth.password-reauthenticate",
      limit: 5,
      subject: `${clientIp}:${owner.userId}`,
      windowMs: 60_000,
    });
    const providerSession = await dependencies.auth.signInWithPassword({
      email: owner.email,
      password: input.password,
    });
    const session = await dependencies.identity.completePasswordReauthentication(
      sessionId,
      providerSession.userId,
      dependencies.protectRefreshToken(providerSession.refreshToken),
    );
    context.header("Set-Cookie", session.setCookie);
    return context.json({ access: session.access, csrfToken: session.csrfToken });
  });

  return app;
}
