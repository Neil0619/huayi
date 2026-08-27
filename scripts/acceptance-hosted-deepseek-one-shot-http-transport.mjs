import { randomUUID } from "node:crypto";

import {
  adminAccessResponseSchema,
  adminKillSwitchResourceSchema,
  passwordLoginRequestSchema,
  passwordLoginResponseSchema,
  passwordReauthenticationRequestSchema,
  passwordReauthenticationResponseSchema,
  setAdminKillSwitchRequestSchema,
  startAnalysisRequestSchema,
} from "../packages/cloud-contracts/dist/index.js";

import { hostedDeepSeekAnalysisRequestBody } from "./acceptance-hosted-deepseek-one-shot-analysis-request.mjs";
import {
  consumeAnalysisStream,
  failedClosed,
  hasExactKeys,
  materialIsValid,
  parseJsonResponse,
  readCompletedAnalysisStatus,
  requireControl,
  responseClearsSession,
  sessionCookieFromResponse,
} from "./acceptance-hosted-deepseek-one-shot-http-support.mjs";

const apiOrigin = "https://api.acceptance.seen-said.cn";
const webOrigin = "https://app.acceptance.seen-said.cn";
const routes = Object.freeze({
  analysis: "/v1/analyses:stream",
  analysisStatus: "/v1/analysis-requests/:requestId",
  killSwitch: "/v1/admin/runtime/model-kill-switch",
  login: "/v1/auth/password/login",
  logout: "/v1/auth/logout",
  operator: "/v1/admin/access",
  reauthenticate: "/v1/auth/reauthenticate/password",
});
const optionKeys = Object.freeze(["credentials", "fetch_", "randomUuid", "readNowMilliseconds"]);
const applicationRequestKeys = Object.freeze([
  "body",
  "deployments",
  "idempotencyKey",
  "operationId",
  "origin",
  "ownerId",
  "path",
]);
const idempotencyKeyPattern = /^[A-Za-z0-9._:-]{8,128}$/u;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

function isoTimestamp(readNowMilliseconds) {
  const now = readNowMilliseconds();
  if (!Number.isSafeInteger(now) || now < 0) throw failedClosed();
  try {
    return new Date(now).toISOString();
  } catch {
    throw failedClosed();
  }
}

function partialSessionMaterial(response) {
  const cookie = sessionCookieFromResponse(response);
  return cookie === undefined ? undefined : Object.freeze({ cookie, csrfToken: undefined });
}

function sessionHeaders(
  material,
  { accept, contentType, csrf = false, idempotencyKey, origin = false } = {},
) {
  if (!materialIsValid(material)) throw failedClosed();
  return {
    ...(accept === undefined ? {} : { Accept: accept }),
    Cookie: material.cookie,
    ...(contentType === undefined ? {} : { "Content-Type": contentType }),
    ...(idempotencyKey === undefined ? {} : { "Idempotency-Key": idempotencyKey }),
    ...(origin ? { Origin: webOrigin } : {}),
    ...(!csrf || material.csrfToken === undefined ? {} : { "X-CSRF-Token": material.csrfToken }),
  };
}

function applicationRequestIsValid(request) {
  if (
    !hasExactKeys(request, applicationRequestKeys) ||
    request.origin !== webOrigin ||
    request.path !== routes.analysis ||
    typeof request.idempotencyKey !== "string" ||
    !idempotencyKeyPattern.test(request.idempotencyKey)
  ) {
    return false;
  }
  try {
    const parsed = startAnalysisRequestSchema.parse(request.body);
    return JSON.stringify(parsed) === JSON.stringify(hostedDeepSeekAnalysisRequestBody);
  } catch {
    return false;
  }
}

