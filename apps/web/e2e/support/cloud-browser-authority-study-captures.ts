import type { Request, Route } from "@playwright/test";
import {
  analysisEventSchema,
  analysisRecordSchema,
  contractFixtures,
  idempotencyKeySchema,
  studyCaptureAnalyzeRequestSchema,
  studyCaptureCreateRequestSchema,
  studyCaptureCreateResponseSchema,
  studyCaptureDeleteRequestSchema,
  studyCaptureDeleteResponseSchema,
  studyCaptureDetailResponseSchema,
  studyCaptureListQuerySchema,
  studyCaptureListResponseSchema,
  studyCapturePatchRequestSchema,
  type AnalysisRecord,
  type ApiError,
  type StudyCaptureDetailResponse,
} from "@huayi/cloud-contracts";

import {
  cloudCors,
  cloudQueryObject,
  cloudRequestBody,
} from "./cloud-browser-authority-request.js";
import type {
  CloudBrowserAuthenticatedAs,
  CloudBrowserRequestFact,
} from "./cloud-browser-authority-types.js";

const now = "2026-08-13T10:00:00.000Z";

interface StudyCaptureAuthorityContext {
  authentication(request: Request): CloudBrowserAuthenticatedAs;
  json(route: Route, status: number, body: unknown): Promise<void>;
  onCompleted(analysis: AnalysisRecord): void;
  record(request: Request, proof: CloudBrowserRequestFact["proof"]): void;
  reject(
    route: Route,
    status: number,
    code: ApiError["error"]["code"],
    proof?: CloudBrowserRequestFact["proof"],
  ): Promise<void>;
  writeProof(request: Request, revision?: number): string | null;
}

function completedAnalysis(detail: StudyCaptureDetailResponse, ordinal: number): AnalysisRecord {
  const fixture = analysisRecordSchema.parse(contractFixtures.analysis);
  if (!("overall" in fixture.result)) throw new Error("Passage fixture missing.");
  return analysisRecordSchema.parse({
    ...fixture,
    createdAt: now,
    id: `analysis-capture-${ordinal}`,
    result: {
      ...fixture.result,
      sentences: fixture.result.sentences.map((sentence) => ({
        ...sentence,
        sourceText: detail.capture.sourceText,
      })),
    },
    selectionKind: detail.capture.kind,
    source: {
      type: "study-capture",
      ...(detail.capture.title ? { title: detail.capture.title } : {}),
    },
    sourceText: detail.capture.sourceText,
    studyCaptureId: detail.capture.id,
    updatedAt: now,
  });
}

function encodeSse(events: readonly unknown[]) {
  return events
    .map((event, index) => `event: analysis\nid: ${index + 1}\ndata: ${JSON.stringify(event)}\n\n`)
    .join("");
}

