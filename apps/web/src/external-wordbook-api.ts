import {
  apiErrorSchema,
  createWordbookJobRequestSchema,
  externalWordbookHttpRoutes,
  listWordbookJobsQuerySchema,
  resourceIdSchema,
  wordbookJobListResponseSchema,
  wordbookJobResourceSchema,
  wordbookJobRevisionHeadersSchema,
  wordbookJobRevisionRequestSchema,
  wordbookJobWriteHeadersSchema,
  wordEntryHttpRoutes,
  wordListExportHeadersSchema,
  type ApiError,
  type CreateWordbookJobRequest,
  type ListWordbookJobsQuery,
  type WordbookJobRevisionRequest,
} from "@huayi/cloud-contracts";

export class WebExternalWordbookApiError extends Error {
  constructor(readonly code: ApiError["error"]["code"] | "unknown") {
    super("Huayi external wordbook request failed.");
  }
}

export function createWebExternalWordbookApi(options: {
  apiOrigin: string;
  csrfToken(): Promise<string>;
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}) {
  const success = async (response: Response): Promise<unknown> => {
    if (!response.ok) {
      const parsed = apiErrorSchema.safeParse(await response.json().catch(() => null));
      throw new WebExternalWordbookApiError(parsed.success ? parsed.data.error.code : "unknown");
    }
    return response.json() as Promise<unknown>;
  };
  const path = (route: string, jobId: string) =>
    route.replace(":id", encodeURIComponent(resourceIdSchema.parse(jobId)));
  const endpoint = (route: string, input: Record<string, unknown> = {}) => {
    const url = new URL(route, options.apiOrigin);
    for (const [key, value] of Object.entries(input)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    return url;
  };
  const revisionMutation = async (
    route: string,
    jobId: string,
    input: WordbookJobRevisionRequest,
    idempotencyKey: string,
  ) => {
    const request = wordbookJobRevisionRequestSchema.parse(input);
    const headers = wordbookJobRevisionHeadersSchema.parse({
      "idempotency-key": idempotencyKey,
      "if-match": `"${request.expectedRevision}"`,
    });
    return wordbookJobResourceSchema.parse(
      await success(
        await options.fetch(endpoint(path(route, jobId)), {
          body: JSON.stringify(request),
          credentials: "include",
          headers: {
            "content-type": "application/json",
            ...headers,
            "x-csrf-token": await options.csrfToken(),
          },
          method: "POST",
        }),
      ),
    );
  };
  return {
    cancelJob(jobId: string, input: WordbookJobRevisionRequest, key: string) {
      return revisionMutation(externalWordbookHttpRoutes.cancel, jobId, input, key);
    },
    async createJob(input: CreateWordbookJobRequest, key: string) {
      const request = createWordbookJobRequestSchema.parse(input);
      const headers = wordbookJobWriteHeadersSchema.parse({ "idempotency-key": key });
      return wordbookJobResourceSchema.parse(
        await success(
          await options.fetch(endpoint(externalWordbookHttpRoutes.create), {
            body: JSON.stringify(request),
            credentials: "include",
            headers: {
              "content-type": "application/json",
              ...headers,
              "x-csrf-token": await options.csrfToken(),
            },
            method: "POST",
          }),
        ),
      );
    },
    async getJob(jobId: string) {
      return wordbookJobResourceSchema.parse(
        await success(
          await options.fetch(endpoint(path(externalWordbookHttpRoutes.detail, jobId)), {
            credentials: "include",
          }),
        ),
      );
    },
    async downloadWords() {
      const response = await options.fetch(endpoint(wordEntryHttpRoutes.export), {
        credentials: "include",
      });
      if (!response.ok) {
        const parsed = apiErrorSchema.safeParse(await response.json().catch(() => null));
        throw new WebExternalWordbookApiError(parsed.success ? parsed.data.error.code : "unknown");
      }
      wordListExportHeadersSchema.parse({
        "content-disposition": response.headers.get("content-disposition"),
        "content-type": response.headers.get("content-type"),
      });
      const blob = await response.blob();
      if (blob.size > 5 * 1024 * 1024) throw new WebExternalWordbookApiError("unknown");
      return { blob, filename: "huayi-words.txt" as const };
    },
    async listJobs(input: ListWordbookJobsQuery) {
      const request = listWordbookJobsQuerySchema.parse(input);
      return wordbookJobListResponseSchema.parse(
        await success(
          await options.fetch(endpoint(externalWordbookHttpRoutes.list, request), {
            credentials: "include",
          }),
        ),
      );
    },
    retryJob(jobId: string, input: WordbookJobRevisionRequest, key: string) {
      return revisionMutation(externalWordbookHttpRoutes.retry, jobId, input, key);
    },
  };
}

export type WebExternalWordbookApi = ReturnType<typeof createWebExternalWordbookApi>;
