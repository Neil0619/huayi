import type { Page, Request, Route } from "@playwright/test";
import {
  claimInvitationRequestSchema,
  claimInvitationResponseSchema,
  passwordLoginRequestSchema,
  passwordLoginResponseSchema,
  passwordRegistrationRequestSchema,
  passwordRegistrationResendRequestSchema,
  passwordRegistrationResendResponseSchema,
  passwordRegistrationResponseSchema,
  passwordSignupCallbackFormSchema,
  type ApiError,
} from "@huayi/cloud-contracts";

import { cloudCors, cloudErrorBody, cloudRequestBody } from "./cloud-browser-authority-request.js";
import type { CloudBrowserRequestFact } from "./cloud-browser-authority-types.js";

const apiOrigin = "https://api.huayi.invalid";
const mailOrigin = "https://mail.huayi.invalid";
const webOrigin = "https://web.huayi.invalid";
const invitationToken = "i".repeat(32);
const claimTicket = "c".repeat(32);
const originalConfirmationFlow = "f".repeat(43);
const resentConfirmationFlow = "n".repeat(43);
const email = "password-learner@example.com";
const password = "correct horse battery staple";
const registrationSession = "cloud-e2e-password-registration-session";
const loginSession = "cloud-e2e-password-login-session";
const loginCsrf = "cloud-e2e-password-login-csrf-000000";

interface Hooks {
  json(route: Route, status: number, body: unknown): Promise<void>;
  record(request: Request, proof: CloudBrowserRequestFact["proof"]): void;
  reject(
    route: Route,
    status: number,
    code: ApiError["error"]["code"],
    proof?: CloudBrowserRequestFact["proof"],
  ): Promise<void>;
}

function exactQuery(url: URL, expected: Record<string, string>): boolean {
  const entries = [...url.searchParams.entries()];
  return (
    entries.length === Object.keys(expected).length &&
    entries.every(([key, value]) => expected[key] === value)
  );
}

async function privateJson(route: Route, status: number, body: unknown, setCookie?: string) {
  const headers = {
    ...(cloudCors(route.request().headers().origin) ?? {}),
    "cache-control": "private, no-store",
    ...(setCookie === undefined ? {} : { "set-cookie": setCookie }),
  };
  await route.fulfill({
    body: JSON.stringify(body),
    contentType: "application/json; charset=utf-8",
    headers,
    status,
  });
}

