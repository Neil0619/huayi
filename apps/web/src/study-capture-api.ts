import { createWebLearningTasks } from "./learning-task-api.js";
import {
  apiErrorSchema,
  studyCaptureCreateRequestSchema,
  studyCaptureCreateResponseSchema,
  analysisHttpRoutes,
  analysisRequestStatusSchema,
  createAnalysisSseDecoder,
  revisionWriteHeadersSchema,
  studyCaptureDeleteRequestSchema,
  studyCaptureDeleteResponseSchema,
  studyCaptureDetailResponseSchema,
  studyCaptureAnalyzeRequestSchema,
  studyCaptureHttpRoutes,
  studyCaptureListQuerySchema,
  studyCaptureListResponseSchema,
  studyCapturePatchRequestSchema,
  studyCapturePatchResponseSchema,
  type ApiError,
  type AnalysisEvent,
  type StudyCaptureListQuery,
} from "@huayi/cloud-contracts";

export class WebStudyCaptureApiError extends Error {
  constructor(readonly code: ApiError["error"]["code"] | "unknown") {
    super(`StudyCapture request failed: ${code}.`);
    this.name = "WebStudyCaptureApiError";
  }
}

interface Options {
  readonly apiOrigin: string;
  readonly csrfToken: () => Promise<string>;
  readonly fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
}

function path(route: string, id: string) {
  if (!/^[A-Za-z0-9_-]{1,128}$/u.test(id)) throw new TypeError("StudyCapture ID is invalid.");
  return route.replace(":id", encodeURIComponent(id));
}

export function createWebStudyCaptureApi(options: Options) {
  const execute = async (url: URL, init: RequestInit) => {
    const response = await options.fetch(url, init);
    if (response.ok) return response.json() as Promise<unknown>;
    const parsed = apiErrorSchema.safeParse(await response.json().catch(() => undefined));
    throw new WebStudyCaptureApiError(parsed.success ? parsed.data.error.code : "unknown");
  };
  const mutation = async (
    route: string,
    id: string,
    input: { expectedRevision: number },
    idempotencyKey: string,
    method: "DELETE" | "PATCH",
  ) => {
    const csrf = await options.csrfToken();
    const headers = revisionWriteHeadersSchema.parse({
      "idempotency-key": idempotencyKey,
      "if-match": `"${input.expectedRevision}"`,
    });
    return execute(new URL(path(route, id), options.apiOrigin), {
      body: JSON.stringify(input),
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": headers["idempotency-key"],
        "If-Match": headers["if-match"],
        "X-CSRF-Token": csrf,
      },
      method,
    });
  };
  return {
    tasks: createWebLearningTasks(options),
    async createCapture(
      input: ReturnType<typeof studyCaptureCreateRequestSchema.parse>,
      key: string,
    ) {
      return studyCaptureCreateResponseSchema.parse(
        await execute(new URL("/v2/study-captures", options.apiOrigin), {
          method: "POST",
          credentials: "include",
          body: JSON.stringify(studyCaptureCreateRequestSchema.parse(input)),
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": key,
            "X-CSRF-Token": await options.csrfToken(),
          },
        }),
      );
    },
    async *analyzeCapture(
      id: string,
      input: ReturnType<typeof studyCaptureAnalyzeRequestSchema.parse>,
      idempotencyKey: string,
      signal?: AbortSignal,
    ): AsyncIterable<AnalysisEvent> {
      const parsed = studyCaptureAnalyzeRequestSchema.parse(input);
      const csrf = await options.csrfToken();
      const response = await options.fetch(
        new URL(path(studyCaptureHttpRoutes.analyze, id), options.apiOrigin),
        {
          body: JSON.stringify(parsed),
          credentials: "include",
          headers: {
            Accept: "text/event-stream",
            "Content-Type": "application/json",
            "Idempotency-Key": idempotencyKey,
            "If-Match": `"${parsed.expectedRevision}"`,
            "X-CSRF-Token": csrf,
          },
          method: "POST",
          ...(signal === undefined ? {} : { signal }),
        },
      );
      if (!response.ok) {
        const error = apiErrorSchema.safeParse(await response.json().catch(() => undefined));
        throw new WebStudyCaptureApiError(error.success ? error.data.error.code : "unknown");
      }
      if (
        response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !==
        "text/event-stream"
      ) {
        throw new Error("Huayi API returned an invalid analysis event stream.");
      }
      if (response.body === null) throw new Error("Huayi API returned no analysis event stream.");
      const reader = response.body.getReader();
      const text = new TextDecoder("utf-8", { fatal: true });
      const decoder = createAnalysisSseDecoder();
      let finished = false;
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          for (const event of decoder.push(text.decode(chunk.value, { stream: true }))) yield event;
        }
        for (const event of decoder.push(text.decode())) yield event;
        for (const event of decoder.finish()) yield event;
        finished = true;
      } finally {
        if (!finished) await reader.cancel().catch(() => undefined);
        reader.releaseLock();
      }
    },
    async deleteCapture(id: string, expectedRevision: number, idempotencyKey: string) {
      const input = studyCaptureDeleteRequestSchema.parse({ expectedRevision });
      return studyCaptureDeleteResponseSchema.parse(
        await mutation(studyCaptureHttpRoutes.detail, id, input, idempotencyKey, "DELETE"),
      );
    },
    async getAnalysisRequestStatus(requestId: string) {
      if (!/^[A-Za-z0-9_-]{1,128}$/u.test(requestId)) {
        throw new TypeError("Analysis request ID is invalid.");
      }
      return analysisRequestStatusSchema.parse(
        await execute(
          new URL(
            analysisHttpRoutes.status.replace(":requestId", encodeURIComponent(requestId)),
            options.apiOrigin,
          ),
          { credentials: "include", method: "GET" },
        ),
      );
    },
    async getCapture(id: string) {
      return studyCaptureDetailResponseSchema.parse(
        await execute(new URL(path(studyCaptureHttpRoutes.detail, id), options.apiOrigin), {
          credentials: "include",
          method: "GET",
        }),
      );
    },
    async listCaptures(query: Partial<StudyCaptureListQuery>) {
      const parsed = studyCaptureListQuerySchema.parse(query);
      const url = new URL(studyCaptureHttpRoutes.list, options.apiOrigin);
      for (const [key, value] of Object.entries(parsed)) {
        if (value !== undefined) url.searchParams.set(key, String(value));
      }
      return studyCaptureListResponseSchema.parse(
        await execute(url, { credentials: "include", method: "GET" }),
      );
    },
    async patchCapture(
      id: string,
      input: ReturnType<typeof studyCapturePatchRequestSchema.parse>,
      idempotencyKey: string,
    ) {
      const parsed = studyCapturePatchRequestSchema.parse(input);
      return studyCapturePatchResponseSchema.parse(
        await mutation(studyCaptureHttpRoutes.detail, id, parsed, idempotencyKey, "PATCH"),
      );
    },
  };
}

type CaptureApi = ReturnType<typeof createWebStudyCaptureApi>;
export type WebStudyCaptureApi = Omit<CaptureApi, "tasks" | "createCapture"> &
  Partial<Pick<CaptureApi, "tasks" | "createCapture">>;
