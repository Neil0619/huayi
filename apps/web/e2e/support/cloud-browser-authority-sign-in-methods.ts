import type { Page, Request, Route } from "@playwright/test";
import {
  accountSignInMethodsResponseSchema,
  googleLinkStartRequestSchema,
  googleLinkStartResponseSchema,
  googleReauthenticationStartRequestSchema,
  googleReauthenticationStartResponseSchema,
  passwordLinkRequestSchema,
  passwordReauthenticationRequestSchema,
  passwordReauthenticationResponseSchema,
  type ApiError,
  type SignInMethod,
} from "@huayi/cloud-contracts";

import { cloudCors, cloudRequestBody } from "./cloud-browser-authority-request.js";
import type { CloudBrowserRequestFact } from "./cloud-browser-authority-types.js";

const apiOrigin = "https://api.huayi.invalid";
const providerOrigin = "https://accounts.google.invalid";
const webOrigin = "https://web.huayi.invalid";
const refreshedCsrf = "cloud-e2e-refreshed-csrf-token-000000";
const password = "correct horse battery staple";
const linkedAt = "2026-08-14T00:00:00.000Z";

interface Hooks {
  readonly json: (route: Route, status: number, body: unknown) => Promise<void>;
  readonly mutationProof: (request: Request) => boolean;
  readonly record: (request: Request, proof: CloudBrowserRequestFact["proof"]) => void;
  readonly reject: (
    route: Route,
    status: number,
    code: ApiError["error"]["code"],
    proof?: CloudBrowserRequestFact["proof"],
  ) => Promise<void>;
}

type Seed =
  | "google-only-sign-in-methods"
  | "password-only-sign-in-methods"
  | "stale-password-sign-in-methods";
type GoogleFlow = "idle" | "provider" | "recent";

