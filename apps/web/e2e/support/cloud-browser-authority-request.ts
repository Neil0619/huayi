import type { Request } from "@playwright/test";
import { apiErrorSchema, type ApiError } from "@huayi/cloud-contracts";

const storeOrigin = "http://127.0.0.1:4173";
const webOrigin = "https://web.huayi.invalid";

export interface CloudStoredReplay {
  readonly hash: string;
  readonly response: unknown;
}

export function cloudCors(origin: string | undefined) {
  return origin === webOrigin || origin === storeOrigin
    ? {
        "access-control-allow-credentials": "true",
        "access-control-allow-headers":
          "authorization, content-type, idempotency-key, if-match, x-csrf-token, x-huayi-client-version",
        "access-control-allow-methods": "DELETE, GET, OPTIONS, PATCH, POST",
        "access-control-allow-origin": origin,
        vary: "Origin",
      }
    : null;
}

export function cloudRequestBody(request: Request): unknown {
  const raw = request.postData();
  if (raw === null) throw new TypeError("Cloud browser request body is missing.");
  return JSON.parse(raw) as unknown;
}

export function cloudQueryObject(url: URL): Record<string, string> {
  const entries = [...url.searchParams.entries()];
  if (new Set(entries.map(([key]) => key)).size !== entries.length) {
    throw new TypeError("Cloud browser query contains duplicate fields.");
  }
  return Object.fromEntries(entries);
}

export function cloudErrorBody(code: ApiError["error"]["code"]): ApiError {
  return apiErrorSchema.parse({
    error: { code, message: "Cloud browser request was rejected.", requestId: "e2e-request" },
  });
}
