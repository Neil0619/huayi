import {
  apiErrorSchema,
  createWordbookJobRequestSchema,
  externalWordbookHttpRoutes,
  idempotencyKeySchema,
  listWordbookJobsQuerySchema,
  resourceIdSchema,
  submitWordbookReceiptsRequestSchema,
  wordbookJobListResponseSchema,
  wordbookLeaseRequestSchema,
  wordbookLeaseResponseSchema,
  wordbookJobResourceSchema,
  wordbookJobRevisionHeadersSchema,
  wordbookJobRevisionRequestSchema,
  wordbookJobWriteHeadersSchema,
  wordbookReceiptResponseSchema,
  type ListWordbookJobsQuery,
  type CreateWordbookJobRequest,
  type SubmitWordbookReceiptsRequest,
  type WordbookLeaseRequest,
  type WordbookJobRevisionRequest,
} from "@huayi/cloud-contracts";

import { extensionSessionHeaders } from "../cloud/extension-session-headers.js";

export type CloudWordbookFailureKind = "authentication" | "permanent" | "transient";

export class CloudWordbookApiError extends Error {
  constructor(
    readonly kind: CloudWordbookFailureKind,
    readonly code: string,
  ) {
    super(`Huayi external wordbook request failed: ${kind}.`);
    this.name = "CloudWordbookApiError";
  }
}

export function shouldRetryCloudWordbookRequest(error: unknown): boolean {
  return (
    error instanceof CloudWordbookApiError &&
    (error.kind === "transient" || error.code === "wordbook_job_leased")
  );
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

function path(route: string, jobId: string): string {
  return route.replace(":id", encodeURIComponent(resourceIdSchema.parse(jobId)));
}

function sessionHeaders(sessionToken: string, clientVersion: string) {
  try {
    return extensionSessionHeaders(sessionToken, clientVersion);
  } catch {
    throw new CloudWordbookApiError("authentication", "authentication_required");
  }
}

export function createCloudWordbookApi(options: {
  readonly apiOrigin: string;
  readonly clientVersion: string;
  readonly fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
}) {
  const origin = fixedOrigin(options.apiOrigin);
  const request = async (route: string, init: RequestInit): Promise<Response> => {
    let response: Response;
    try {
      response = await options.fetch(new URL(route, origin), { credentials: "omit", ...init });
    } catch {
      throw new CloudWordbookApiError("transient", "network_error");
    }
    if (response.ok) return response;
    const parsed = apiErrorSchema.safeParse(await response.json().catch(() => undefined));
    const code = parsed.success ? parsed.data.error.code : "unknown";
    if (response.status === 401 || response.status === 403) {
      throw new CloudWordbookApiError("authentication", code);
    }
    if ([408, 425, 429].includes(response.status) || response.status >= 500) {
      throw new CloudWordbookApiError("transient", code);
    }
    throw new CloudWordbookApiError("permanent", code);
  };
  return {
    async create(input: CreateWordbookJobRequest, key: string, sessionToken: string) {
      const response = await request(externalWordbookHttpRoutes.create, {
        body: JSON.stringify(createWordbookJobRequestSchema.parse(input)),
        headers: {
          ...sessionHeaders(sessionToken, options.clientVersion),
          "Content-Type": "application/json",
          ...wordbookJobWriteHeadersSchema.parse({ "idempotency-key": key }),
        },
        method: "POST",
      });
      try {
        return wordbookJobResourceSchema.parse(await response.json());
      } catch {
        throw new CloudWordbookApiError("transient", "invalid_response");
      }
    },
    async lease(jobId: string, input: WordbookLeaseRequest, sessionToken: string) {
      const response = await request(path(externalWordbookHttpRoutes.lease, jobId), {
        body: JSON.stringify(wordbookLeaseRequestSchema.parse(input)),
        headers: {
          ...sessionHeaders(sessionToken, options.clientVersion),
          "Content-Type": "application/json",
        },
        method: "POST",
      });
      try {
        return wordbookLeaseResponseSchema.parse(await response.json());
      } catch {
        throw new CloudWordbookApiError("transient", "invalid_response");
      }
    },
    async list(input: ListWordbookJobsQuery, sessionToken: string) {
      const query = listWordbookJobsQuerySchema.parse(input);
      const search = new URLSearchParams();
      if (query.direction !== undefined) search.set("direction", query.direction);
      if (query.state !== undefined) search.set("state", query.state);
      if (query.target !== undefined) search.set("target", query.target);
      if (query.limit !== undefined) search.set("limit", String(query.limit));
      if (query.cursor !== undefined) search.set("cursor", query.cursor);
      const suffix = search.size === 0 ? "" : `?${search.toString()}`;
      const response = await request(`${externalWordbookHttpRoutes.list}${suffix}`, {
        headers: sessionHeaders(sessionToken, options.clientVersion),
      });
      try {
        return wordbookJobListResponseSchema.parse(await response.json());
      } catch {
        throw new CloudWordbookApiError("transient", "invalid_response");
      }
    },
    async submit(
      jobId: string,
      input: SubmitWordbookReceiptsRequest,
      idempotencyKey: string,
      sessionToken: string,
    ) {
      const response = await request(path(externalWordbookHttpRoutes.receipts, jobId), {
        body: JSON.stringify(submitWordbookReceiptsRequestSchema.parse(input)),
        headers: {
          ...sessionHeaders(sessionToken, options.clientVersion),
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKeySchema.parse(idempotencyKey),
        },
        method: "POST",
      });
      try {
        return wordbookReceiptResponseSchema.parse(await response.json());
      } catch {
        throw new CloudWordbookApiError("transient", "invalid_response");
      }
    },
    async update(
      action: "cancel" | "retry",
      jobId: string,
      input: WordbookJobRevisionRequest,
      idempotencyKey: string,
      sessionToken: string,
    ) {
      const parsed = wordbookJobRevisionRequestSchema.parse(input);
      const headers = wordbookJobRevisionHeadersSchema.parse({
        "idempotency-key": idempotencyKey,
        "if-match": `"${parsed.expectedRevision}"`,
      });
      const response = await request(path(externalWordbookHttpRoutes[action], jobId), {
        body: JSON.stringify(parsed),
        headers: {
          ...sessionHeaders(sessionToken, options.clientVersion),
          "Content-Type": "application/json",
          ...headers,
        },
        method: "POST",
      });
      try {
        return wordbookJobResourceSchema.parse(await response.json());
      } catch {
        throw new CloudWordbookApiError("transient", "invalid_response");
      }
    },
  };
}

export type CloudWordbookApi = ReturnType<typeof createCloudWordbookApi>;
