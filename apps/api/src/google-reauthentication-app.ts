import {
  googleReauthenticationStartRequestSchema,
  identityHttpRoutes,
} from "@huayi/cloud-contracts";
import { Hono } from "hono";

import type { CloudFoundationDependencies } from "./cloud-foundation-dependencies.js";
import { CloudFault } from "./cloud-fault.js";
import { enforceRateLimit } from "./rate-limiter.js";
import { strictJson } from "./strict-json.js";
import { cookieValue, webSessionCookie } from "./web-session-cookie.js";

const intentName = "huayi_google_reauth";
const continuePath = identityHttpRoutes.googleReauthenticationContinue;
const intentAttributes = `HttpOnly; Secure; SameSite=Strict; Path=${continuePath}`;

export function createGoogleReauthenticationApp(dependencies: CloudFoundationDependencies) {
  const app = new Hono();

  app.post(identityHttpRoutes.googleReauthenticationStart, async (context) => {
    context.header("Cache-Control", "private, no-store");
    const sessionId = webSessionCookie(context);
    const csrfToken = context.req.header("x-csrf-token");
    const origin = context.req.header("origin");
    if (sessionId === undefined || csrfToken === undefined || origin === undefined) {
      throw new CloudFault("authentication_required", "Web session proof is required.");
    }
    await strictJson(context, googleReauthenticationStartRequestSchema);
    await enforceRateLimit(dependencies.rateLimiter, {
      action: "auth.google-reauthenticate",
      limit: 5,
      subject: `${context.req.header("x-vercel-forwarded-for") ?? "unavailable"}:${sessionId}`,
      windowMs: 60_000,
    });
    const flow = await dependencies.identity.createGoogleReauthentication(
      sessionId,
      origin,
      csrfToken,
    );
    context.header("Set-Cookie", `${intentName}=${flow.flowId}; ${intentAttributes}; Max-Age=900`);
    return context.json({ continuePath });
  });

  app.get(continuePath, async (context) => {
    const sessionId = webSessionCookie(context);
    const flowId = cookieValue(context, intentName);
    if (sessionId === undefined || flowId === undefined) {
      throw new CloudFault("authentication_required", "Google authentication proof is required.");
    }
    await dependencies.identity.continueGoogleReauthentication(flowId, sessionId);
    const result = await dependencies.auth.beginGoogle({
      redirectTo: `${dependencies.apiOrigin}/v1/auth/reauthenticate/google/callback?flow=${encodeURIComponent(flowId)}`,
    });
    await dependencies.identity.saveAuthFlowState(
      flowId,
      (dependencies.protectTransientAuthState ?? dependencies.protectRefreshToken)(
        JSON.stringify(result.authState),
      ),
    );
    context.header("Set-Cookie", `${intentName}=; ${intentAttributes}; Max-Age=0`);
    context.header("Cache-Control", "private, no-store");
    return context.redirect(result.redirectUrl, 302);
  });

  app.get("/v1/auth/reauthenticate/google/callback", async (context) => {
    const code = context.req.query("code");
    const flowId = context.req.query("flow");
    const sessionId = webSessionCookie(context);
    if (code === undefined || flowId === undefined || sessionId === undefined) {
      throw new CloudFault("authentication_required", "Google authentication proof is required.");
    }
    const protectedState = await dependencies.identity.readAuthFlowState(flowId);
    const serializedState = (
      dependencies.unprotectTransientAuthState ?? ((value: string) => value)
    )(protectedState);
    const providerSession = await dependencies.auth.completeCode({
      authState: JSON.parse(serializedState) as Record<string, string>,
      code,
    });
    const session = await dependencies.identity.completeGoogleReauthentication(
      flowId,
      sessionId,
      providerSession.userId,
      dependencies.protectRefreshToken(providerSession.refreshToken),
    );
    context.header("Set-Cookie", session.setCookie);
    context.header("Cache-Control", "private, no-store");
    return context.redirect(`${dependencies.webOrigin}/settings/account`, 302);
  });

  return app;
}
