import {
  analysisEventReadSchema,
  analysisRecordSchema,
  confirmCandidatesResponseSchema,
  createAnalysisSseDecoder,
  startAnalysisRequestSchema,
  structuredTeachingAccept,
} from "@huayi/cloud-contracts";
import { createHash } from "node:crypto";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { createAnalysisApp } from "./analysis-app.js";
import { createAnalysisModule } from "./analysis-module.js";
import { createInMemoryAnalysisRequestLifecycle } from "./analysis-request-lifecycle.js";
import {
  createInMemoryAnalysisCommitter,
  createInMemoryAnalysisRepository,
} from "./analysis-repository.js";
import { FakeAnalysisModel, FakeAnalysisQuota } from "./test-support/analysis-fakes.js";
import { MutableClock } from "./test-support/security-fakes.js";
import { structuredAnalysisFixture } from "./test-support/structured-analysis-fixture.js";

async function setup() {
  const record = structuredAnalysisFixture();
  const quota = new FakeAnalysisQuota();
  const repository = createInMemoryAnalysisRepository();
  await repository.save("user-a", record);
  const clock = new MutableClock("2026-09-12T10:00:00.000Z");
  const lifecycle = createInMemoryAnalysisRequestLifecycle({ now: () => clock.now() });
  const model = new FakeAnalysisModel(record);
  let sequence = 0;
  const module = createAnalysisModule({
    clock,
    committer: createInMemoryAnalysisCommitter(repository, quota, lifecycle),
    cursorKey: new Uint8Array(32).fill(7),
    ids: () => `request-${++sequence}`,
    model,
    quota,
    requestLifecycle: lifecycle,
    repository,
    studyCaptures: {
      async get() {
        return null;
      },
    },
  });
  const app = new Hono();
  app.use("*", async (context, next) => {
    context.header("Vary", "Origin");
    await next();
  });
  app.onError((_error, context) => context.json({ error: "rejected" }, 400));
  app.route(
    "/",
    createAnalysisApp({
      authenticate: (context) => context.req.header("x-test-owner") ?? "user-a",
      module,
    }),
  );
  return { app, repository, record, quota, lifecycle, model };
}
const input = startAnalysisRequestSchema.parse({
  selectionKind: "sentence",
  source: { type: "manual" },
  sourceText: "We can.",
});
const headers = (accept?: string) => ({
  "Content-Type": "application/json",
  ...(accept === undefined ? {} : { Accept: accept }),
});