export function createHostedDeepSeekNormalWebHttpTransport(options = {}) {
  try {
    if (
      !hasExactKeys(
        options,
        optionKeys.filter((key) => options[key] !== undefined),
      )
    ) {
      throw failedClosed();
    }
    const loginInput = passwordLoginRequestSchema.parse({
      email: options.credentials?.email,
      password: options.credentials?.password,
    });
    const fetch_ = options.fetch_ ?? globalThis.fetch;
    const randomUuid = options.randomUuid ?? randomUUID;
    const readNowMilliseconds = options.readNowMilliseconds ?? Date.now;
    if (
      typeof fetch_ !== "function" ||
      typeof randomUuid !== "function" ||
      typeof readNowMilliseconds !== "function"
    ) {
      throw failedClosed();
    }
    let reauthenticatedAt;

    const fetchFixed = async (path, init, control) => {
      const signal = requireControl(control, readNowMilliseconds);
      try {
        return await fetch_(new URL(path, apiOrigin), {
          ...init,
          credentials: "include",
          redirect: "error",
          referrerPolicy: "no-referrer",
          signal,
        });
      } catch {
        throw failedClosed();
      }
    };

    const readSessionResponse = async (response, schema, allowRejectedReplacement) => {
      const partial = partialSessionMaterial(response);
      if (!response.ok) {
        if (allowRejectedReplacement && partial !== undefined) return partial;
        throw failedClosed();
      }
      try {
        const parsed = await parseJsonResponse(response, schema);
        if (partial === undefined) throw failedClosed();
        return Object.freeze({ cookie: partial.cookie, csrfToken: parsed.csrfToken });
      } catch {
        if (partial !== undefined) return partial;
        throw failedClosed();
      }
    };

    return Object.freeze({
      async invokeCloudWebAnalysis(material, request, control) {
        try {
          if (!applicationRequestIsValid(request) || !materialIsValid(material)) {
            throw failedClosed();
          }
          const response = await fetchFixed(
            routes.analysis,
            {
              body: JSON.stringify(hostedDeepSeekAnalysisRequestBody),
              headers: sessionHeaders(material, {
                accept: "text/event-stream",
                contentType: "application/json",
                csrf: true,
                idempotencyKey: request.idempotencyKey,
                origin: true,
              }),
              method: "POST",
            },
            control,
          );
          const stream = await consumeAnalysisStream(response);
          if (!uuidPattern.test(stream.requestId)) throw failedClosed();
          if (stream.statusReadRequired) {
            const statusPath = routes.analysisStatus.replace(
              ":requestId",
              encodeURIComponent(stream.requestId),
            );
            const statusResponse = await fetchFixed(
              statusPath,
              {
                headers: sessionHeaders(material, { accept: "application/json" }),
                method: "GET",
              },
              control,
            );
            await readCompletedAnalysisStatus(statusResponse, stream.requestId);
          }
          return Object.freeze({ requestId: stream.requestId, type: "analysis.started" });
        } catch {
          throw failedClosed();
        }
      },
      async loginPassword(control) {
        try {
          const response = await fetchFixed(
            routes.login,
            {
              body: JSON.stringify(loginInput),
              headers: {
                Accept: "application/json",
                "Content-Type": "application/json",
                Origin: webOrigin,
              },
              method: "POST",
            },
            control,
          );
          return await readSessionResponse(response, passwordLoginResponseSchema, false);
        } catch {
          throw failedClosed();
        }
      },
      async logout(material, control) {
        try {
          const response = await fetchFixed(
            routes.logout,
            {
              headers: sessionHeaders(material, { csrf: true, origin: true }),
              method: "POST",
            },
            control,
          );
          if (response.status !== 204 || !responseClearsSession(response)) throw failedClosed();
        } catch {
          throw failedClosed();
        }
      },
      async readOperatorAuthorization(material, control) {
        try {
          if (reauthenticatedAt === undefined) throw failedClosed();
          const response = await fetchFixed(
            routes.operator,
            {
              headers: sessionHeaders(material, { accept: "application/json" }),
              method: "GET",
            },
            control,
          );
          const access = await parseJsonResponse(response, adminAccessResponseSchema);
          if (access.role !== "operator") throw failedClosed();
          return Object.freeze({
            access: "full",
            observedAt: isoTimestamp(readNowMilliseconds),
            operator: true,
            reauthenticatedAt,
          });
        } catch {
          throw failedClosed();
        }
      },
      async reauthenticatePassword(material, control) {
        try {
          if (!materialIsValid(material) || material.csrfToken === undefined) {
            throw failedClosed();
          }
          const input = passwordReauthenticationRequestSchema.parse({
            password: loginInput.password,
          });
          const response = await fetchFixed(
            routes.reauthenticate,
            {
              body: JSON.stringify(input),
              headers: sessionHeaders(material, {
                contentType: "application/json",
                csrf: true,
                origin: true,
              }),
              method: "POST",
            },
            control,
          );
          const replacement = await readSessionResponse(
            response,
            passwordReauthenticationResponseSchema,
            true,
          );
          if (replacement.csrfToken !== undefined) {
            reauthenticatedAt = isoTimestamp(readNowMilliseconds);
          }
          return replacement;
        } catch {
          throw failedClosed();
        }
      },
      async reconcileDispatchedRequest() {
        throw failedClosed();
      },
      async setModelKillSwitch(material, enabled, control) {
        try {
          if (!materialIsValid(material) || material.csrfToken === undefined) {
            throw failedClosed();
          }
          const body = setAdminKillSwitchRequestSchema.parse({ enabled });
          const idempotencyKey = randomUuid();
          if (typeof idempotencyKey !== "string" || !uuidPattern.test(idempotencyKey)) {
            throw failedClosed();
          }
          const response = await fetchFixed(
            routes.killSwitch,
            {
              body: JSON.stringify(body),
              headers: sessionHeaders(material, {
                accept: "application/json",
                contentType: "application/json",
                csrf: true,
                idempotencyKey,
                origin: true,
              }),
              method: "PUT",
            },
            control,
          );
          const result = await parseJsonResponse(response, adminKillSwitchResourceSchema);
          if (result.enabled !== enabled) throw failedClosed();
          return result;
        } catch {
          throw failedClosed();
        }
      },
    });
  } catch {
    throw failedClosed();
  }
}
