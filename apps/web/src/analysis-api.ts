import {
  createAnalysisEventBinding,
  invalidAnalysisResponse,
  readBoundAnalysisStatus,
} from "./analysis-event-binding.js";
import { createWebStructuredLearningTasks } from "./learning-task-api.js";
import {
  apiErrorSchema,
  structuredTeachingAccept,
  analysisHistoryReadResponseSchema,
  analysisDeleteResponseSchema,
  analysisDeleteRequestSchema,
  analysisHttpRoutes,
  analysisMutationRequestSchema,
  analysisRecordReadSchema,
  confirmCandidatesRequestSchema,
  confirmCandidatesReadResponseSchema,
  createStructuredAnalysisSseDecoder,
  listAnalysesQuerySchema,
  startStructuredAnalysisRequestSchema,
  type AnalysisEventRead as AnalysisEvent,
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
  const readAnalysis = (id: string, value: unknown) => {
    const record = analysisRecordReadSchema.parse(value);
    if (record.id !== id) invalidAnalysisResponse();
    return record;
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
          Accept: structuredTeachingAccept.json,
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
          "X-Huayi-Revision": `"${expectedRevision}"`,
          "X-CSRF-Token": csrfToken,
        },
        method,
      }),
    );
  };
  return {
    analysisTasks: createWebStructuredLearningTasks(options),
    async archiveAnalysis(id: string, expectedRevision: number, idempotencyKey: string) {
      return readAnalysis(
        id,
        await mutation(analysisHttpRoutes.archive, id, expectedRevision, idempotencyKey),
      );
    },
    async confirmCandidates(id: string, input: ConfirmCandidatesRequest, idempotencyKey: string) {
      const parsed = confirmCandidatesRequestSchema.parse(input);
      const confirmed = confirmCandidatesReadResponseSchema.parse(
        await mutation(
          analysisHttpRoutes.confirmCandidates,
          id,
          parsed.analysisRevision,
          idempotencyKey,
          "POST",
          parsed,
        ),
      );
      if (confirmed.analysis.id !== id) invalidAnalysisResponse();
      return confirmed;
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
      return readAnalysis(
        id,
        await requireSuccess(
          await options.fetch(url(`${analysisHttpRoutes.history}/${encodeURIComponent(id)}`), {
            credentials: "include",
            headers: { Accept: structuredTeachingAccept.json },
          }),
        ),
      );
    },
    async getRequestStatus(requestId: string) {
      return readBoundAnalysisStatus(
        requestId,
        await requireSuccess(
          await options.fetch(
            url(analysisHttpRoutes.status.replace(":requestId", encodeURIComponent(requestId))),
            { credentials: "include", headers: { Accept: structuredTeachingAccept.json } },
          ),
        ),
      );
    },
    async listPending(query?: { cursor?: string }) {
      const endpoint = url(analysisHttpRoutes.history);
      endpoint.searchParams.set("reviewState", "pendingReview");
      if (query?.cursor) endpoint.searchParams.set("cursor", query.cursor);
      return analysisHistoryReadResponseSchema.parse(
        await requireSuccess(
          await options.fetch(endpoint, {
            credentials: "include",
            headers: { Accept: structuredTeachingAccept.json },
          }),
        ),
      );
    },
    async listHistory(query: ListAnalysesQuery) {
      const parsed = listAnalysesQuerySchema.parse(query);
      const endpoint = url(analysisHttpRoutes.history);
      for (const [key, value] of Object.entries(parsed)) {
        if (value !== undefined) endpoint.searchParams.set(key, String(value));
      }
      return analysisHistoryReadResponseSchema.parse(
        await requireSuccess(
          await options.fetch(endpoint, {
            credentials: "include",
            headers: { Accept: structuredTeachingAccept.json },
          }),
        ),
      );
    },
    async processNothingToSave(id: string, expectedRevision: number, idempotencyKey: string) {
      return readAnalysis(
        id,
        await mutation(analysisHttpRoutes.process, id, expectedRevision, idempotencyKey, "POST", {
          expectedRevision,
          outcome: "nothing-to-save",
        }),
      );
    },
    async restoreAnalysis(id: string, expectedRevision: number, idempotencyKey: string) {
      return readAnalysis(
        id,
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
        body: JSON.stringify(
          startStructuredAnalysisRequestSchema.parse({
            ...input,
            outputContract: "structured-teaching-v1",
          }),
        ),
        credentials: "include",
        headers: {
          Accept: structuredTeachingAccept.eventStream,
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
      const events = createStructuredAnalysisSseDecoder();
      const binding = createAnalysisEventBinding({ ...input, requireStructured: true });
      const reader = response.body.getReader();
      let finished = false;
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          for (const event of events.push(decoder.decode(chunk.value, { stream: true }))) {
            yield binding.accept(event);
          }
        }
        for (const event of events.push(decoder.decode())) yield binding.accept(event);
        for (const event of events.finish()) yield binding.accept(event);
        finished = true;
      } finally {
        if (!finished) await reader.cancel().catch(() => undefined);
        reader.releaseLock();
      }
    },
  };
}
