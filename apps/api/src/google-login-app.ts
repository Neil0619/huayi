import { googleLoginStartRequestSchema } from "@huayi/cloud-contracts";
import { Hono } from "hono";

import type { CloudFoundationDependencies } from "./cloud-foundation-dependencies.js";
import { CloudFault } from "./cloud-fault.js";
import { enforceRateLimit } from "./rate-limiter.js";

export function createGoogleLoginApp(dependencies: CloudFoundationDependencies) {
  const app = new Hono();
  app.post("/v1/auth/google/login/start", async (context) => {
    context.header("Cache-Control", "private, no-store");
    const contentType = context.req.header("content-type")?.split(";", 1)[0]?.trim();
    if (contentType === "application/json") {
      let input: unknown;
      try {
        input = await context.req.json();
      } catch {
        throw new CloudFault("invalid_request", "Expected a JSON request body.");
      }
      googleLoginStartRequestSchema.parse(input);
    } else if (contentType === "application/x-www-form-urlencoded") {
      if ((await context.req.text()) !== "") {
        throw new CloudFault("invalid_request", "The login form must be empty.");
      }
    } else {
      throw new CloudFault("invalid_request", "Unsupported authentication content type.");
    }
    await enforceRateLimit(dependencies.rateLimiter, {
      action: "auth.google-login",
      limit: 5,
      subject: `${context.req.header("x-vercel-forwarded-for") ?? "unavailable"}:existing-account`,
      windowMs: 60_000,
    });
    const flow = await dependencies.identity.createLoginAuthFlow();
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
  return app;
}
