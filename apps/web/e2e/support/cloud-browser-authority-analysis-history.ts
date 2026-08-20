import type { Request, Route } from "@playwright/test";
import {
  analysisDeleteRequestSchema,
  analysisDeleteResponseSchema,
  analysisHistoryResponseSchema,
  analysisMutationRequestSchema,
  analysisRecordSchema,
  contractFixtures,
  listAnalysesQuerySchema,
  processAnalysisRequestSchema,
  type AnalysisRecord,
  type ApiError,
} from "@huayi/cloud-contracts";

import { cloudQueryObject, cloudRequestBody } from "./cloud-browser-authority-request.js";

interface Hooks {
  json(route: Route, status: number, body: unknown): Promise<void>;
  record(request: Request, proof: "read" | "write-valid"): void;
  reject(
    route: Route,
    status: number,
    code: ApiError["error"]["code"],
    proof?: "read" | "write-invalid" | "write-valid",
  ): Promise<void>;
  writeProof(request: Request, revision?: number): string | null;
}

const analysisId = "analysis-history-1";
const captureId = "analysis-history-capture-1";
const operationTimes = {
  archive: "2026-08-13T10:02:00.000Z",
  process: "2026-08-13T10:01:00.000Z",
  restore: "2026-08-13T10:03:00.000Z",
} as const;

function initialRecord(): AnalysisRecord {
  return analysisRecordSchema.parse({
    ...contractFixtures.analysis,
    id: analysisId,
    source: { title: "Captured planning note", type: "study-capture" },
    studyCaptureId: captureId,
  });
}

function matchesQuery(
  record: AnalysisRecord,
  query: ReturnType<typeof listAnalysesQuerySchema.parse>,
) {
  const searchable = `${record.source.title ?? ""}\n${record.sourceText}`.toLocaleLowerCase();
  return (
    (record.archivedAt !== null) === query.archived &&
    (query.query === undefined || searchable.includes(query.query.toLocaleLowerCase())) &&
    (query.reviewState === undefined || record.reviewState === query.reviewState) &&
    (query.selectionKind === undefined || record.selectionKind === query.selectionKind) &&
    (query.sourceType === undefined || record.source.type === query.sourceType)
  );
}

export function createCloudBrowserAnalysisHistoryAuthority() {
  let capturePresent = true;
  let record: AnalysisRecord | null = initialRecord();
  const replays = new Map<string, { hash: string; response: unknown }>();

  const replay = async (
    route: Route,
    hooks: Hooks,
    key: string,
    hash: string,
  ): Promise<boolean> => {
    const path = new URL(route.request().url()).pathname;
    const prior = replays.get(`${path}\u0000${key}`);
    if (prior === undefined) return false;
    if (prior.hash !== hash) {
      await hooks.reject(route, 409, "idempotency_conflict", "write-valid");
      return true;
    }
    hooks.record(route.request(), "write-valid");
    await hooks.json(route, 200, structuredClone(prior.response));
    return true;
  };

  const saveReplay = (request: Request, key: string, hash: string, response: unknown) => {
    const path = new URL(request.url()).pathname;
    replays.set(`${path}\u0000${key}`, { hash, response: structuredClone(response) });
  };

  const handle = async (route: Route, hooks: Hooks): Promise<boolean> => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === "/v1/analyses" && request.method() === "GET") {
      const query = listAnalysesQuerySchema.safeParse(cloudQueryObject(url));
      if (!query.success || query.data.cursor !== undefined) {
        await hooks.reject(route, 400, "invalid_request", "read");
        return true;
      }
      hooks.record(request, "read");
      await hooks.json(
        route,
        200,
        analysisHistoryResponseSchema.parse({
          items: record !== null && matchesQuery(record, query.data) ? [record] : [],
          nextCursor: null,
        }),
      );
      return true;
    }
    if (url.pathname === `/v1/analyses/${analysisId}` && request.method() === "GET") {
      if (record === null) {
        await hooks.reject(route, 404, "not_found", "read");
        return true;
      }
      hooks.record(request, "read");
      await hooks.json(route, 200, analysisRecordSchema.parse(record));
      return true;
    }
    const mutation = new RegExp(`^/v1/analyses/${analysisId}/(archive|process|restore)$`, "u").exec(
      url.pathname,
    );
    if (mutation?.[1] !== undefined && request.method() === "POST") {
      const operation = mutation[1] as keyof typeof operationTimes;
      const body = cloudRequestBody(request);
      const parsed =
        operation === "process"
          ? processAnalysisRequestSchema.safeParse(body)
          : analysisMutationRequestSchema.safeParse(body);
      if (!parsed.success) {
        await hooks.reject(route, 400, "invalid_request");
        return true;
      }
      const key = hooks.writeProof(request, parsed.data.expectedRevision);
      if (key === null) {
        await hooks.reject(route, 403, "forbidden");
        return true;
      }
      const hash = JSON.stringify(parsed.data);
      if (await replay(route, hooks, key, hash)) return true;
      if (record === null) {
        await hooks.reject(route, 404, "not_found", "write-valid");
        return true;
      }
      if (record.revision !== parsed.data.expectedRevision) {
        await hooks.reject(route, 409, "revision_conflict", "write-valid");
        return true;
      }
      const allowed =
        (operation === "process" && record.reviewState === "pendingReview") ||
        (operation === "archive" && record.archivedAt === null) ||
        (operation === "restore" && record.archivedAt !== null);
      if (!allowed) {
        await hooks.reject(route, 400, "invalid_request", "write-valid");
        return true;
      }
      const updatedAt = operationTimes[operation];
      record = analysisRecordSchema.parse({
        ...record,
        ...(operation === "process" ? { reviewState: "reviewed" } : {}),
        ...(operation === "archive" ? { archivedAt: updatedAt } : {}),
        ...(operation === "restore" ? { archivedAt: null } : {}),
        revision: record.revision + 1,
        updatedAt,
      });
      saveReplay(request, key, hash, record);
      hooks.record(request, "write-valid");
      await hooks.json(route, 200, record);
      return true;
    }
    if (url.pathname === `/v1/analyses/${analysisId}` && request.method() === "DELETE") {
      const parsed = analysisDeleteRequestSchema.safeParse(cloudRequestBody(request));
      if (!parsed.success) {
        await hooks.reject(route, 400, "invalid_request");
        return true;
      }
      const key = hooks.writeProof(request, parsed.data.expectedRevision);
      if (key === null) {
        await hooks.reject(route, 403, "forbidden");
        return true;
      }
      const hash = JSON.stringify(parsed.data);
      if (await replay(route, hooks, key, hash)) return true;
      if (record === null) {
        await hooks.reject(route, 404, "not_found", "write-valid");
        return true;
      }
      if (record.revision !== parsed.data.expectedRevision) {
        await hooks.reject(route, 409, "revision_conflict", "write-valid");
        return true;
      }
      const response = analysisDeleteResponseSchema.parse({ deleted: true, id: analysisId });
      if (parsed.data.deleteStudyCapture) capturePresent = false;
      record = null;
      saveReplay(request, key, hash, response);
      hooks.record(request, "write-valid");
      await hooks.json(route, 200, response);
      return true;
    }
    return false;
  };

  return {
    analysisCount: () => (record === null ? 0 : 1),
    captureCount: () => (capturePresent ? 1 : 0),
    handle,
  };
}
