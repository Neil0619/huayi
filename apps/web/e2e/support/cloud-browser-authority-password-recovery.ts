import type { Page, Request, Route } from "@playwright/test";
import {
  passwordLoginRequestSchema,
  passwordLoginResponseSchema,
  passwordRecoveryAcceptedResponseSchema,
  passwordRecoveryCallbackFormSchema,
  passwordRecoveryCompleteRequestSchema,
  passwordRecoveryConfirmQuerySchema,
  passwordRecoverySessionResponseSchema,
  passwordRecoveryStartRequestSchema,
  type ApiError,
} from "@huayi/cloud-contracts";

import { cloudCors, cloudErrorBody, cloudRequestBody } from "./cloud-browser-authority-request.js";
import type { CloudBrowserRequestFact } from "./cloud-browser-authority-types.js";

const apiOrigin = "https://api.huayi.invalid";
const mailOrigin = "https://mail.huayi.invalid";
const webOrigin = "https://web.huayi.invalid";
const email = "recovery-learner@example.com";
const originalPassword = "original horse battery staple";
const recoverySession = "cloud-e2e-password-recovery-session-000000";
const recoveryCsrf = "cloud-e2e-password-recovery-csrf-0000000";
const loginSession = "cloud-e2e-password-recovery-login-session";
const loginCsrf = "cloud-e2e-password-recovery-login-csrf";

interface Hooks {
  record(request: Request, proof: CloudBrowserRequestFact["proof"]): void;
}

interface RecoveryMail {
  code: string;
  flow: string;
  valid: boolean;
}

function exactForm(request: Request) {
  const contentType = request.headers()["content-type"]?.split(";", 1)[0];
  if (contentType !== "application/x-www-form-urlencoded") return undefined;
  const params = new URLSearchParams(request.postData() ?? "");
  const entries = [...params.entries()];
  if (entries.length !== 2 || entries.some(([key]) => params.getAll(key).length !== 1)) {
    return undefined;
  }
  return passwordRecoveryCallbackFormSchema.safeParse(Object.fromEntries(entries));
}

function exactQuery(url: URL) {
  const entries = [...url.searchParams.entries()];
  if (entries.length !== 2 || entries.some(([key]) => url.searchParams.getAll(key).length !== 1)) {
    return undefined;
  }
  return passwordRecoveryConfirmQuerySchema.safeParse(Object.fromEntries(entries));
}

async function privateJson(route: Route, status: number, body: unknown, setCookie?: string) {
  await route.fulfill({
    body: JSON.stringify(body),
    contentType: "application/json; charset=utf-8",
    headers: {
      ...(cloudCors(route.request().headers().origin) ?? {}),
      "cache-control": "private, no-store",
      ...(setCookie === undefined ? {} : { "set-cookie": setCookie }),
    },
    status,
  });
}

async function reject(route: Route, status: number, code: ApiError["error"]["code"]) {
  await privateJson(route, status, cloudErrorBody(code));
}

