import { describe, expect, it, vi } from "vitest";
import {
  assembleSentenceStructure,
  sentenceExplanationV2ResultSchema,
} from "./learning-domain-exports.js";
import { quotaSummarySchema } from "./common-contracts.js";
import { learningTaskSnapshotReadSchema } from "./structured-learning-tasks.js";
import { structuredTeachingAccept } from "./structured-teaching-requests.js";
import { createStructuredLearningTaskClient } from "./structured-task-client.js";

const id = "10000000-0000-4000-8000-000000000001";
const unit = {
  analysisUnitId: "u1",
  ordinal: 0,
  sourceText: "Go.",
  sentenceStructure: assembleSentenceStructure("Go.", {
    kind: "sentence",
    coreClauses: [{ fragments: [{ text: "Go", occurrence: 1 }], explanationZh: "要求行动。" }],
    modifiers: [],
  }),
};
const quota = quotaSummarySchema.parse({
  limitMicroUsd: 100,
  usedMicroUsd: 20,
  reservedMicroUsd: 0,
  availableMicroUsd: 80,
  percentUsed: 20,
  warning: "available",
  periodStart: "2026-09-01T00:00:00Z",
  periodEnd: "2026-10-01T00:00:00Z",
});
const result = sentenceExplanationV2ResultSchema.parse({
  type: "explain-sentence-v2",
  selectionKind: "sentence",
  requestId: id,
  sourceText: "  Go.\r\n",
  translationZh: "走吧。",
  contextRole: "提出要求。",
  keyExpressions: [{ text: "Go", meaningZh: "走" }],
  sentenceStructures: [unit],
});
const completed = { type: "query.completed", generationId: id, result, quota };
function snapshot(state: "running" | "completed", cursor = 1) {
  return learningTaskSnapshotReadSchema.parse({
    version: 2,
    id,
    kind: "instant-query",
    subjectId: null,
    state,
    cursor,
    createdAt: "2026-09-13T00:00:00Z",
    updatedAt: "2026-09-13T00:00:00Z",
    error: null,
    timings: {},
    output: state === "completed" ? completed : null,
  });
}
const structure = {
  version: 2,
  taskId: id,
  cursor: 1,
  payload: { type: "query.structure", generationId: id, sequence: 0, unit },
};
const event = (value: unknown, cursor = 1) =>
  `event: learning-task\nid: ${cursor}\ndata: ${JSON.stringify(value)}\n\n`;
const status = (value: unknown) => `event: task-status\ndata: ${JSON.stringify(value)}\n\n`;
const stream = (text: string) =>
  new Response(text, { headers: { "Content-Type": "text/event-stream" } });

describe("explicit structured task client", () => {
  it("negotiates every JSON operation and preserves opt-in raw input", async () => {
    const request = vi.fn(async (path: string, init: RequestInit) =>
      Response.json(
        path === "/v2/learning-tasks" && init.method === "GET"
          ? [snapshot("completed")]
          : snapshot("completed"),
      ),
    );
    const client = createStructuredLearningTaskClient({ request });
    const command = {
      version: 2 as const,
      kind: "instant-query" as const,
      input: {
        action: "explain" as const,
        selectionKind: "sentence" as const,
        sourceType: "web-selection" as const,
        sourceText: "  Go.\r\n",
        outputContract: "structured-teaching-v1" as const,
      },
    };
    expect((await client.submit(command, "native-key")).output).toEqual(completed);
    expect((await client.get(id)).output).toEqual(completed);
    expect((await client.list())[0]?.output).toEqual(completed);
    expect((await client.cancel(id)).output).toEqual(completed);
    for (const call of request.mock.calls)
      expect(new Headers(call[1]?.headers).get("Accept")).toBe(structuredTeachingAccept.json);
    expect(JSON.parse(String(request.mock.calls[0]?.[1]?.body))).toEqual(command);
    expect(new Headers(request.mock.calls[0]?.[1]?.headers).get("Idempotency-Key")).toBe(
      "native-key",
    );
  });

  it("resumes stored cursors and recovers native completion from the authoritative snapshot without resubmission", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(stream(event(structure) + status(snapshot("running"))))
      .mockResolvedValueOnce(stream(event(structure) + status(snapshot("completed"))));
    const client = createStructuredLearningTaskClient({ request });
    const values = [];
    for await (const value of client.watch(id)) values.push(value);
    expect(values).toEqual([structure.payload, completed]);
    expect(request.mock.calls.map(([path]) => path)).toEqual([
      `/v2/learning-tasks/${id}/events?cursor=0`,
      `/v2/learning-tasks/${id}/events?cursor=1`,
    ]);
    for (const [, init] of request.mock.calls) {
      expect(init.method).toBe("GET");
      expect(new Headers(init.headers).get("Accept")).toBe(structuredTeachingAccept.eventStream);
    }
  });

  it("rejects invalid native source references and cursor gaps without a fallback generation", async () => {
    for (const bad of [
      { ...structure, cursor: 2 },
      { ...structure, payload: { ...structure.payload, unit: { ...unit, sourceText: "No." } } },
    ]) {
      const request = vi
        .fn()
        .mockResolvedValue(
          stream(event(bad, bad.cursor) + status(snapshot("completed", bad.cursor))),
        );
      const collect = async () => {
        for await (const value of createStructuredLearningTaskClient({ request }).watch(id))
          void value;
      };
      await expect(collect()).rejects.toMatchObject({ code: "invalid_response" });
      expect(request).toHaveBeenCalledTimes(1);
    }
  });
});
