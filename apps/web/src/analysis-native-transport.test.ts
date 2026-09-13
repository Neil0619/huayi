import {
  contractFixtures,
  confirmCandidatesRequestSchema,
  structuredTeachingAccept,
  type LearningTaskSnapshotRead,
} from "@huayi/cloud-contracts";
import { expect, it, vi } from "vitest";
import { createWebAnalysisApi } from "./analysis-api.js";
import { createWebStudyCaptureApi } from "./study-capture-api.js";
import { createWebLearningTasks, createWebStructuredLearningTasks } from "./learning-task-api.js";
import { nativeWebAnalysis } from "./native-analysis.test-support.js";
const options = (fetch: typeof globalThis.fetch) => ({
  apiOrigin: "https://api.fixture.invalid",
  csrfToken: async () => "offline-csrf",
  fetch,
});
const collect = async <T>(stream: AsyncIterable<T>) => {
  const values: T[] = [];
  for await (const value of stream) values.push(value);
  return values;
};
function captured() {
  const native = nativeWebAnalysis();
  const analysis = { ...native, sourceText: native.sourceText.trim(), studyCaptureId: "capture-1" };
  const capture = {
    captureCount: 1,
    createdAt: analysis.createdAt,
    updatedAt: analysis.updatedAt,
    firstCapturedAt: analysis.createdAt,
    lastCapturedAt: analysis.createdAt,
    id: "capture-1",
    kind: "passage",
    normalizedTextHash: "a".repeat(64),
    revision: 1,
    sourceText: analysis.sourceText,
    status: "pending",
  };
  return { analysis, detail: { capture, latestAnalysis: null, activeAnalysisRequest: null } };
}
it("reads saved capture source before one opted-in native generation request", async () => {
  const { analysis, detail } = captured();
  const event = { ...contractFixtures.completedEvent, analysis };
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(Response.json(detail))
    .mockResolvedValueOnce(
      new Response(`event: analysis\nid: 1\ndata: ${JSON.stringify(event)}\n\n`, {
        headers: { "Content-Type": "text/event-stream" },
      }),
    );
  expect(
    await collect(
      createWebStudyCaptureApi(options(fetch)).analyzeCapture(
        "capture-1",
        { expectedRevision: 1, intent: "initial" },
        "capture-native",
      ),
    ),
  ).toEqual([event]);
  const post = fetch.mock.calls.filter(([, init]) => init?.method === "POST");
  expect(post).toHaveLength(1);
  expect(JSON.parse(String(post[0]?.[1]?.body))).toEqual({
    expectedRevision: 1,
    intent: "initial",
    outputContract: "structured-teaching-v1",
  });
  expect(new Headers(post[0]?.[1]?.headers).get("Accept")).toBe(
    structuredTeachingAccept.eventStream,
  );
});
it("rejects a foreign capture read without submitting anything", async () => {
  const { detail } = captured();
  detail.capture.id = "foreign";
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json(detail));
  await expect(
    collect(
      createWebStudyCaptureApi(options(fetch)).analyzeCapture(
        "capture-1",
        { expectedRevision: 1, intent: "initial" },
        "capture-native",
      ),
    ),
  ).rejects.toMatchObject({ code: "invalid_response" });
  expect(fetch.mock.calls.every(([, init]) => init?.method !== "POST")).toBe(true);
});
it("binds detail and confirmed records to the requested ID", async () => {
  const native = nativeWebAnalysis();
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(Response.json(native))
    .mockResolvedValueOnce(
      Response.json({ ...contractFixtures.confirmCandidatesResponse, analysis: native }),
    );
  const api = createWebAnalysisApi(options(fetch));
  await expect(api.getAnalysis("wrong-id")).rejects.toMatchObject({ code: "invalid_response" });
  await expect(
    api.confirmCandidates(
      "wrong-id",
      confirmCandidatesRequestSchema.parse(contractFixtures.confirmCandidatesRequest),
      "confirm-native",
    ),
  ).rejects.toMatchObject({ code: "invalid_response" });
  expect(new Headers(fetch.mock.calls[1]?.[1]?.headers).get("Accept")).toBe(
    structuredTeachingAccept.json,
  );
});
it("restores one native task snapshot through GET while legacy practice keeps its existing factory", async () => {
  const { analysis } = captured();
  const output = { ...contractFixtures.completedEvent, analysis };
  const task: LearningTaskSnapshotRead = {
    version: 2,
    id: "task-1",
    kind: "capture-analysis",
    subjectId: "capture-1",
    state: "completed",
    cursor: 0,
    createdAt: analysis.createdAt,
    updatedAt: analysis.updatedAt,
    error: null,
    timings: {},
    output,
  };
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(
      new Response(`event: task-status\ndata: ${JSON.stringify(task)}\n\n`, {
        headers: { "Content-Type": "text/event-stream" },
      }),
    )
    .mockResolvedValueOnce(Response.json(task));
  expect(await collect(createWebStructuredLearningTasks(options(fetch)).watch(task.id))).toEqual([
    output,
  ]);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch.mock.calls[0]?.[1]?.method).toBe("GET");
  expect(new Headers(fetch.mock.calls[0]?.[1]?.headers).get("Accept")).toBe(
    structuredTeachingAccept.eventStream,
  );
  expect(await createWebStructuredLearningTasks(options(fetch)).get(task.id)).toEqual(task);
  expect(new Headers(fetch.mock.calls[1]?.[1]?.headers).get("Accept")).toBe(
    structuredTeachingAccept.json,
  );
  const oldFetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValue(Response.json({ ...task, output: contractFixtures.completedEvent }));
  await createWebLearningTasks(options(oldFetch)).get(task.id);
  expect(new Headers(oldFetch.mock.calls[0]?.[1]?.headers).get("Accept")).not.toBe(
    structuredTeachingAccept.json,
  );
});
it("keeps the original revision and key for a completed capture replay", async () => {
  const { analysis, detail } = captured();
  detail.capture.revision = 2;
  detail.capture.kind = "phrase";
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(Response.json(detail))
    .mockResolvedValueOnce(
      new Response(
        `event: analysis\nid: 1\ndata: ${JSON.stringify({ ...contractFixtures.completedEvent, analysis })}\n\n`,
        { headers: { "Content-Type": "text/event-stream" } },
      ),
    );
  expect(
    await collect(
      createWebStudyCaptureApi(options(fetch)).analyzeCapture(
        "capture-1",
        { expectedRevision: 1, intent: "initial" },
        "same-key",
      ),
    ),
  ).toHaveLength(1);
  const post = fetch.mock.calls[1]?.[1];
  expect(JSON.parse(String(post?.body))).toMatchObject({ expectedRevision: 1 });
  expect(new Headers(post?.headers).get("Idempotency-Key")).toBe("same-key");
  expect(fetch.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
});
it("rejects foreign request status on both analysis recovery paths", async () => {
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockImplementation(async () =>
      Response.json({ state: "completed", requestId: "foreign-request", analysisId: "analysis-1" }),
    );
  await expect(
    createWebAnalysisApi(options(fetch)).getRequestStatus("expected-request"),
  ).rejects.toMatchObject({ code: "invalid_response" });
  await expect(
    createWebStudyCaptureApi(options(fetch)).getAnalysisRequestStatus("expected-request"),
  ).rejects.toMatchObject({ code: "invalid_response" });
  expect(fetch.mock.calls.every(([, init]) => init?.method !== "POST")).toBe(true);
});