function cookie(request: Request, name: string): string | undefined {
  return request
    .headers()
    .cookie?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

function proof(index: number, marker: string): string {
  return `${marker}-${index}-`.padEnd(43, marker);
}

export function createCloudBrowserPasswordRecoveryAuthority() {
  let currentPassword = originalPassword;
  let extensionSessionCount = 2;
  let webSessionCount = 2;
  let notificationCount = 0;
  let recoverySessionActive = false;
  let callbackCount = 0;
  const mails: RecoveryMail[] = [];

  const start = async (route: Route, hooks: Hooks) => {
    const request = route.request();
    const parsed = passwordRecoveryStartRequestSchema.safeParse(cloudRequestBody(request));
    if (!parsed.success || request.headers().origin !== webOrigin) {
      hooks.record(request, "write-invalid");
      await reject(route, 400, "invalid_request");
      return;
    }
    if (parsed.data.email === email) {
      for (const mail of mails) mail.valid = false;
      const index = mails.length + 1;
      mails.push({ code: proof(index, "c"), flow: proof(index, "f"), valid: true });
    }
    hooks.record(request, "write-valid");
    await privateJson(route, 202, passwordRecoveryAcceptedResponseSchema.parse({ accepted: true }));
  };

  const confirm = async (route: Route, hooks: Hooks) => {
    const request = route.request();
    const parsed = exactQuery(new URL(request.url()));
    if (parsed === undefined || !parsed.success) {
      hooks.record(request, "write-invalid");
      await reject(route, 400, "invalid_request");
      return;
    }
    hooks.record(request, "read");
    await route.fulfill({
      body: `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>继续重置密码</title><main><h1>继续重置密码</h1><p>只有在你主动发起密码恢复时，才继续下一步。</p><form action="/v1/auth/password/recovery/callback" method="post"><input name="flow" type="hidden" value="${parsed.data.flow}"><input name="code" type="hidden" value="${parsed.data.code}"><button type="submit">继续重置密码</button></form></main></html>`,
      contentType: "text/html; charset=utf-8",
      headers: {
        "cache-control": "private, no-store",
        "content-security-policy":
          "default-src 'none'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
        "referrer-policy": "no-referrer",
      },
      status: 200,
    });
  };

  const callback = async (route: Route, hooks: Hooks) => {
    const request = route.request();
    const parsed = exactForm(request);
    if (parsed === undefined || !parsed.success) {
      hooks.record(request, "write-invalid");
      await reject(route, 400, "invalid_request");
      return;
    }
    const mail = mails.find(
      (candidate) => candidate.flow === parsed.data.flow && candidate.code === parsed.data.code,
    );
    const valid = mail?.valid === true;
    if (mail !== undefined) mail.valid = false;
    if (valid) {
      callbackCount += 1;
      recoverySessionActive = true;
    }
    hooks.record(request, "write-valid");
    await route.fulfill({
      headers: {
        "cache-control": "private, no-store",
        location: `${webOrigin}/recover?continue=1`,
        "referrer-policy": "no-referrer",
        ...(valid
          ? {
              "set-cookie":
                `huayi_password_recovery=${recoverySession}; HttpOnly; Secure; SameSite=Lax; ` +
                "Path=/v1/auth/password/recovery; Max-Age=900",
            }
          : {}),
      },
      status: 302,
    });
  };

  const session = async (route: Route, hooks: Hooks) => {
    const request = route.request();
    const valid =
      request.headers().origin === webOrigin &&
      recoverySessionActive &&
      cookie(request, "huayi_password_recovery") === recoverySession;
    hooks.record(request, valid ? "read" : "write-invalid");
    if (!valid) {
      await reject(route, 401, "authentication_required");
      return;
    }
    await privateJson(
      route,
      200,
      passwordRecoverySessionResponseSchema.parse({
        csrfToken: recoveryCsrf,
        expiresAt: "2099-08-14T10:15:00.000Z",
      }),
    );
  };

  const complete = async (route: Route, hooks: Hooks) => {
    const request = route.request();
    const parsed = passwordRecoveryCompleteRequestSchema.safeParse(cloudRequestBody(request));
    const valid =
      parsed.success &&
      request.headers().origin === webOrigin &&
      request.headers()["x-csrf-token"] === recoveryCsrf &&
      recoverySessionActive &&
      cookie(request, "huayi_password_recovery") === recoverySession;
    hooks.record(request, valid ? "write-valid" : "write-invalid");
    if (!valid || !parsed.success) {
      await reject(route, 403, "forbidden");
      return;
    }
    currentPassword = parsed.data.password;
    recoverySessionActive = false;
    extensionSessionCount = 0;
    webSessionCount = 0;
    notificationCount += 1;
    await route.fulfill({
      headers: {
        ...(cloudCors(request.headers().origin) ?? {}),
        "cache-control": "private, no-store",
        "set-cookie":
          "huayi_password_recovery=; HttpOnly; Secure; SameSite=Lax; " +
          "Path=/v1/auth/password/recovery; Max-Age=0",
      },
      status: 204,
    });
  };

  const login = async (route: Route, hooks: Hooks) => {
    const request = route.request();
    const parsed = passwordLoginRequestSchema.safeParse(cloudRequestBody(request));
    const valid =
      parsed.success &&
      request.headers().origin === webOrigin &&
      parsed.data.email === email &&
      parsed.data.password === currentPassword;
    hooks.record(request, parsed.success ? "write-valid" : "write-invalid");
    if (!valid) {
      await reject(route, 401, "authentication_required");
      return;
    }
    webSessionCount = 1;
    await privateJson(
      route,
      200,
      passwordLoginResponseSchema.parse({ access: "full", csrfToken: loginCsrf }),
      `huayi_session=${loginSession}; HttpOnly; Secure; SameSite=Lax; Path=/`,
    );
  };

  return {
    handleApi: async (route: Route, hooks: Hooks): Promise<boolean> => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (path === "/v1/auth/password/recovery" && request.method() === "POST") {
        await start(route, hooks);
        return true;
      }
      if (path === "/v1/auth/password/recovery/confirm" && request.method() === "GET") {
        await confirm(route, hooks);
        return true;
      }
      if (path === "/v1/auth/password/recovery/callback" && request.method() === "POST") {
        await callback(route, hooks);
        return true;
      }
      if (path === "/v1/auth/password/recovery/session" && request.method() === "GET") {
        await session(route, hooks);
        return true;
      }
      if (path === "/v1/auth/password/recovery/complete" && request.method() === "POST") {
        await complete(route, hooks);
        return true;
      }
      if (path === "/v1/auth/password/login" && request.method() === "POST") {
        await login(route, hooks);
        return true;
      }
      return false;
    },
    async install(page: Page) {
      await page.route(`${mailOrigin}/**`, async (route) => {
        const url = new URL(route.request().url());
        if (route.request().method() !== "GET" || url.pathname !== "/inbox") {
          await route.fulfill({ body: "Not found", status: 404 });
          return;
        }
        await route.fulfill({
          body: `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>测试密码恢复邮箱</title><main><h1>测试密码恢复邮箱</h1>${mails
            .map(
              (mail, index) =>
                `<form action="${apiOrigin}/v1/auth/password/recovery/confirm" method="get"><input name="flow" type="hidden" value="${mail.flow}"><input name="code" type="hidden" value="${mail.code}"><button type="submit">打开第 ${index + 1} 封恢复邮件</button></form>`,
            )
            .join("")}</main></html>`,
          contentType: "text/html; charset=utf-8",
          status: 200,
        });
      });
    },
    snapshot: () => ({
      callbackCount,
      extensionSessionCount,
      notificationCount,
      webSessionCount,
    }),
  };
}
