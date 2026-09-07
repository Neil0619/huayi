import type { Request, Route } from "@playwright/test";
import {
  passwordSignupStartRequestSchema,
  passwordSignupVerifyRequestSchema,
  passwordSignupCompleteRequestSchema,
  passwordSignupResendRequestSchema,
  type ApiError,
} from "@huayi/cloud-contracts";

import { cloudCors, cloudErrorBody, cloudRequestBody } from "./cloud-browser-authority-request.js";
import type { CloudBrowserRequestFact } from "./cloud-browser-authority-types.js";

const browser = `${"f".repeat(43)}.${"b".repeat(43)}`;
const csrf = "s".repeat(43);
const base = "/v1/auth/password/signup";
const webOrigin = "https://web.huayi.invalid";
interface Hooks {
  record(request: Request, proof: CloudBrowserRequestFact["proof"]): void;
  reject(
    route: Route,
    status: number,
    code: ApiError["error"]["code"],
    proof?: CloudBrowserRequestFact["proof"],
  ): Promise<void>;
}

export function createCloudBrowserPasswordSignupAuthority(options: {
  email: string;
  password: string;
  claimTicket: string;
  isClaimed: () => boolean;
  onStarted: () => void;
  onCompleted: () => void;
}) {
  let step: "none" | "verify-email" | "set-password" | "complete" = "none";
  let token = "123456";
  const session = () => ({ email: options.email, step, csrfToken: csrf });
  return async (route: Route, hooks: Hooks) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (!path.startsWith(`${base}/`)) return false;
    const respond = async (status: number, body: unknown, cookie?: string) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(body),
        headers: {
          ...(cloudCors(request.headers().origin) ?? {}),
          "cache-control": "private, no-store",
          ...(cookie ? { "set-cookie": cookie } : {}),
        },
      });
    if (request.headers().origin !== webOrigin) {
      await hooks.reject(route, 403, "forbidden");
      return true;
    }
    if (path === `${base}/start` && request.method() === "POST") {
      const input = passwordSignupStartRequestSchema.safeParse(cloudRequestBody(request));
      if (
        !input.success ||
        !options.isClaimed() ||
        step !== "none" ||
        input.data.claimTicket !== options.claimTicket ||
        input.data.email !== options.email
      ) {
        await hooks.reject(route, 400, "invalid_request");
        return true;
      }
      step = "verify-email";
      options.onStarted();
      hooks.record(request, "write-valid");
      await respond(
        202,
        session(),
        `huayi_signup=${browser}; HttpOnly; Secure; SameSite=Lax; Path=${base}; Max-Age=86400`,
      );
      return true;
    }
    if (
      !request.headers().cookie?.includes(`huayi_signup=${browser}`) ||
      step === "none" ||
      step === "complete"
    ) {
      await hooks.reject(route, 401, "authentication_required");
      return true;
    }
    if (path === `${base}/session` && request.method() === "GET") {
      hooks.record(request, "read");
      await respond(200, session());
      return true;
    }
    if (request.method() !== "POST" || request.headers()["x-csrf-token"] !== csrf) {
      await hooks.reject(route, 403, "forbidden");
      return true;
    }
    if (path === `${base}/verify`) {
      const input = passwordSignupVerifyRequestSchema.safeParse(cloudRequestBody(request));
      if (!input.success || step !== "verify-email") {
        await hooks.reject(route, 400, "invalid_request");
        return true;
      }
      hooks.record(request, "write-valid");
      if (input.data.token !== token) {
        await respond(401, cloudErrorBody("authentication_required"));
        return true;
      }
      step = "set-password";
      await respond(200, session());
      return true;
    }
    if (path === `${base}/resend`) {
      if (
        step !== "verify-email" ||
        !passwordSignupResendRequestSchema.safeParse(cloudRequestBody(request)).success
      ) {
        await hooks.reject(route, 400, "invalid_request");
        return true;
      }
      token = "654321";
      hooks.record(request, "write-valid");
      await respond(202, { accepted: true });
      return true;
    }
    if (path === `${base}/complete`) {
      const input = passwordSignupCompleteRequestSchema.safeParse(cloudRequestBody(request));
      if (!input.success || step !== "set-password" || input.data.password !== options.password) {
        await hooks.reject(route, 400, "invalid_request");
        return true;
      }
      step = "complete";
      options.onCompleted();
      hooks.record(request, "write-valid");
      await respond(
        200,
        { access: "full", csrfToken: csrf },
        "huayi_session=cloud-e2e-password-registration-session; HttpOnly; Secure; SameSite=Lax; Path=/",
      );
      return true;
    }
    await hooks.reject(route, 404, "not_found");
    return true;
  };
}