export function createCloudBrowserStudyCaptureAuthority() {
  let captures: StudyCaptureDetailResponse[] = [];
  const createReplays = new Map<string, unknown>();

  return {
    count: () => captures.length,
    async handle(route: Route, context: StudyCaptureAuthorityContext): Promise<boolean> {
      const request = route.request();
      const url = new URL(request.url());
      if (!url.pathname.startsWith("/v1/study-captures") && url.pathname !== "/v2/study-captures")
        return false;

      if (
        ["/v1/study-captures", "/v2/study-captures"].includes(url.pathname) &&
        request.method() === "POST"
      ) {
        const parsed = studyCaptureCreateRequestSchema.safeParse(cloudRequestBody(request));
        const key = request.headers()["idempotency-key"];
        if (
          (url.pathname === "/v2/study-captures"
            ? context.authentication(request) !== "web" || context.writeProof(request) === null
            : context.authentication(request) !== "extension" ||
              request.headers()["x-huayi-client-version"] !== "1.0.0") ||
          !parsed.success ||
          !idempotencyKeySchema.safeParse(key).success
        ) {
          await context.reject(route, 403, "forbidden");
          return true;
        }
        const replay = createReplays.get(key ?? "");
        if (replay !== undefined) {
          context.record(request, "write-valid");
          await context.json(route, 200, replay);
          return true;
        }
        const existingIndex = captures.findIndex(
          (detail) =>
            detail.capture.kind === parsed.data.kind &&
            detail.capture.sourceText === parsed.data.sourceText,
        );
        if (existingIndex >= 0) {
          const existing = captures[existingIndex];
          if (existing === undefined) throw new Error("StudyCapture fixture index drifted.");
          const updated = studyCaptureDetailResponseSchema.parse({
            ...existing,
            capture: {
              ...existing.capture,
              captureCount: existing.capture.captureCount + 1,
              lastCapturedAt: now,
              revision: existing.capture.revision + 1,
              updatedAt: now,
            },
          });
          captures = captures.map((candidate, ordinal) =>
            ordinal === existingIndex ? updated : candidate,
          );
          const response = studyCaptureCreateResponseSchema.parse({
            capture: updated.capture,
            outcome: updated.latestAnalysis === null ? "existing" : "linked-analysis",
          });
          createReplays.set(key ?? "", response);
          context.record(request, "write-valid");
          await context.json(route, 200, response);
          return true;
        }
        const id = `capture-${captures.length + 1}`;
        const detail = studyCaptureDetailResponseSchema.parse({
          capture: {
            captureCount: 1,
            createdAt: now,
            firstCapturedAt: now,
            id,
            kind: parsed.data.kind,
            lastCapturedAt: now,
            normalizedTextHash: String(captures.length + 1).padStart(64, "0"),
            revision: 1,
            sourceText: parsed.data.sourceText,
            status: "pending",
            updatedAt: now,
          },
          latestAnalysis: null,
        });
        captures = [...captures, detail];
        const response = studyCaptureCreateResponseSchema.parse({
          capture: detail.capture,
          outcome: "created",
          undo: { captureId: id, expectedRevision: 1 },
        });
        createReplays.set(key ?? "", response);
        context.record(request, "write-valid");
        await context.json(route, 201, response);
        return true;
      }

      const extensionDelete = /^\/v1\/study-captures\/([^/]+)$/u.exec(url.pathname);
      if (extensionDelete?.[1] !== undefined && request.method() === "DELETE") {
        const id = decodeURIComponent(extensionDelete[1]);
        const parsed = studyCaptureDeleteRequestSchema.safeParse(cloudRequestBody(request));
        const key = request.headers()["idempotency-key"];
        const detail = captures.find((candidate) => candidate.capture.id === id);
        if (
          context.authentication(request) !== "extension" ||
          request.headers()["x-huayi-client-version"] !== "1.0.0" ||
          !parsed.success ||
          !idempotencyKeySchema.safeParse(key).success
        ) {
          await context.reject(route, 403, "forbidden");
          return true;
        }
        if (detail === undefined) {
          await context.reject(route, 404, "not_found", "write-valid");
          return true;
        }
        if (
          detail.capture.revision !== parsed.data.expectedRevision ||
          detail.capture.status !== "pending" ||
          detail.capture.captureCount !== 1
        ) {
          await context.reject(route, 409, "revision_conflict", "write-valid");
          return true;
        }
        captures = captures.filter((candidate) => candidate.capture.id !== id);
        context.record(request, "write-valid");
        await context.json(
          route,
          200,
          studyCaptureDeleteResponseSchema.parse({ deleted: true, id }),
        );
        return true;
      }

      if (context.authentication(request) !== "web") {
        await context.reject(route, 401, "authentication_required", "read");
        return true;
      }
      if (url.pathname === "/v1/study-captures" && request.method() === "GET") {
        const query = studyCaptureListQuerySchema.safeParse(cloudQueryObject(url));
        if (!query.success) {
          await context.reject(route, 400, "invalid_request", "read");
          return true;
        }
        const visible = captures.filter(
          (detail) =>
            detail.capture.status === query.data.status &&
            (query.data.kind === undefined || detail.capture.kind === query.data.kind),
        );
        context.record(request, "read");
        await context.json(
          route,
          200,
          studyCaptureListResponseSchema.parse({ items: visible, nextCursor: null }),
        );
        return true;
      }
      const analyze = /^\/v1\/study-captures\/([^/]+)\/analyses:stream$/u.exec(url.pathname);
      if (analyze?.[1] !== undefined && request.method() === "POST") {
        const id = decodeURIComponent(analyze[1]);
        const index = captures.findIndex((detail) => detail.capture.id === id);
        if (index < 0) {
          await context.reject(route, 404, "not_found");
          return true;
        }
        const parsed = studyCaptureAnalyzeRequestSchema.safeParse(cloudRequestBody(request));
        const detail = captures[index];
        if (detail === undefined || !parsed.success) {
          await context.reject(route, 400, "invalid_request");
          return true;
        }
        const key = context.writeProof(request, parsed.data.expectedRevision);
        if (key === null) {
          await context.reject(route, 403, "forbidden");
          return true;
        }
        if (detail.capture.revision !== parsed.data.expectedRevision) {
          await context.reject(route, 409, "revision_conflict", "write-valid");
          return true;
        }
        const analysis = completedAnalysis(detail, captures.length);
        const updated = studyCaptureDetailResponseSchema.parse({
          capture: {
            ...detail.capture,
            revision: detail.capture.revision + 1,
            status: "analyzed",
            updatedAt: now,
          },
          latestAnalysis: {
            createdAt: analysis.createdAt,
            id: analysis.id,
            reviewState: analysis.reviewState,
            revision: analysis.revision,
          },
        });
        captures = captures.map((candidate, ordinal) => (ordinal === index ? updated : candidate));
        const events = [
          analysisEventSchema.parse({
            requestId: `request-capture-${captures.length}`,
            type: "analysis.started",
            unitCount: 1,
          }),
          analysisEventSchema.parse({
            requestId: `request-capture-${captures.length}`,
            section: "overall",
            text: "正在识别可复用表达。",
            type: "analysis.preview",
          }),
          analysisEventSchema.parse({
            analysis,
            quota: contractFixtures.completedEvent.quota,
            type: "analysis.completed",
          }),
        ];
        context.onCompleted(analysis);
        context.record(request, "write-valid");
        await route.fulfill({
          body: encodeSse(events),
          contentType: "text/event-stream; charset=utf-8",
          headers: { ...cloudCors(request.headers().origin), "cache-control": "no-store" },
          status: 200,
        });
        return true;
      }
      const detailMatch = /^\/v1\/study-captures\/([^/]+)$/u.exec(url.pathname);
      if (detailMatch?.[1] && request.method() === "PATCH") {
        const detail = captures.find((value) => value.capture.id === detailMatch[1]);
        const parsed = studyCapturePatchRequestSchema.safeParse(cloudRequestBody(request));
        if (
          !detail ||
          !parsed.success ||
          context.writeProof(request, parsed.data.expectedRevision) === null
        ) {
          await context.reject(route, 403, "forbidden");
          return true;
        }
        if (detail.capture.revision !== parsed.data.expectedRevision) {
          await context.reject(route, 409, "revision_conflict");
          return true;
        }
        const { expectedRevision, ...metadata } = parsed.data;
        detail.capture = studyCaptureDetailResponseSchema.parse({
          ...detail,
          capture: {
            ...detail.capture,
            ...metadata,
            title: metadata.title === null ? undefined : (metadata.title ?? detail.capture.title),
            userContext:
              metadata.userContext === null
                ? undefined
                : (metadata.userContext ?? detail.capture.userContext),
            revision: expectedRevision + 1,
          },
        }).capture;
        context.record(request, "write-valid");
        await context.json(route, 200, detail);
        return true;
      }
      if (detailMatch?.[1] !== undefined && request.method() === "GET") {
        const detail = captures.find(
          (candidate) => candidate.capture.id === decodeURIComponent(detailMatch[1] ?? ""),
        );
        context.record(request, "read");
        await context.json(
          route,
          detail === undefined ? 404 : 200,
          detail ?? { error: { code: "not_found", message: "Not found", requestId: "e2e" } },
        );
        return true;
      }
      return false;
    },
  };
}
