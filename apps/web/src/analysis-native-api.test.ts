import { expect, it, vi } from "vitest";
import { contractFixtures, structuredTeachingAccept } from "@huayi/cloud-contracts";
import { createWebAnalysisApi } from "./analysis-api.js";
import { nativeWebAnalysis } from "./native-analysis.test-support.js";

const options = (fetch: typeof globalThis.fetch) => ({
  apiOrigin: "https://api.fixture.invalid",
  csrfToken: async () => "offline-csrf",
  fetch,
});
it("reads native history, detail and every analysis mutation with explicit capability", async () => {
  const record = nativeWebAnalysis();
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(Response.json({ items: [record], nextCursor: null }))
    .mockResolvedValueOnce(Response.json({ items: [record], nextCursor: null }))
    .mockResolvedValueOnce(Response.json(record))
    .mockResolvedValueOnce(Response.json(record))
    .mockResolvedValueOnce(Response.json(record))
    .mockResolvedValueOnce(Response.json(record));
  const api = createWebAnalysisApi(options(fetch));
  expect((await api.listPending()).items[0]).toEqual(record);
  expect((await api.listHistory({ limit: 10, archived: false })).items[0]).toEqual(record);
  expect(await api.getAnalysis(record.id)).toEqual(record);
  expect(await api.archiveAnalysis(record.id, 1, "archive")).toEqual(record);
  expect(await api.restoreAnalysis(record.id, 1, "restore")).toEqual(record);
  expect(await api.processNothingToSave(record.id, 1, "process")).toEqual(record);
  for (const [, init] of fetch.mock.calls)
    expect(new Headers(init?.headers).get("Accept")).toBe(structuredTeachingAccept.json);
});

it("opts in to native generation and consumes structured units and terminal result", async () => {
  const record = nativeWebAnalysis();
  if (record.result.type !== "sentence-passage-analysis-v3")
    throw new Error("Expected sentence fixture.");
  const sentence = record.result.sentences[0];
  if (!sentence) throw new Error("Missing first unit.");
  const requestId = "30000000-0000-4000-8000-000000000001";
  const events = [
    {
      type: "analysis.structure",
      requestId,
      unit: {
        analysisUnitId: sentence.analysisUnitId,
        ordinal: 0,
        sourceText: sentence.sourceText,
        sentenceStructure: sentence.sentenceStructure,
      },
    },
    { type: "analysis.completed", quota: contractFixtures.completedEvent.quota, analysis: record },
  ];
  const body = events
    .map((data, index) => `event: analysis\nid: ${index + 1}\ndata: ${JSON.stringify(data)}\n\n`)
    .join("");
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValue(new Response(body, { headers: { "Content-Type": "text/event-stream" } }));
  const api = createWebAnalysisApi(options(fetch));
  const received = [];
  for await (const event of api.startAnalysis(
    { sourceText: record.sourceText, selectionKind: "passage", source: { type: "manual" } },
    "native-start",
  ))
    received.push(event);
  expect(received).toEqual(events);
  const init = fetch.mock.calls[0]?.[1];
  expect(new Headers(init?.headers).get("Accept")).toBe(structuredTeachingAccept.eventStream);
  expect(JSON.parse(String(init?.body))).toMatchObject({
    sourceText: record.sourceText,
    outputContract: "structured-teaching-v1",
  });
  expect(fetch).toHaveBeenCalledTimes(1);
});