export function createCloudBrowserPasswordAuthenticationAuthority(
  seed: "password-authentication" | "unregistered-password-login",
) {
  let invitation: "available" | "claimed" | "consumed" = "available";
  let registration: "confirmed" | "confirmation-pending" | "none" =
    seed === "unregistered-password-login" ? "confirmed" : "none";
  let callback: "available" | "consumed" = "available";
  let confirmationCode = "123456";
  let confirmationFlow = originalConfirmationFlow;
  const signInMethods = new Set<"google" | "password">(
    seed === "unregistered-password-login" ? ["google"] : [],
  );

  const handleClaim = async (route: Route, hooks: Hooks) => {
    const request = route.request();
    const parsed = claimInvitationRequestSchema.safeParse(cloudRequestBody(request));
    if (
      !parsed.success ||
      parsed.data.invitationToken !== invitationToken ||
      request.headers().referer !== undefined
    ) {
      return hooks.reject(route, 400, "invalid_request");
    }
    if (invitation !== "available") {
      return hooks.reject(route, 409, "invitation_consumed");
    }
    invitation = "claimed";
    hooks.record(request, "write-valid");
    await hooks.json(
      route,
      200,
      claimInvitationResponseSchema.parse({
        claimTicket,
        expiresAt: "2026-08-13T10:15:00.000Z",
      }),
    );
  };

  const handleRegistration = async (route: Route, hooks: Hooks) => {
    const request = route.request();
    const parsed = passwordRegistrationRequestSchema.safeParse(cloudRequestBody(request));
    if (
      !parsed.success ||
      request.headers().origin !== webOrigin ||
      invitation !== "claimed" ||
      registration !== "none" ||
      parsed.data.claimTicket !== claimTicket ||
      parsed.data.email !== email ||
      parsed.data.password !== password
    ) {
      hooks.record(request, "write-invalid");
      await privateJson(route, 400, cloudErrorBody("invalid_request"));
      return;
    }
    registration = "confirmation-pending";
    hooks.record(request, "write-valid");
    await privateJson(
      route,
      202,
      passwordRegistrationResponseSchema.parse({ emailConfirmationRequired: true }),
    );
  };

  const handleConfirmation = async (route: Route, hooks: Hooks) => {
    const request = route.request();
    if (
      registration !== "confirmation-pending" ||
      callback !== "available" ||
      !exactQuery(new URL(request.url()), { flow: confirmationFlow })
    ) {
      return hooks.reject(route, 404, "not_found");
    }
    hooks.record(request, "read");
    await route.fulfill({
      body: `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>确认语见邮箱</title><main><h1>确认语见邮箱</h1><p>输入验证邮件中的六位验证码。</p><form action="/v1/auth/password/callback" method="post"><input name="flow" type="hidden" value="${confirmationFlow}"><label for="email">邮箱</label><input id="email" name="email" type="email"><label for="token">六位验证码</label><input id="token" name="token" type="text"><button type="submit">确认邮箱并继续</button></form></main></html>`,
      contentType: "text/html; charset=utf-8",
      headers: {
        "cache-control": "private, no-store",
        "content-security-policy": `default-src 'none'; form-action 'self' ${webOrigin}; base-uri 'none'; frame-ancestors 'none'`,
        "referrer-policy": "no-referrer",
      },
      status: 200,
    });
  };

  const handleResend = async (route: Route, hooks: Hooks) => {
    const request = route.request();
    const parsed = passwordRegistrationResendRequestSchema.safeParse(cloudRequestBody(request));
    if (
      !parsed.success ||
      request.headers().origin !== webOrigin ||
      parsed.data.invitationToken !== invitationToken ||
      invitation !== "claimed" ||
      registration !== "confirmation-pending" ||
      callback !== "available"
    ) {
      hooks.record(request, "write-invalid");
      await privateJson(route, 400, cloudErrorBody("invalid_request"));
      return;
    }
    confirmationFlow = resentConfirmationFlow;
    confirmationCode = "654321";
    hooks.record(request, "write-valid");
    await privateJson(
      route,
      202,
      passwordRegistrationResendResponseSchema.parse({ accepted: true }),
    );
  };

  const handleCallback = async (route: Route, hooks: Hooks) => {
    const request = route.request();
    const contentType = request.headers()["content-type"]?.split(";", 1)[0];
    const entries = [...new URLSearchParams(request.postData() ?? "").entries()];
    const form = Object.fromEntries(entries);
    const parsed = passwordSignupCallbackFormSchema.safeParse(form);
    if (
      registration !== "confirmation-pending" ||
      callback !== "available" ||
      request.method() !== "POST" ||
      contentType !== "application/x-www-form-urlencoded" ||
      entries.length !== 3 ||
      new Set(entries.map(([key]) => key)).size !== entries.length ||
      !parsed.success ||
      parsed.data.email !== email ||
      parsed.data.flow !== confirmationFlow ||
      parsed.data.token !== confirmationCode
    ) {
      return hooks.reject(route, 404, "not_found");
    }
    invitation = "consumed";
    registration = "confirmed";
    signInMethods.add("password");
    callback = "consumed";
    hooks.record(request, "write-valid");
    await route.fulfill({
      body: "",
      headers: {
        "cache-control": "private, no-store",
        location: `${webOrigin}/practice`,
        "referrer-policy": "no-referrer",
        "set-cookie": `huayi_session=${registrationSession}; HttpOnly; Secure; SameSite=Lax; Path=/`,
      },
      status: 302,
    });
  };

  const handleLogin = async (route: Route, hooks: Hooks) => {
    const request = route.request();
    const parsed = passwordLoginRequestSchema.safeParse(cloudRequestBody(request));
    if (!parsed.success || request.headers().origin !== webOrigin || registration !== "confirmed") {
      hooks.record(request, "write-invalid");
      await privateJson(route, 400, cloudErrorBody("invalid_request"));
      return;
    }
    if (parsed.data.email !== email || parsed.data.password !== password) {
      hooks.record(request, "write-valid");
      await privateJson(route, 401, cloudErrorBody("authentication_required"));
      return;
    }
    if (!signInMethods.has("password")) {
      hooks.record(request, "write-valid");
      await privateJson(route, 401, cloudErrorBody("authentication_required"));
      return;
    }
    hooks.record(request, "write-valid");
    await privateJson(
      route,
      200,
      passwordLoginResponseSchema.parse({ access: "full", csrfToken: loginCsrf }),
      `huayi_session=${loginSession}; HttpOnly; Secure; SameSite=Lax; Path=/`,
    );
  };

  const handleApi = async (route: Route, hooks: Hooks): Promise<boolean> => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/v1/invitations/claim" && request.method() === "POST") {
      await handleClaim(route, hooks);
      return true;
    }
    if (path === "/v1/auth/password/register" && request.method() === "POST") {
      await handleRegistration(route, hooks);
      return true;
    }
    if (path === "/v1/auth/password/register/resend" && request.method() === "POST") {
      await handleResend(route, hooks);
      return true;
    }
    if (path === "/v1/auth/password/confirm" && request.method() === "GET") {
      await handleConfirmation(route, hooks);
      return true;
    }
    if (path === "/v1/auth/password/callback" && request.method() === "POST") {
      await handleCallback(route, hooks);
      return true;
    }
    if (path === "/v1/auth/password/login" && request.method() === "POST") {
      await handleLogin(route, hooks);
      return true;
    }
    return false;
  };

  const serveMailbox = async (route: Route) => {
    const request = route.request();
    if (
      request.method() !== "GET" ||
      new URL(request.url()).pathname !== "/inbox" ||
      registration !== "confirmation-pending" ||
      callback !== "available"
    ) {
      await route.fulfill({ body: "Not found", status: 404 });
      return;
    }
    await route.fulfill({
      body: `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>测试邮箱确认</title><main><h1>测试邮箱确认</h1><p>验证码：<strong>${confirmationCode}</strong></p><a href="${apiOrigin}/v1/auth/password/confirm?flow=${confirmationFlow}">打开确认页</a></main></html>`,
      contentType: "text/html; charset=utf-8",
      status: 200,
    });
  };

  return {
    handleApi,
    async install(page: Page) {
      await page.route(`${mailOrigin}/**`, serveMailbox);
    },
  };
}
