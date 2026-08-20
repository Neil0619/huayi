import {
  cloudWordCopyBatchRequestSchema,
  cloudWordCopyBatchResponseSchema,
  cloudWordCopyHttpRoutes,
  cloudWordCopyRequestSchema,
  cloudWordCopyResponseSchema,
  idempotencyKeySchema,
  type CloudWordCopyBatchRequest,
  type CloudWordCopyRequest,
} from "@huayi/cloud-contracts";

import { extensionSessionHeaders } from "../cloud/extension-session-headers.js";

export type CloudWordCopyFailureKind =
  "authentication" | "client-upgrade-required" | "permanent" | "transient";

export class CloudWordCopyError extends Error {
  constructor(readonly kind: CloudWordCopyFailureKind) {
    super(`Huayi CloudWordCopy request failed: ${kind}.`);
    this.name = "CloudWordCopyError";
  }
}

interface CloudWordCopyApiOptions {
  readonly apiOrigin: string;
  readonly clientVersion: string;
  readonly fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
}

function fixedOrigin(value: string): URL {
  const parsed = new URL(value);
  if (
    parsed.protocol !== "https:" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.pathname !== "/" ||
    parsed.search !== "" ||
    parsed.hash !== ""
  ) {
    throw new TypeError("Huayi API origin is invalid.");
  }
  return parsed;
}

export function createCloudWordCopyApi(options: CloudWordCopyApiOptions) {
  const origin = fixedOrigin(options.apiOrigin);
  const execute = async (route: string, content: unknown, key: string, sessionToken: string) => {
    let headers: Record<string, string>;
    try {
      headers = extensionSessionHeaders(sessionToken, options.clientVersion);
    } catch {
      throw new CloudWordCopyError("authentication");
    }
    let response: Response;
    try {
      response = await options.fetch(new URL(route, origin), {
        body: JSON.stringify(content),
        credentials: "omit",
        headers: {
          ...headers,
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKeySchema.parse(key),
        },
        method: "POST",
      });
    } catch (error) {
      if (error instanceof CloudWordCopyError) throw error;
      throw new CloudWordCopyError("transient");
    }
    if (response.status === 401 || response.status === 403) {
      throw new CloudWordCopyError("authentication");
    }
    if (response.status === 426) throw new CloudWordCopyError("client-upgrade-required");
    if ([408, 425, 429].includes(response.status) || response.status >= 500) {
      throw new CloudWordCopyError("transient");
    }
    if (!response.ok) throw new CloudWordCopyError("permanent");
    return response;
  };
  return {
    async copy(input: CloudWordCopyRequest, key: string, sessionToken: string) {
      const content = cloudWordCopyRequestSchema.parse(input);
      const response = await execute(cloudWordCopyHttpRoutes.copy, content, key, sessionToken);
      try {
        return cloudWordCopyResponseSchema.parse(await response.json());
      } catch {
        throw new CloudWordCopyError("transient");
      }
    },
    async importLocal(input: CloudWordCopyBatchRequest, key: string, sessionToken: string) {
      const content = cloudWordCopyBatchRequestSchema.parse(input);
      const response = await execute(
        cloudWordCopyHttpRoutes.importLocal,
        content,
        key,
        sessionToken,
      );
      try {
        return cloudWordCopyBatchResponseSchema.parse(await response.json());
      } catch {
        throw new CloudWordCopyError("transient");
      }
    },
  };
}

export type CloudWordCopyApi = ReturnType<typeof createCloudWordCopyApi>;
