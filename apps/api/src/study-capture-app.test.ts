import { studyCaptureHttpRoutes } from "@huayi/cloud-contracts";
import { describe, expect, it, vi } from "vitest";

import { createStudyCaptureApp } from "./study-capture-app.js";

describe("StudyCapture HTTP adapter", () => {
  it("requires authentication and idempotency then returns a strict created outcome", async () => {
    const create = vi.fn(async () => ({
      capture: {
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
      },
      outcome: "created" as const,
      undo: { captureId: "capture-1", expectedRevision: 1 },
    }));
    const app = createStudyCaptureApp({
      authenticateCreate: async () => "owner-a",
      authenticateDelete: async () => "owner-a",
      authenticateWeb: async () => "owner-a",
      module: { create } as never,
    });
    const response = await app.request(studyCaptureHttpRoutes.create, {
      body: JSON.stringify({ kind: "sentence", sourceText: "This is worth learning." }),
      headers: { "Content-Type": "application/json", "Idempotency-Key": "capture-key" },
      method: "POST",
    });

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({ outcome: "created" });
    expect(create).toHaveBeenCalledWith(
      "owner-a",
      { kind: "sentence", sourceText: "This is worth learning." },
      "capture-key",
    );
  });

  it("rejects a missing idempotency key before the module", async () => {
    const create = vi.fn();
    const response = await createStudyCaptureApp({
      authenticateCreate: async () => "owner-a",
      authenticateDelete: async () => "owner-a",
      authenticateWeb: async () => "owner-a",
      module: { create } as never,
    }).request(studyCaptureHttpRoutes.create, {
      body: JSON.stringify({ kind: "sentence", sourceText: "This is worth learning." }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    expect(response.status).toBe(500);
    expect(create).not.toHaveBeenCalled();
  });

  it("provides Web-only list/detail and revision-proven patch routes", async () => {
    const capture = {
      captureCount: 1,
      createdAt: "2026-08-13T00:00:00.000Z",
      firstCapturedAt: "2026-08-13T00:00:00.000Z",
      id: "capture-1",
      kind: "sentence" as const,
      lastCapturedAt: "2026-08-13T00:00:00.000Z",
      normalizedTextHash: "a".repeat(64),
      revision: 2,
      sourceText: "This is worth learning.",
      status: "pending" as const,
      title: "A title",
      updatedAt: "2026-08-13T00:01:00.000Z",
    };
    const list = vi.fn(async () => ({
      items: [{ capture, latestAnalysis: null }],
      nextCursor: null,
    }));
    const get = vi.fn(async () => ({ capture, latestAnalysis: null }));
    const patch = vi.fn(async () => ({ capture, latestAnalysis: null }));
    const app = createStudyCaptureApp({
      authenticateCreate: async () => "extension-owner",
      authenticateDelete: async () => "owner-a",
      authenticateWeb: async () => "owner-a",
      module: { get, list, patch } as never,
    });

    expect((await app.request("/v1/study-captures?status=pending&kind=sentence")).status).toBe(200);
    expect((await app.request("/v1/study-captures/capture-1")).status).toBe(200);
    const response = await app.request("/v1/study-captures/capture-1", {
      body: JSON.stringify({ expectedRevision: 1, title: "A title" }),
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": "patch-key",
        "If-Match": '"1"',
      },
      method: "PATCH",
    });
    expect(response.status).toBe(200);
    expect(list).toHaveBeenCalledWith("owner-a", {
      kind: "sentence",
      limit: 20,
      status: "pending",
    });
    expect(get).toHaveBeenCalledWith("owner-a", "capture-1");
    expect(patch).toHaveBeenCalledWith(
      "owner-a",
      "capture-1",
      { expectedRevision: 1, title: "A title" },
      "patch-key",
    );
  });

  it("starts explicit capture analysis only with Web revision and idempotency proof", async () => {
    const prepareStudyCaptureAnalysis = vi.fn(async function* () {
      yield { requestId: "request-1", type: "analysis.started" as const, unitCount: 1 };
    });
    const app = createStudyCaptureApp({
      analysis: { prepareStudyCaptureAnalysis } as never,
      authenticateCreate: async () => "extension-owner",
      authenticateDelete: async () => "owner-a",
      authenticateWeb: async () => "owner-a",
      module: {} as never,
    });
    const response = await app.request("/v1/study-captures/capture-1/analyses:stream", {
      body: JSON.stringify({ expectedRevision: 2, intent: "reanalysis" }),
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": "analyze-key",
        "If-Match": '"2"',
      },
      method: "POST",
    });
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("analysis.started");
    expect(prepareStudyCaptureAnalysis).toHaveBeenCalledWith({
      captureId: "capture-1",
      idempotencyKey: "analyze-key",
      input: { expectedRevision: 2, intent: "reanalysis" },
      userId: "owner-a",
    });
  });
});
