import {
  analysisDeleteResponseSchema,
  analysisHistoryResponseSchema,
  analysisHttpRoutes,
  analysisMutationRequestSchema,
  analysisRecordSchema,
  confirmCandidatesRequestSchema,
  confirmCandidatesResponseSchema,
  createAnalysisSseDecoder,
  listAnalysesQuerySchema,
  startAnalysisRequestSchema,
  type AnalysisEvent,
  type ConfirmCandidatesRequest,
  type ListAnalysesQuery,
  type StartAnalysisRequest,
} from "@huayi/cloud-contracts";

import { extensionSessionHeaders } from "../cloud/extension-session-headers.js";

export interface CloudAnalysisApiOptions {
  apiOrigin: string;
  clientVersion: string;
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
  sessionToken: () => Promise<string>;
}

export function createCloudAnalysisApi(options: CloudAnalysisApiOptions) {
  const request = async (path: string, init: RequestInit = {}) => {
    const token = await options.sessionToken();
    return options.fetch(new URL(path, options.apiOrigin), {
      ...init,
      credentials: "omit",
      headers: { ...init.headers, ...extensionSessionHeaders(token, options.clientVersion) },
    });
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
    const response = await request(historyPath(route, id), {
      body: JSON.stringify(body),
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
        "If-Match": `"${expectedRevision}"`,
      },
      method,
    });
    if (!response.ok) throw new Error(`Huayi API request failed with ${response.status}.`);
    return response.json() as Promise<unknown>;
  };
  return {
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
    async deleteAnalysis(id: string, expectedRevision: number, idempotencyKey: string) {
      return analysisDeleteResponseSchema.parse(
        await mutation(analysisHttpRoutes.delete, id, expectedRevision, idempotencyKey, "DELETE"),
      );
    },
    async getAnalysis(id: string) {
      const response = await request(historyPath(analysisHttpRoutes.detail, id));
      if (!response.ok) throw new Error(`Huayi API request failed with ${response.status}.`);
      return analysisRecordSchema.parse(await response.json());
    },
    async listHistory(query: ListAnalysesQuery) {
      const endpoint = new URL(analysisHttpRoutes.history, options.apiOrigin);
      for (const [key, value] of Object.entries(listAnalysesQuerySchema.parse(query))) {
        if (value !== undefined) endpoint.searchParams.set(key, String(value));
      }
      const response = await request(`${endpoint.pathname}${endpoint.search}`);
      if (!response.ok) throw new Error(`Huayi API request failed with ${response.status}.`);
      return analysisHistoryResponseSchema.parse(await response.json());
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
    ): AsyncIterable<AnalysisEvent> {
      const response = await request(analysisHttpRoutes.start, {
        body: JSON.stringify(startAnalysisRequestSchema.parse(input)),
        headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
        method: "POST",
      });
      if (!response.ok) throw new Error(`Huayi API request failed with ${response.status}.`);
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
