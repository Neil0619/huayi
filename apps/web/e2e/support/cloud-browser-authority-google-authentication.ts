import type { Page, Request, Route } from "@playwright/test";
import {
  csrfTokenResponseSchema,
  googleLoginStartRequestSchema,
  type ApiError,
} from "@huayi/cloud-contracts";

import { cloudCors, cloudErrorBody } from "./cloud-browser-authority-request.js";
import type { CloudBrowserRequestFact } from "./cloud-browser-authority-types.js";

const apiOrigin = "https://api.huayi.invalid";
const providerOrigin = "https://accounts.google.invalid";
const webOrigin = "https://web.huayi.invalid";
const flowId = "cloud-e2e-google-login-flow";
const authorizationCode = "cloud-e2e-google-login-code";
const csrfToken = "cloud-e2e-google-login-csrf-000000";
const session = "cloud-e2e-google-login-session";

export type GoogleAuthenticationSeed =
  "disabled-google-authentication" | "google-authentication" | "unregistered-google-authentication";

interface Hooks {
  record(request: Request, proof: CloudBrowserRequestFact["proof"]): void;
}

function exactQuery(url: URL, expected: Record<string, string>): boolean {
  const entries = [...url.searchParams.entries()];
  return (
    entries.length === Object.keys(expected).length &&
    entries.every(([key, value]) => expected[key] === value)
  );
}

function hasSession(request: Request): boolean {
  return new RegExp(`(?:^|;\\s*)huayi_session=${session}(?:;|$)`, "u").test(
    request.headers().cookie ?? "",
  );
}

async function privateJson(route: Route, status: number, body: unknown) {
  await route.fulfill({
    body: JSON.stringify(body),
    contentType: "application/json; charset=utf-8",
    headers: {
      ...(cloudCors(route.request().headers().origin) ?? {}),
      "cache-control": "private, no-store",
    },
    status,
  });
}

async function rejectCallback(route: Route, status: number, code: ApiError["error"]["code"]) {
  await route.fulfill({
    body: JSON.stringify(cloudErrorBody(code)),
    contentType: "application/json; charset=utf-8",
    headers: {
      "cache-control": "private, no-store",
      "referrer-policy": "no-referrer",
    },
    status,
  });
}

export function createCloudBrowserGoogleAuthenticationAuthority(seed: GoogleAuthenticationSeed) {
  const access = seed === "disabled-google-authentication" ? "data-rights" : "full";
  const signInMethod = seed === "unregistered-google-authentication" ? "password" : "google";
  let flow: "available" | "started" | "consumed" = "available";
  let webSessionCount = 0;

  const handleStart = async (route: Route, hooks: Hooks) => {
    const request = route.request();
    const contentType = request.headers()["content-type"]?.split(";", 1)[0]?.trim();
    const raw = request.postData() ?? "";
    const parsed = googleLoginStartRequestSchema.safeParse(
      contentType === "application/x-www-form-urlencoded" && raw === "" ? {} : raw,
    );
    if (!parsed.success || flow !== "available") {
      hooks.record(request, "write-invalid");
      await privateJson(route, 400, cloudErrorBody("invalid_request"));
      return;
    }
    flow = "started";
    hooks.record(request, "write-valid");
    await route.fulfill({
      headers: {
        "cache-control": "private, no-store",
        location: `${providerOrigin}/consent?flow=${encodeURIComponent(flowId)}`,
      },
      status: 302,
    });
  };

  const handleCallback = async (route: Route, hooks: Hooks) => {
    const request = route.request();
    if (
      flow !== "started" ||
      !exactQuery(new URL(request.url()), { code: authorizationCode, flow: flowId })
    ) {
      hooks.record(request, "write-invalid");
      await rejectCallback(route, 400, "invalid_request");
      return;
    }
    flow = "consumed";
    if (signInMethod !== "google") {
      hooks.record(request, "write-invalid");
      await rejectCallback(route, 401, "authentication_required");
      return;
    }
    webSessionCount = 1;
    hooks.record(request, "write-valid");
    await route.fulfill({
      headers: {
        "cache-control": "private, no-store",
        location: `${webOrigin}${access === "full" ? "/practice" : "/settings/data"}`,
        "referrer-policy": "no-referrer",
        "set-cookie": `huayi_session=${session}; HttpOnly; Secure; SameSite=Lax; Path=/`,
      },
      status: 302,
    });
  };

  return {
    authenticated(request: Request) {
      return webSessionCount === 1 && hasSession(request);
    },
    async handleApi(route: Route, hooks: Hooks): Promise<boolean> {
      const request = route.request();
      const url = new URL(request.url());
      if (url.pathname === "/v1/auth/google/login/start" && request.method() === "POST") {
        await handleStart(route, hooks);
        return true;
      }
      if (url.pathname === "/v1/auth/callback" && request.method() === "GET") {
        await handleCallback(route, hooks);
        return true;
      }
      if (url.pathname === "/v1/auth/csrf" && request.method() === "GET" && hasSession(request)) {
        hooks.record(request, "read");
        await privateJson(
          route,
          webSessionCount === 1 ? 200 : 401,
          webSessionCount === 1
            ? csrfTokenResponseSchema.parse({ access, csrfToken })
            : cloudErrorBody("authentication_required"),
        );
        return true;
      }
      return false;
    },
    async install(page: Page) {
      await page.route(`${providerOrigin}/**`, async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        if (
          request.method() !== "GET" ||
          url.pathname !== "/consent" ||
          flow !== "started" ||
          !exactQuery(url, { flow: flowId })
        ) {
          await route.fulfill({ body: "Not found", status: 404 });
          return;
        }
        await route.fulfill({
          body: `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>测试 Google 登录</title><main><h1>测试 Google 登录</h1><p>此页面只模拟离线验收中的既有账号授权。</p><form action="${apiOrigin}/v1/auth/callback" method="get"><input name="flow" type="hidden" value="${flowId}"><input name="code" type="hidden" value="${authorizationCode}"><button type="submit">以测试账号继续</button></form></main></html>`,
          contentType: "text/html; charset=utf-8",
          status: 200,
        });
      });
    },
    snapshot: () => ({ webSessionCount }),
  };
}
