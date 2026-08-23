import type { Page, Request, Route } from "@playwright/test";
import {
  claimInvitationRequestSchema,
  claimInvitationResponseSchema,
  type ApiError,
} from "@huayi/cloud-contracts";

import type { CloudBrowserRequestFact } from "./cloud-browser-authority-types.js";

const apiOrigin = "https://api.huayi.invalid";
const providerOrigin = "https://accounts.google.invalid";
const webOrigin = "https://web.huayi.invalid";
const invitationToken = "i".repeat(32);
const claimTicket = "c".repeat(32);
const flowId = "cloud-e2e-google-flow";
const providerCode = "cloud-e2e-google-code";

interface Hooks {
  json(route: Route, status: number, body: unknown): Promise<void>;
  record(request: Request, proof: CloudBrowserRequestFact["proof"]): void;
  reject(route: Route, status: number, code: ApiError["error"]["code"]): Promise<void>;
}

function jsonBody(request: Request): unknown {
  try {
    const raw = request.postData();
    return raw === null ? undefined : (JSON.parse(raw) as unknown);
  } catch {
    return undefined;
  }
}

function exactQuery(url: URL, expected: Record<string, string>): boolean {
  const entries = [...url.searchParams.entries()];
  return (
    entries.length === Object.keys(expected).length &&
    entries.every(([key, value]) => expected[key] === value)
  );
}

export function createCloudBrowserOnboardingAuthority() {
  let invitation: "available" | "claimed" | "consumed" = "available";
  let flow: "created" | "consumed" | null = null;

  const handleClaim = async (route: Route, hooks: Hooks) => {
    const request = route.request();
    const parsed = claimInvitationRequestSchema.safeParse(jsonBody(request));
    if (
      !parsed.success ||
      parsed.data.invitationToken !== invitationToken ||
      request.headers().referer !== undefined
    ) {
      return hooks.reject(route, 400, "invalid_request");
    }
    if (invitation !== "available") return hooks.reject(route, 409, "invitation_consumed");
    invitation = "claimed";
    hooks.record(request, "write-valid");
    await hooks.json(
      route,
      200,
      claimInvitationResponseSchema.parse({
        claimTicket,
        expiresAt: "2026-08-13T10:10:00.000Z",
      }),
    );
  };

  const handleGoogleStart = async (route: Route, hooks: Hooks) => {
    const request = route.request();
    const contentType = request.headers()["content-type"]?.split(";", 1)[0]?.trim();
    const entries = [...new URLSearchParams(request.postData() ?? "").entries()];
    if (
      invitation !== "claimed" ||
      contentType !== "application/x-www-form-urlencoded" ||
      entries.length !== 1 ||
      entries[0]?.[0] !== "claimTicket" ||
      entries[0]?.[1] !== claimTicket
    ) {
      return hooks.reject(route, 400, "invalid_request");
    }
    flow = "created";
    hooks.record(request, "write-valid");
    await route.fulfill({
      headers: { location: `${providerOrigin}/consent?flow=${encodeURIComponent(flowId)}` },
      status: 302,
    });
  };

  const handleCallback = async (route: Route, hooks: Hooks) => {
    const request = route.request();
    const valid = exactQuery(new URL(request.url()), { code: providerCode, flow: flowId });
    if (flow !== "created" || invitation !== "claimed" || !valid) {
      return hooks.reject(route, 404, "not_found");
    }
    flow = "consumed";
    invitation = "consumed";
    hooks.record(request, "write-valid");
    await route.fulfill({
      headers: {
        "cache-control": "private, no-store",
        location: `${webOrigin}/practice`,
        "set-cookie": "huayi_session=cloud-e2e-web-session; HttpOnly; Secure; SameSite=Lax; Path=/",
      },
      status: 302,
    });
  };

  const handleApi = async (route: Route, hooks: Hooks): Promise<boolean> => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (path === "/v1/invitations/claim" && request.method() === "POST") {
      await handleClaim(route, hooks);
      return true;
    }
    if (path === "/v1/auth/google/start" && request.method() === "POST") {
      await handleGoogleStart(route, hooks);
      return true;
    }
    if (path === "/v1/auth/callback" && request.method() === "GET") {
      await handleCallback(route, hooks);
      return true;
    }
    return false;
  };

  const serveProvider = async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (
      request.method() !== "GET" ||
      url.pathname !== "/consent" ||
      flow !== "created" ||
      !exactQuery(url, { flow: flowId })
    ) {
      await route.fulfill({ body: "Not found", status: 404 });
      return;
    }
    await route.fulfill({
      body: `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>测试 Google 账号</title><main><h1>测试 Google 账号</h1><p>此页面只在离线浏览器验收中提供。</p><form action="${apiOrigin}/v1/auth/callback" method="get"><input name="flow" type="hidden" value="${flowId}"><input name="code" type="hidden" value="${providerCode}"><button type="submit">以测试账号继续</button></form></main></html>`,
      contentType: "text/html; charset=utf-8",
      status: 200,
    });
  };

  return {
    handleApi,
    async install(page: Page) {
      await page.route(`${providerOrigin}/**`, serveProvider);
    },
  };
}
