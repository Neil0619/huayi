import {
  passwordSignupCompleteRequestSchema,
  passwordSignupHttpRoutes,
  passwordSignupResendRequestSchema,
  passwordSignupSessionResponseSchema,
  passwordSignupStartRequestSchema,
  passwordSignupVerifyRequestSchema,
} from "@huayi/cloud-contracts";
import { Hono, type Context } from "hono";

import { createCloudWebSession } from "./cloud-authentication-session.js";
import type { CloudFoundationDependencies } from "./cloud-foundation-dependencies.js";
import { CloudFault } from "./cloud-fault.js";
import { createPasswordSignupModule } from "./password-signup-module.js";
import { enforceRateLimit } from "./rate-limiter.js";
import { strictJson } from "./strict-json.js";

function signupCookie(context: Context) {
  const cookies = (context.req.header("cookie") ?? "")
    .split(";")
    .map((value) => value.trim())
    .filter((value) => value.startsWith("huayi_signup="));
  return cookies.length === 1 ? cookies[0]?.slice("huayi_signup=".length) : undefined;
}
function csrf(context: Context) {
  const token = context.req.header("x-csrf-token");
  if (token === undefined)
    throw new CloudFault("authentication_required", "Registration proof is required.");
  return token;
}

export function createPasswordSignupApp(dependencies: CloudFoundationDependencies) {
  const app = new Hono();
  const signup = createPasswordSignupModule(dependencies);
  const limit = (action: string, subject: string, maximum: number, windowMs = 3_600_000) =>
    enforceRateLimit(dependencies.rateLimiter, { action, subject, limit: maximum, windowMs });
  const ip = (context: Context) => context.req.header("x-vercel-forwarded-for") ?? "unavailable";

  app.use("/v1/auth/password/signup/*", async (context, next) => {
    context.header("Cache-Control", "private, no-store");
    context.header("Referrer-Policy", "no-referrer");
    if (context.req.header("origin") !== dependencies.webOrigin)
      throw new CloudFault("forbidden", "The request origin is invalid.");
    if (
      new URL(context.req.url).search !== "" ||
      (context.req.method === "POST" &&
        context.req.header("content-type")?.split(";", 1)[0]?.trim() !== "application/json")
    )
      throw new CloudFault("invalid_request", "The registration request is invalid.");
    await next();
  });

  app.post(passwordSignupHttpRoutes.start, async (context) => {
    const input = await strictJson(context, passwordSignupStartRequestSchema);
    await limit("auth.register", `${ip(context)}:${input.email}`, 5, 60_000);
    const result = await signup.start(input.claimTicket, input.email);
    context.header(
      "Set-Cookie",
      `huayi_signup=${result.browser}; HttpOnly; Secure; SameSite=Lax; Path=/v1/auth/password/signup; Max-Age=86400`,
    );
    return context.json(passwordSignupSessionResponseSchema.parse(result.session), 202);
  });
  app.get(passwordSignupHttpRoutes.session, async (context) =>
    context.json(
      passwordSignupSessionResponseSchema.parse(await signup.session(signupCookie(context))),
    ),
  );
  app.post(passwordSignupHttpRoutes.verify, async (context) => {
    const input = await strictJson(context, passwordSignupVerifyRequestSchema);
    const proof = csrf(context);
    const browser = signupCookie(context);
    const email = await signup.boundEmail(browser, proof);
    await limit("password-signup.confirm.ip", ip(context), 10);
    await limit("password-signup.confirm.email", email, 5);
    return context.json(
      passwordSignupSessionResponseSchema.parse(await signup.verify(browser, proof, input.token)),
    );
  });
  app.post(passwordSignupHttpRoutes.resend, async (context) => {
    await strictJson(context, passwordSignupResendRequestSchema);
    const proof = csrf(context);
    const browser = signupCookie(context);
    const email = await signup.boundEmail(browser, proof);
    await limit("auth.register-resend.ip", ip(context), 5);
    await limit("auth.signup-resend.email", email, 3);
    await signup.resend(browser, proof);
    return context.json({ accepted: true as const }, 202);
  });
  app.post(passwordSignupHttpRoutes.complete, async (context) => {
    const input = await strictJson(context, passwordSignupCompleteRequestSchema);
    const proof = csrf(context);
    const browser = signupCookie(context);
    const email = await signup.boundEmail(browser, proof);
    await limit("auth.signup-complete", `${ip(context)}:${email}`, 5, 60_000);
    const authenticated = await signup.complete(browser, proof, input.password);
    const session = await createCloudWebSession(dependencies, authenticated);
    context.header("Set-Cookie", session.setCookie);
    context.header(
      "Set-Cookie",
      "huayi_signup=; HttpOnly; Secure; SameSite=Lax; Path=/v1/auth/password/signup; Max-Age=0",
      { append: true },
    );
    return context.json({ access: session.access, csrfToken: session.csrfToken });
  });
  return app;
}
