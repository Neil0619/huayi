import {
  passwordSignupCallbackFormSchema,
  passwordSignupConfirmationHttpRoutes,
  passwordSignupConfirmQuerySchema,
} from "@huayi/cloud-contracts";
import { Hono, type Context } from "hono";

import { createCloudWebSession } from "./cloud-authentication-session.js";
import type { CloudFoundationDependencies } from "./cloud-foundation-dependencies.js";
import { CloudFault } from "./cloud-fault.js";
import { enforceRateLimit } from "./rate-limiter.js";
import { isEmailFirstSignup, signupUnavailable } from "./password-signup-state.js";
import {
  authConfirmationCsp,
  escapeAuthHtml,
  renderAuthConfirmationPage,
} from "./auth-confirmation-page.js";

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
    "The password confirmation is invalid.",
  );
}

async function exactForm<T>(context: Context, schema: { parse(value: unknown): T }): Promise<T> {
  const contentType = context.req.header("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/x-www-form-urlencoded") {
    throw invalidRequest("Expected a password confirmation form.");
  }
  return parseExactParams(
    new URLSearchParams(await context.req.text()),
    schema,
    "The password confirmation form is invalid.",
  );
}

function confirmationPage(flow: string, webOrigin: string, retry = false): string {
  return renderAuthConfirmationPage({
    title: "确认语见邮箱",
    introduction: "输入验证邮件中的六位验证码，完成邮箱验证。打开此页面不会自动使用验证码。",
    webOrigin,
    body: `${retry ? '<p class="alert" role="alert">验证未完成。请检查邮箱和验证码后重试；若验证码已使用，请返回原邀请继续中断注册。</p>' : ""}
      <form method="post" action="${passwordSignupConfirmationHttpRoutes.callback}">
        <input type="hidden" name="flow" value="${escapeAuthHtml(flow)}">
        <label for="email">邮箱</label>
        <input id="email" name="email" type="email" autocomplete="email" required>
        <label for="token">六位验证码</label>
        <input id="token" name="token" type="text" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" minlength="6" maxlength="6" required>
        <button type="submit">确认邮箱并继续</button>
      </form>
    `,
  });
}

export function createPasswordSignupConfirmationApp(dependencies: CloudFoundationDependencies) {
  const app = new Hono();

  app.get(passwordSignupConfirmationHttpRoutes.confirm, async (context) => {
    context.header("Cache-Control", "private, no-store");
    context.header("Content-Security-Policy", authConfirmationCsp(dependencies.webOrigin));
    context.header("Referrer-Policy", "no-referrer");
    const input = exactQuery(context, passwordSignupConfirmQuerySchema);
    if (await isEmailFirstSignup(dependencies, input.flow))
      return context.redirect(`${dependencies.webOrigin}/join`, 302);
    return context.html(confirmationPage(input.flow, dependencies.webOrigin));
  });

  app.post(passwordSignupConfirmationHttpRoutes.callback, async (context) => {
    context.header("Cache-Control", "private, no-store");
    context.header("Content-Security-Policy", authConfirmationCsp(dependencies.webOrigin));
    context.header("Referrer-Policy", "no-referrer");
    if (new URL(context.req.url).search !== "") {
      throw invalidRequest("The password confirmation form is invalid.");
    }
    const input = await exactForm(context, passwordSignupCallbackFormSchema);
    if (await isEmailFirstSignup(dependencies, input.flow)) throw signupUnavailable();
    const ipBucket = context.req.header("x-vercel-forwarded-for") ?? "unavailable";
    await enforceRateLimit(dependencies.rateLimiter, {
      action: "password-signup.confirm.ip",
      limit: 10,
      subject: ipBucket,
      windowMs: 3_600_000,
    });
    await enforceRateLimit(dependencies.rateLimiter, {
      action: "password-signup.confirm.email",
      limit: 5,
      subject: input.email,
      windowMs: 3_600_000,
    });
    try {
      const authSession = await dependencies.auth.verifyPasswordRegistrationOtp({
        email: input.email,
        token: input.token,
      });
      await dependencies.identity.completeAuthFlow(
        input.flow,
        authSession.userId,
        authSession.email,
        "password",
      );
      const session = await createCloudWebSession(dependencies, authSession);
      context.header("Set-Cookie", session.setCookie);
      return context.redirect(`${dependencies.webOrigin}/practice`, 302);
    } catch (error) {
      if (!(error instanceof CloudFault) || error.code !== "authentication_required") throw error;
      return context.html(confirmationPage(input.flow, dependencies.webOrigin, true), 400);
    }
  });

  return app;
}
