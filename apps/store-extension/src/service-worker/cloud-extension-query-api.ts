import {
  apiErrorSchema,
  extensionQueryEventSchema,
  extensionQueryHttpRoutes,
  extensionQueryRequestSchema,
  idempotencyKeySchema,
  type ExtensionQueryEvent,
  type ExtensionQueryRequest,
} from "@huayi/cloud-contracts";

import { extensionSessionHeaders } from "../cloud/extension-session-headers.js";

export type CloudExtensionQueryFailure =
  | "authentication"
  | "client-upgrade-required"
  | "invalid-response"
  | "permanent"
  | "quota-exhausted"
  | "transient";

export class CloudExtensionQueryError extends Error {
  constructor(readonly kind: CloudExtensionQueryFailure) {
    super(`Huayi ExtensionQuery request failed: ${kind}.`);
    this.name = "CloudExtensionQueryError";
  }
}

interface Options {
  readonly apiOrigin: string;
  readonly clientVersion: string;
  readonly fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
}

function strictOrigin(value: string): URL {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new TypeError("Huayi API origin is invalid.");
  }
  return url;
}

async function failure(response: Response): Promise<CloudExtensionQueryError> {
  if (response.status === 401 || response.status === 403) {
    return new CloudExtensionQueryError("authentication");
  }
  if (response.status === 426) return new CloudExtensionQueryError("client-upgrade-required");
  const parsed = apiErrorSchema.safeParse(await response.json().catch(() => undefined));
  if (parsed.success && parsed.data.error.code === "quota_exhausted") {
    return new CloudExtensionQueryError("quota-exhausted");
  }
  if ([408, 425, 429].includes(response.status) || response.status >= 500) {
    return new CloudExtensionQueryError("transient");
  }
  return new CloudExtensionQueryError("permanent");
}

async function* decode(response: Response): AsyncIterable<ExtensionQueryEvent> {
  if (
    response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !==
      "text/event-stream" ||
    response.body === null
  ) {
    throw new CloudExtensionQueryError("invalid-response");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let buffer = "";
  let total = 0;
  let expectedId = 1;
  let finished = false;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      total += chunk.value.byteLength;
      if (total > 2 * 1_024 * 1_024) throw new Error("ExtensionQuery stream exceeded its limit.");
      let boundary = buffer.indexOf("\n\n");
      while (boundary >= 0) {
        const envelope = buffer.slice(0, boundary).replaceAll("\r\n", "\n");
        buffer = buffer.slice(boundary + 2);
        const fields = new Map<string, string>();
        for (const line of envelope.split("\n")) {
          const separator = line.indexOf(":");
          if (separator < 0) throw new Error("Invalid ExtensionQuery event stream.");
          const name = line.slice(0, separator);
          const value = line.slice(separator + 1).replace(/^ /u, "");
          if (!["data", "event", "id"].includes(name) || fields.has(name)) {
            throw new Error("Invalid ExtensionQuery event stream.");
          }
          fields.set(name, value);
        }
        if (fields.size !== 3 || fields.get("event") !== "query") {
          throw new Error("Invalid ExtensionQuery event stream.");
        }
        if (fields.get("id") !== String(expectedId)) {
          throw new Error("Invalid ExtensionQuery event stream.");
        }
        expectedId += 1;
        yield extensionQueryEventSchema.parse(JSON.parse(fields.get("data") ?? "") as unknown);
        boundary = buffer.indexOf("\n\n");
      }
    }
    buffer += decoder.decode();
    if (buffer !== "") throw new Error("Incomplete ExtensionQuery event stream.");
    finished = true;
  } catch (error) {
    if (error instanceof CloudExtensionQueryError) throw error;
    throw error;
  } finally {
    if (!finished) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

export function createCloudExtensionQueryApi(options: Options) {
  const origin = strictOrigin(options.apiOrigin);
  return {
    async *start(
      input: ExtensionQueryRequest,
      idempotencyKey: string,
      sessionToken: string,
      signal?: AbortSignal,
    ): AsyncIterable<ExtensionQueryEvent> {
      let response: Response;
      try {
        response = await options.fetch(new URL(extensionQueryHttpRoutes.start, origin), {
          body: JSON.stringify(extensionQueryRequestSchema.parse(input)),
          credentials: "omit",
          headers: {
            ...extensionSessionHeaders(sessionToken, options.clientVersion),
            Accept: "text/event-stream",
            "Content-Type": "application/json",
            "Idempotency-Key": idempotencyKeySchema.parse(idempotencyKey),
          },
          method: "POST",
          ...(signal === undefined ? {} : { signal }),
        });
      } catch (error) {
        if (error instanceof TypeError) throw error;
        throw new CloudExtensionQueryError("transient");
      }
      if (!response.ok) throw await failure(response);
      yield* decode(response);
    },
  };
}

export type CloudExtensionQueryApi = ReturnType<typeof createCloudExtensionQueryApi>;
