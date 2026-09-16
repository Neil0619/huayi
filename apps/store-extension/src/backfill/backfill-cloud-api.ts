import {
  shanbayBackfillRoutes,
  shanbayBackfillCommandSchema,
  shanbayBackfillResponseSchema,
  shanbayBackfillStatusSchema,
  shanbayBackfillUnresolvedSchema,
  type ShanbayBackfillCommand,
} from "@huayi/cloud-contracts";
import { extensionSessionHeaders } from "../cloud/extension-session-headers.js";
import { BackfillError, type BackfillErrorCode } from "./backfill-errors.js";

export class BackfillCloudError extends BackfillError {
  constructor(
    readonly permanent: boolean,
    code: BackfillErrorCode,
  ) {
    super(code);
  }
}

function parseResponse<T>(schema: { parse(value: unknown): T }, value: unknown): T {
  try {
    return schema.parse(value);
  } catch {
    // A malformed response cannot prove whether the server accepted a command.
    throw new BackfillCloudError(false, "request-failed");
  }
}

export function createBackfillCloudApi(origin: string, version: string, fetcher = fetch) {
  const base = new URL(origin);
  if (base.protocol !== "https:" || base.origin + "/" !== base.href)
    throw new Error("Invalid API origin.");
  const request = async (
    route: string,
    token: string,
    body?: ShanbayBackfillCommand,
    key?: string,
  ) => {
    const response = await fetcher(new URL(route, base), {
      method: body ? "POST" : "GET",
      credentials: "omit",
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
      headers: {
        ...extensionSessionHeaders(token, version),
        ...(body
          ? { "Content-Type": "application/json", "Idempotency-Key": key ?? crypto.randomUUID() }
          : {}),
      },
      ...(body ? { body: JSON.stringify(shanbayBackfillCommandSchema.parse(body)) } : {}),
    }).catch(() => {
      throw new BackfillError("connection");
    });
    if (!response.ok)
      throw new BackfillCloudError(
        response.status >= 400 &&
          response.status < 500 &&
          ![408, 425, 429].includes(response.status),
        response.status === 404
          ? "unavailable"
          : response.status === 401 || response.status === 403
            ? "authentication"
            : "request-failed",
      );
    const text = await response.text().catch(() => {
      throw new BackfillError("connection");
    });
    if (text.length > 256_000) throw new BackfillCloudError(false, "request-failed");
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new BackfillCloudError(false, "request-failed");
    }
  };
  return {
    status: async (token: string) =>
      parseResponse(
        shanbayBackfillStatusSchema,
        await request(shanbayBackfillRoutes.status, token),
      ),
    command: async (token: string, key: string, command: ShanbayBackfillCommand) =>
      parseResponse(
        shanbayBackfillResponseSchema,
        await request(shanbayBackfillRoutes.command, token, command, key),
      ),
    unresolved: async (token: string, cursor?: string) =>
      parseResponse(
        shanbayBackfillUnresolvedSchema,
        await request(
          shanbayBackfillRoutes.unresolved +
            (cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""),
          token,
        ),
      ),
  };
}