export function createCloudBrowserSignInMethodsAuthority(seed: Seed | null) {
  let methods: SignInMethod[] =
    seed === "google-only-sign-in-methods" || seed === "stale-password-sign-in-methods"
      ? ["google"]
      : ["password"];
  let googleFlow: GoogleFlow = "idle";
  let flowPurpose: "link" | "reauthenticate" | null = null;

  const response = () =>
    accountSignInMethodsResponseSchema.parse({
      methods: methods.map((method, index) => ({
        linkedAt: new Date(Date.parse(linkedAt) + index * 1_000).toISOString(),
        method,
      })),
    });

  const startGoogle = async (route: Route, hooks: Hooks, purpose: "link" | "reauthenticate") => {
    const request = route.request();
    const parsed =
      purpose === "link"
        ? googleLinkStartRequestSchema.safeParse(cloudRequestBody(request))
        : googleReauthenticationStartRequestSchema.safeParse(cloudRequestBody(request));
    if (!parsed.success || !hooks.mutationProof(request)) {
      await hooks.reject(route, 403, "forbidden");
      return;
    }
    flowPurpose = purpose;
    hooks.record(request, "write-valid");
    await hooks.json(
      route,
      200,
      purpose === "link"
        ? googleLinkStartResponseSchema.parse({
            continuePath: "/v1/account/sign-in-methods/google:continue",
          })
        : googleReauthenticationStartResponseSchema.parse({
            continuePath: "/v1/auth/reauthenticate/google/continue",
          }),
    );
  };

  const continueGoogle = async (route: Route, hooks: Hooks) => {
    const request = route.request();
    if (flowPurpose === null) {
      await hooks.reject(route, 404, "not_found");
      return;
    }
    googleFlow = "provider";
    hooks.record(request, "write-valid");
    await route.fulfill({
      headers: {
        "cache-control": "private, no-store",
        location: `${providerOrigin}/consent?purpose=${flowPurpose}`,
      },
      status: 302,
    });
  };

  const callbackGoogle = async (route: Route, hooks: Hooks) => {
    const request = route.request();
    const purpose = new URL(request.url()).searchParams.get("purpose");
    if (googleFlow !== "provider" || purpose !== flowPurpose) {
      await hooks.reject(route, 404, "not_found");
      return;
    }
    if (flowPurpose === "link") methods = ["password", "google"];
    else googleFlow = "recent";
    hooks.record(request, "write-valid");
    await route.fulfill({
      headers: {
        "cache-control": "private, no-store",
        location: `${webOrigin}/settings/account`,
        "set-cookie":
          "huayi_session=cloud-e2e-linked-web-session; HttpOnly; Secure; SameSite=Lax; Path=/",
      },
      status: 302,
    });
  };

  const handleApi = async (route: Route, hooks: Hooks): Promise<boolean> => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/v1/account/sign-in-methods" && request.method() === "GET") {
      hooks.record(request, "read");
      await hooks.json(route, 200, response());
      return true;
    }
    if (seed === null) return false;
    if (path === "/v1/auth/reauthenticate/password" && request.method() === "POST") {
      const parsed = passwordReauthenticationRequestSchema.safeParse(cloudRequestBody(request));
      if (!parsed.success || parsed.data.password !== password || !hooks.mutationProof(request)) {
        await hooks.reject(route, 401, "authentication_required");
        return true;
      }
      hooks.record(request, "write-valid");
      await route.fulfill({
        body: JSON.stringify(
          passwordReauthenticationResponseSchema.parse({
            access: "full",
            csrfToken: refreshedCsrf,
          }),
        ),
        contentType: "application/json; charset=utf-8",
        headers: {
          ...(cloudCors(request.headers().origin) ?? {}),
          "set-cookie":
            "huayi_session=cloud-e2e-linked-web-session; HttpOnly; Secure; SameSite=Lax; Path=/",
        },
        status: 200,
      });
      return true;
    }
    if (path === "/v1/account/sign-in-methods/google:start" && request.method() === "POST") {
      await startGoogle(route, hooks, "link");
      return true;
    }
    if (path === "/v1/auth/reauthenticate/google/start" && request.method() === "POST") {
      await startGoogle(route, hooks, "reauthenticate");
      return true;
    }
    if (
      (path === "/v1/account/sign-in-methods/google:continue" ||
        path === "/v1/auth/reauthenticate/google/continue") &&
      request.method() === "GET"
    ) {
      await continueGoogle(route, hooks);
      return true;
    }
    if (
      (path === "/v1/account/sign-in-methods/google:callback" ||
        path === "/v1/auth/reauthenticate/google/callback") &&
      request.method() === "GET"
    ) {
      await callbackGoogle(route, hooks);
      return true;
    }
    if (path === "/v1/account/sign-in-methods/password" && request.method() === "POST") {
      const parsed = passwordLinkRequestSchema.safeParse(cloudRequestBody(request));
      if (!parsed.success || googleFlow !== "recent" || !hooks.mutationProof(request)) {
        await hooks.reject(route, 403, "forbidden");
        return true;
      }
      if (seed === "stale-password-sign-in-methods") {
        methods = ["password", "google"];
        await hooks.reject(route, 409, "sign_in_method_already_linked", "write-valid");
        return true;
      }
      methods = ["password", "google"];
      hooks.record(request, "write-valid");
      await route.fulfill({
        body: JSON.stringify(response()),
        contentType: "application/json; charset=utf-8",
        headers: {
          ...(cloudCors(request.headers().origin) ?? {}),
          "set-cookie":
            "huayi_session=cloud-e2e-linked-web-session; HttpOnly; Secure; SameSite=Lax; Path=/",
        },
        status: 200,
      });
      return true;
    }
    return false;
  };

  return {
    csrfToken: () => refreshedCsrf,
    handleApi,
    async install(page: Page) {
      if (seed === null) return;
      await page.route(`${providerOrigin}/**`, async (route) => {
        const purpose = new URL(route.request().url()).searchParams.get("purpose");
        await route.fulfill({
          body: `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>测试 Google 账号</title><main><h1>测试 Google 账号</h1><form action="${apiOrigin}/${purpose === "link" ? "v1/account/sign-in-methods/google:callback" : "v1/auth/reauthenticate/google/callback"}" method="get"><input name="purpose" type="hidden" value="${purpose ?? ""}"><button type="submit">以测试账号继续</button></form></main></html>`,
          contentType: "text/html; charset=utf-8",
          status: 200,
        });
      });
    },
  };
}
