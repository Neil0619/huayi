import { confirmCandidatesResponseSchema, contractFixtures } from "@huayi/cloud-contracts";
import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { createAnalysisApp } from "./analysis-app.js";
import { createAnalysisModule } from "./analysis-module.js";
import { createInMemoryAnalysisRequestLifecycle } from "./analysis-request-lifecycle.js";
import {
  createInMemoryAnalysisCommitter,
  createInMemoryAnalysisRepository,
} from "./analysis-repository.js";
import { FakeAnalysisModel, FakeAnalysisQuota } from "./test-support/analysis-fakes.js";
import { MutableClock } from "./test-support/security-fakes.js";
import { CloudFault } from "./cloud-fault.js";
import { errorStatus } from "./cloud-foundation-app.js";

function app() {
  const quota = new FakeAnalysisQuota();
  const repository = createInMemoryAnalysisRepository();
  const clock = new MutableClock("2026-08-12T10:00:00.000Z");
  const lifecycle = createInMemoryAnalysisRequestLifecycle({ now: () => clock.now() });
  const module = createAnalysisModule({
    clock,
    committer: createInMemoryAnalysisCommitter(repository, quota, lifecycle),
    cursorKey: new Uint8Array(32).fill(7),
    ids: (() => {
      let value = 0;
      return () => `request-${++value}`;
    })(),
    model: new FakeAnalysisModel({
      candidates: contractFixtures.analysis.candidates,
      modelMetadata: contractFixtures.analysis.modelMetadata,
      result: contractFixtures.analysis.result,
    }),
    quota,
    requestLifecycle: lifecycle,
    repository,
    studyCaptures: {
      async get() {
        return null;
      },
    },
  });
  const outer = new Hono();
  outer.onError((error, context) => {
    const fault =
      error instanceof CloudFault
        ? error
        : new CloudFault("invalid_request", "The request could not be completed.");
    return context.json(
      { error: { code: fault.code, message: fault.message, requestId: "test-request" } },
      errorStatus(fault.code),
    );
  });
  outer.route("/", createAnalysisApp({ authenticate: () => "user-a", module }));
  return outer;
}

async function seedAnalysis(server: Hono): Promise<string> {
  const response = await server.request("/v1/analyses:stream", {
    body: JSON.stringify(contractFixtures.startAnalysisRequest),
    headers: { "Content-Type": "application/json", "Idempotency-Key": "seed" },
    method: "POST",
  });
  expect(response.status).toBe(200);
  await response.text();
  const history = (await (await server.request("/v1/analyses?archived=false")).json()) as {
    items: { id: string }[];
  };
  const id = history.items[0]?.id;
  if (id === undefined) throw new Error("Expected seeded analysis.");
  return id;
}

describe("analysis HTTP slice", () => {
  it("streams SSE and exposes disconnected request status", async () => {
    const server = app();
    const response = await server.request("/v1/analyses:stream", {
      body: JSON.stringify(contractFixtures.startAnalysisRequest),
      headers: { "Content-Type": "application/json", "Idempotency-Key": "key-1" },
      method: "POST",
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(await response.text()).toContain("analysis.completed");
    const status = await server.request("/v1/analysis-requests/request-1");
    expect(await status.json()).toMatchObject({ requestId: "request-1", state: "completed" });
  });

  it("does not expose the removed BYOK result-import route", async () => {
    const server = app();
    const imported = await server.request("/v1/analyses:import", {
      body: JSON.stringify(contractFixtures.analysis),
      headers: { "Content-Type": "application/json", "Idempotency-Key": "import-1" },
      method: "POST",
    });
    expect(imported.status).toBe(404);
  });

  it("processes, archives, restores, and deletes history with revision headers", async () => {
    const server = app();
    const analysisId = await seedAnalysis(server);
    const mutation = (path: string, expectedRevision: number, key: string, method = "POST") =>
      server.request(path, {
        body: JSON.stringify(
          path.endsWith("/process")
            ? { expectedRevision, outcome: "nothing-to-save" }
            : path.endsWith(`/analyses/${analysisId}`)
              ? { deleteStudyCapture: false, expectedRevision }
              : { expectedRevision },
        ),
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": key,
          "If-Match": `"${expectedRevision}"`,
        },
        method,
      });
    expect(
      await (await mutation(`/v1/analyses/${analysisId}/process`, 1, "process")).json(),
    ).toMatchObject({ reviewState: "reviewed", revision: 2 });
    expect(
      await (await mutation(`/v1/analyses/${analysisId}/archive`, 2, "archive")).json(),
    ).toMatchObject({ archivedAt: "2026-08-12T10:00:00.000Z", revision: 3 });
    const archived = await server.request("/v1/analyses?archived=true&reviewState=reviewed");
    expect(await archived.json()).toMatchObject({ items: [{ id: analysisId, revision: 3 }] });
    expect(
      await (await mutation(`/v1/analyses/${analysisId}/restore`, 3, "restore")).json(),
    ).toMatchObject({ archivedAt: null, revision: 4 });
    expect(
      await (await mutation(`/v1/analyses/${analysisId}`, 4, "delete", "DELETE")).json(),
    ).toEqual({
      deleted: true,
      id: analysisId,
    });
  });

  it("confirms candidates only with matching revision and idempotency proof", async () => {
    const server = app();
    const analysisId = await seedAnalysis(server);
    const missing = await server.request(`/v1/analyses/${analysisId}/candidates:confirm`, {
      body: JSON.stringify(contractFixtures.confirmCandidatesRequest),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    const mismatch = await server.request(`/v1/analyses/${analysisId}/candidates:confirm`, {
      body: JSON.stringify(contractFixtures.confirmCandidatesRequest),
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": "confirm-mismatch",
        "If-Match": '"2"',
      },
      method: "POST",
    });
    expect(missing.status).toBe(400);
    expect(mismatch.status).toBe(400);
    const confirmed = await server.request(`/v1/analyses/${analysisId}/candidates:confirm`, {
      body: JSON.stringify(contractFixtures.confirmCandidatesRequest),
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": "confirm-ok",
        "If-Match": '"1"',
      },
      method: "POST",
    });
    expect(confirmed.status).toBe(200);
    expect(confirmCandidatesResponseSchema.parse(await confirmed.json())).toMatchObject({
      analysis: { reviewState: "reviewed", revision: 2 },
      results: [{ action: "created", candidateId: "candidate-1" }],
    });
  });
});