describe("structured analysis persisted readers", () => {
  it("marks representation-dependent responses private and varies by Accept without losing Origin", async () => {
    const { app, record } = await setup();
    for (const url of ["/v1/analyses?archived=false", `/v1/analyses/${record.id}`]) {
      const response = await app.request(url, { headers: headers(structuredTeachingAccept.json) });
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(response.headers.get("vary")?.toLowerCase().split(/,\s*/u)).toEqual(
        expect.arrayContaining(["origin", "accept"]),
      );
    }
    const response = await app.request("/v1/analyses:stream", {
      method: "POST",
      headers: { ...headers(), "Idempotency-Key": "headers" },
      body: JSON.stringify(input),
    });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("vary")).toContain("Accept");
    await response.text();
  });
  it("serves native details/history only to an explicit capable reader and isolates owners", async () => {
    const { app, record, quota } = await setup();
    const detail = `/v1/analyses/${record.id}`;
    const old = await (await app.request(detail)).json();
    expect(analysisRecordSchema.parse(old).result.type).toBe("sentence-passage-analysis-v2");
    expect(
      await (await app.request(detail, { headers: headers(structuredTeachingAccept.json) })).json(),
    ).toEqual(record);
    for (const [accept, type] of [
      [undefined, "sentence-passage-analysis-v2"],
      [structuredTeachingAccept.json, "sentence-passage-analysis-v3"],
    ] as const) {
      const response = await app.request("/v1/analyses?archived=false", {
        headers: headers(accept),
      });
      expect(await response.json()).toMatchObject({ items: [{ result: { type } }] });
    }
    expect((await app.request(detail, { headers: { "x-test-owner": "user-b" } })).status).toBe(400);
    expect(
      await (
        await app.request("/v1/analyses?archived=false", { headers: { "x-test-owner": "user-b" } })
      ).json(),
    ).toMatchObject({ items: [] });
    expect(quota.operations).toEqual([]);
  });

  it("preserves new records through mutations and replays the same write in either representation", async () => {
    const { app, repository, record } = await setup();
    for (const [action, revision] of [
      ["archive", 1],
      ["restore", 2],
      ["process", 3],
    ] as const) {
      const body = JSON.stringify({
        expectedRevision: revision,
        ...(action === "process" ? { outcome: "nothing-to-save" } : {}),
      });
      const request = (accept?: string) =>
        app.request(`/v1/analyses/${record.id}/${action}`, {
          method: "POST",
          body,
          headers: {
            ...headers(accept),
            "Idempotency-Key": action,
            "X-Huayi-Revision": `"${revision}"`,
          },
        });
      const native = await (await request(structuredTeachingAccept.json)).json();
      const old = await (await request()).json();
      expect(native).toMatchObject({
        revision: revision + 1,
        result: { type: "sentence-passage-analysis-v3" },
      });
      expect(analysisRecordSchema.parse(old)).toMatchObject({
        revision: revision + 1,
        result: { type: "sentence-passage-analysis-v2" },
      });
    }
    expect(await repository.findById("user-a", record.id)).toMatchObject({
      revision: 4,
      reviewState: "reviewed",
      archivedAt: null,
      result: record.result,
    });
  });

  it("confirms once, preserves source and new teaching, and projects a replay for old clients", async () => {
    const { app, record } = await setup();
    const candidate = record.candidates[0];
    if (!candidate) throw new Error("Expected candidate");
    const request = (accept?: string) =>
      app.request(`/v1/analyses/${record.id}/candidates:confirm`, {
        method: "POST",
        headers: { ...headers(accept), "Idempotency-Key": "confirm", "X-Huayi-Revision": '"1"' },
        body: JSON.stringify({
          analysisRevision: 1,
          confirmations: [
            {
              candidateId: candidate.id,
              targetType: candidate.type,
              payload: candidate.payload,
              decision: "create",
              tags: [],
              systemAttributes: [],
            },
          ],
        }),
      });
    const native = await (await request(structuredTeachingAccept.json)).json();
    expect(native).toMatchObject({
      analysis: { revision: 2, result: record.result },
      results: [{ item: { sourceExamples: [{ sourceText: "We can.", analysisUnitId: "u1" }] } }],
    });
    const old = confirmCandidatesResponseSchema.parse(await (await request()).json());
    expect(old.analysis.result.type).toBe("sentence-passage-analysis-v2");
    expect(native).toMatchObject({ results: old.results });
  });

  it("replays stored terminal teaching with readable SSE for each capability without a model call", async () => {
    const { app, lifecycle, record, quota, model } = await setup();
    await lifecycle.begin({
      idempotencyKey: "replay",
      leaseExpiresAt: new Date("2026-09-12T11:00:00Z"),
      leaseToken: "lease",
      requestHash: createHash("sha256").update(JSON.stringify(input)).digest("hex"),
      requestId: "stored",
      recoveryLedgerId: "ledger",
      unitCount: 1,
      userId: "user-a",
    });
    lifecycle.complete("stored", "lease", {
      type: "analysis.completed",
      analysis: record,
      quota: quota.summary(),
    });
    for (const accept of [undefined, structuredTeachingAccept.eventStream]) {
      const response = await app.request("/v1/analyses:stream", {
        method: "POST",
        headers: { ...headers(accept), "Idempotency-Key": "replay" },
        body: JSON.stringify(input),
      });
      const text = await response.text();
      if (accept === undefined) {
        const decoder = createAnalysisSseDecoder();
        expect(decoder.push(text)).toMatchObject([
          {
            type: "analysis.completed",
            analysis: { result: { type: "sentence-passage-analysis-v2" } },
          },
        ]);
        decoder.finish();
      } else {
        const data = text
          .split("\n")
          .find((line) => line.startsWith("data: "))
          ?.slice(6);
        expect(analysisEventReadSchema.parse(JSON.parse(data ?? "null"))).toMatchObject({
          analysis: record,
        });
      }
    }
    expect(model.requests).toEqual([]);
    expect(quota.operations).toEqual([]);
  });

  it("accepts explicit new generation and rejects a new result returned to an old request", async () => {
    const { app, model, quota } = await setup();
    const request = (body: object, key: string) =>
      app.request("/v1/analyses:stream", {
        method: "POST",
        headers: { ...headers(structuredTeachingAccept.eventStream), "Idempotency-Key": key },
        body: JSON.stringify(body),
      });
    const native = await request({ ...input, outputContract: "structured-teaching-v1" }, "new");
    expect(native.status).toBe(200);
    expect(await native.text()).toContain("analysis.completed");
    expect(model.requests).toHaveLength(1);
    expect(await (await request(input, "old")).text()).toContain("analysis.failed");
    expect(quota.settlements).toMatchObject([{ outcome: "succeeded" }, { outcome: "failed" }]);
  });
});
