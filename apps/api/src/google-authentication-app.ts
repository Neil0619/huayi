import { Hono } from "hono";

import { completeCloudAuthenticationCallback } from "./cloud-authentication-session.js";
import type { CloudFoundationDependencies } from "./cloud-foundation-dependencies.js";
import { googleAuthStartInput } from "./google-auth-start-input.js";
import { createGoogleLinkApp } from "./google-link-app.js";
import { createGoogleLinkModule } from "./google-link-module.js";
import { createGoogleLoginApp } from "./google-login-app.js";
import { createGoogleReauthenticationApp } from "./google-reauthentication-app.js";
import { enforceRateLimit } from "./rate-limiter.js";

export function createGoogleAuthenticationApp(dependencies: CloudFoundationDependencies) {
  const app = new Hono();

  app.post("/v1/auth/google/start", async (context) => {
    context.header("Cache-Control", "private, no-store");
    const { claimTicket } = await googleAuthStartInput(context);
    const clientIp = context.req.header("x-vercel-forwarded-for") ?? "unavailable";
    await enforceRateLimit(dependencies.rateLimiter, {
      action: "auth.google",
      limit: 5,
      subject: `${clientIp}:${claimTicket}`,
      windowMs: 60_000,
    });
    await dependencies.identity.requireClaimTicket(claimTicket);
    const flow = await dependencies.identity.createAuthFlow(claimTicket);
    const redirectTo = `${dependencies.apiOrigin}/v1/auth/callback?flow=${encodeURIComponent(flow.flowId)}`;
    const result = await dependencies.auth.beginGoogle({ redirectTo });
    await dependencies.identity.saveAuthFlowState(
      flow.flowId,
      (dependencies.protectTransientAuthState ?? dependencies.protectRefreshToken)(
        JSON.stringify(result.authState),
      ),
    );
    return context.redirect(result.redirectUrl, 302);
  });

  app.route("/", createGoogleLoginApp(dependencies));
  app.route(
    "/",
    createGoogleLinkApp({
      link: createGoogleLinkModule({
        apiOrigin: dependencies.apiOrigin,
        auth: dependencies.auth,
        protectRefreshToken: dependencies.protectRefreshToken,
        protectTransientAuthState:
          dependencies.protectTransientAuthState ?? dependencies.protectRefreshToken,
        repository: dependencies.googleLink,
        unprotectRefreshToken: dependencies.unprotectRefreshToken,
        unprotectTransientAuthState: dependencies.unprotectTransientAuthState ?? ((value) => value),
      }),
      rateLimiter: dependencies.rateLimiter,
      webOrigin: dependencies.webOrigin,
    }),
  );
  app.route("/", createGoogleReauthenticationApp(dependencies));
  app.get("/v1/auth/callback", (context) =>
    completeCloudAuthenticationCallback(dependencies, context),
  );

  return app;
}
