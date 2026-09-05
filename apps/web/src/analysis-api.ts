import { createWebLearningTasks } from "./learning-task-api.js";
import {
  apiErrorSchema,
  analysisHistoryResponseSchema,
  analysisDeleteResponseSchema,
  analysisDeleteRequestSchema,
  analysisHttpRoutes,
  analysisMutationRequestSchema,
  analysisRecordSchema,
  analysisRequestStatusSchema,
  confirmCandidatesRequestSchema,
  confirmCandidatesResponseSchema,
  createAnalysisSseDecoder,
  listAnalysesQuerySchema,
  startAnalysisRequestSchema,
  type AnalysisEvent,
  type ApiError,
  type ConfirmCandidatesRequest,
  type ListAnalysesQuery,
  type StartAnalysisRequest,
} from "@huayi/cloud-contracts";

export class WebAnalysisApiError extends Error {
  constructor(
    readonly code: ApiError["error"]["code"] | "unknown",
    status: number,
  ) {
    super(`Huayi API request failed with ${status}.`);
    this.name = "WebAnalysisApiError";
  }
}

export interface WebAnalysisApiOptions {
  apiOrigin: string;
  csrfToken(): Promise<string>;
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

export function createWebAnalysisApi(options: WebAnalysisApiOptions) {
  const url = (path: string) => new URL(path, options.apiOrigin);
  const requireSuccess = async (response: Response) => {
    if (!response.ok) {
      const parsed = apiErrorSchema.safeParse(await response.json().catch(() => undefined));
      if (parsed.success) throw new WebAnalysisApiError(parsed.data.error.code, response.status);
      throw new WebAnalysisApiError("unknown", response.status);
    }
    return response.json() as Promise<unknown>;
  };
  const historyPath = (route: string, id: string) => route.replace(":id", encodeURIComponent(id));
  const mutation = async (
    route: string,
    id: string,
    expectedRevision: number,
    idempotencyKey: string,
    method: "DELETE" | "POST" = "POST",
    body: unknown = analysisMutationRequestSchema.parse({ expectedRevision }),
  ) => {
    const csrfToken = await options.csrfToken();
    return requireSuccess(
      await options.fetch(url(historyPath(route, id)), {
        body: JSON.stringify(body),
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
          "If-Match": `"${expectedRevision}"`,
          "X-CSRF-Token": csrfToken,
        },
        method,
      }),
    );
  };
  return {
    tasks: createWebLearningTasks(options),
    async archiveAnalysis(id: string, expectedRevision: number, idempotencyKey: string) {
      return analysisRecordSchema.parse(
        await mutation(analysisHttpRoutes.archive, id, expectedRevision, idempotencyKey),
      );
    },
    async confirmCandidates(id: string, input: ConfirmCandidatesRequest, idempotencyKey: string) {
      const parsed = confirmCandidatesRequestSchema.parse(input);
      return confirmCandidatesResponseSchema.parse(
        await mutation(
          analysisHttpRoutes.confirmCandidates,
          id,
          parsed.analysisRevision,
          idempotencyKey,
          "POST",
          parsed,
        ),
      );
    },
    async deleteAnalysis(
      id: string,
      expectedRevision: number,
      idempotencyKey: string,
      deleteStudyCapture: boolean,
    ) {
      return analysisDeleteResponseSchema.parse(
        await mutation(
          analysisHttpRoutes.delete,
          id,
          expectedRevision,
          idempotencyKey,
          "DELETE",
          analysisDeleteRequestSchema.parse({ deleteStudyCapture, expectedRevision }),
        ),
      );
    },
    async getAnalysis(id: string) {
      return analysisRecordSchema.parse(
        await requireSuccess(
          await options.fetch(url(`${analysisHttpRoutes.history}/${encodeURIComponent(id)}`), {
            credentials: "include",
          }),
        ),
      );
    },
    async getRequestStatus(requestId: string) {
      return analysisRequestStatusSchema.parse(
        await requireSuccess(
          await options.fetch(
            url(analysisHttpRoutes.status.replace(":requestId", encodeURIComponent(requestId))),
            { credentials: "include" },
          ),
        ),
      );
    },
    async listPending(query?: { cursor?: string }) {
      const endpoint = url(analysisHttpRoutes.history);
      endpoint.searchParams.set("reviewState", "pendingReview");
      if (query?.cursor) endpoint.searchParams.set("cursor", query.cursor);
      return analysisHistoryResponseSchema.parse(
        await requireSuccess(await options.fetch(endpoint, { credentials: "include" })),
      );
    },
    async listHistory(query: ListAnalysesQuery) {
      const parsed = listAnalysesQuerySchema.parse(query);
      const endpoint = url(analysisHttpRoutes.history);
      for (const [key, value] of Object.entries(parsed)) {
        if (value !== undefined) endpoint.searchParams.set(key, String(value));
      }
      return analysisHistoryResponseSchema.parse(
        await requireSuccess(await options.fetch(endpoint, { credentials: "include" })),
      );
    },
    async processNothingToSave(id: string, expectedRevision: number, idempotencyKey: string) {
      return analysisRecordSchema.parse(
        await mutation(analysisHttpRoutes.process, id, expectedRevision, idempotencyKey, "POST", {
          expectedRevision,
          outcome: "nothing-to-save",
        }),
      );
    },
    async restoreAnalysis(id: string, expectedRevision: number, idempotencyKey: string) {
      return analysisRecordSchema.parse(
        await mutation(analysisHttpRoutes.restore, id, expectedRevision, idempotencyKey),
      );
    },
    async *startAnalysis(
      input: StartAnalysisRequest,
      idempotencyKey: string,
      signal?: AbortSignal,
    ): AsyncIterable<AnalysisEvent> {
      const csrfToken = await options.csrfToken();
      const response = await options.fetch(url(analysisHttpRoutes.start), {
        body: JSON.stringify(startAnalysisRequestSchema.parse(input)),
        credentials: "include",
        headers: {
          Accept: "text/event-stream",
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
          "X-CSRF-Token": csrfToken,
        },
        method: "POST",
        ...(signal === undefined ? {} : { signal }),
      });
      if (!response.ok) {
        const parsed = apiErrorSchema.safeParse(await response.json().catch(() => undefined));
        if (parsed.success) throw new WebAnalysisApiError(parsed.data.error.code, response.status);
        throw new WebAnalysisApiError("unknown", response.status);
      }
      if (
        response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() !==
        "text/event-stream"
      ) {
        throw new Error("Huayi API returned an invalid analysis event stream.");
      }
      if (response.body === null) throw new Error("Huayi API returned no analysis event stream.");
      const decoder = new TextDecoder("utf-8", { fatal: true });
      const events = createAnalysisSseDecoder();
      const reader = response.body.getReader();
      let finished = false;
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          for (const event of events.push(decoder.decode(chunk.value, { stream: true }))) {
            yield event;
          }
        }
        for (const event of events.push(decoder.decode())) yield event;
        for (const event of events.finish()) yield event;
        finished = true;
      } finally {
        if (!finished) await reader.cancel().catch(() => undefined);
        reader.releaseLock();
      }
    },
  };
}
