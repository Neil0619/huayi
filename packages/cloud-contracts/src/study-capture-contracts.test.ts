import { describe, expect, it } from "vitest";

import {
  studyCaptureAnalyzeRequestSchema,
  studyCaptureDetailResponseSchema,
  studyCaptureHttpRoutes,
  studyCaptureListQuerySchema,
  studyCaptureListResponseSchema,
} from "./index.js";

const capture = {
  captureCount: 1,
  createdAt: "2026-08-13T00:00:00.000Z",
  firstCapturedAt: "2026-08-13T00:00:00.000Z",
  id: "capture-1",
  kind: "sentence" as const,
  lastCapturedAt: "2026-08-13T00:00:00.000Z",
  normalizedTextHash: "a".repeat(64),
  revision: 1,
  sourceText: "This is worth learning.",
  status: "pending" as const,
  updatedAt: "2026-08-13T00:00:00.000Z",
};

describe("StudyCapture Web contracts", () => {
  it("defines strict list/detail projections without owner or analysis content", () => {
    const detail = studyCaptureDetailResponseSchema.parse({ capture, latestAnalysis: null });
    expect(studyCaptureListResponseSchema.parse({ items: [detail], nextCursor: null })).toEqual({
      items: [detail],
      nextCursor: null,
    });
    expect(() =>
      studyCaptureDetailResponseSchema.parse({ capture, latestAnalysis: null, ownerUserId: "x" }),
    ).toThrow();
    expect(studyCaptureListQuerySchema.parse({})).toEqual({ limit: 20, status: "pending" });
  });

  it("fixes initial/reanalysis intent and revision proof on the capture analysis route", () => {
    expect(
      studyCaptureAnalyzeRequestSchema.parse({ expectedRevision: 1, intent: "initial" }),
    ).toEqual({ expectedRevision: 1, intent: "initial" });
    expect(studyCaptureHttpRoutes.analyze).toBe("/v1/study-captures/:id/analyses:stream");
    expect(() =>
      studyCaptureAnalyzeRequestSchema.parse({
        action: "explain",
        expectedRevision: 1,
        intent: "initial",
      }),
    ).toThrow();
  });

  it("projects only the safe active request needed to resume an analyzing capture", () => {
    const detail = studyCaptureDetailResponseSchema.parse({
      activeAnalysisRequest: { requestId: "request-1", state: "running" },
      capture: { ...capture, revision: 2, status: "analyzing" },
      latestAnalysis: null,
    });
    expect(detail.activeAnalysisRequest).toEqual({ requestId: "request-1", state: "running" });
    expect(() =>
      studyCaptureDetailResponseSchema.parse({
        ...detail,
        activeAnalysisRequest: {
          leaseToken: "secret",
          requestId: "request-1",
          state: "running",
        },
      }),
    ).toThrow();
  });
});
