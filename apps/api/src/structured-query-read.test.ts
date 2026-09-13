import {
  extensionQueryEventSchema,
  extensionQueryEventReadSchema,
  extensionQueryGenerationSchema,
  structuredTeachingAccept,
} from "@huayi/cloud-contracts";
import { describe, expect, it, vi } from "vitest";
import { createExtensionQueryApp } from "./extension-query-app.js";
import { structuredQueryFixture } from "./test-support/structured-query-fixture.js";
import { FakeAnalysisQuota } from "./test-support/analysis-fakes.js";

describe("structured query HTTP read projection", () => {
  it.each([
    ["text/event-stream;version=2", "query.preview-v2"],
    [structuredTeachingAccept.eventStream, "query.preview-v2"],
    ["text/event-stream;version=20", "query.preview"],
    ["application/json;version=2", "query.preview"],
    ["text/event-stream;version=2;q=0", "query.preview"],
    ["text/event-stream;version=2;version=20", "query.preview"],
    ["text/event-stream;version=2,text/event-stream;version=2;q=0", "query.preview"],
    ["text/event-stream;profile=unknown;version=2", "query.preview"],
  ])("negotiates the old preview version exactly for %s", async (accept, type) => {
    const preview = extensionQueryEventSchema.parse({
      type: "query.preview-v2",
      version: 2,
      generationId: "generation-1",
      update: {
        type: "delta",
        requestId: "generation-1",
        section: "main-structure",
        sequence: 8,
        text: "We can.",
      },
    });
    const app = createExtensionQueryApp({
      authenticate: () => "owner",
      module: {
        get: async () => null,
        prepare: async () =>
          (async function* () {
            yield preview;
          })(),
      },
    });
    const response = await app.request("/v1/extension-queries:stream", {
      method: "POST",
      headers: { Accept: accept, "Content-Type": "application/json", "Idempotency-Key": "query" },
      body: JSON.stringify({
        action: "explain",
        selectionKind: "sentence",
        sourceText: "We can.",
        sourceType: "web-selection",
      }),
    });
    const line = (await response.text()).split("\n").find((line) => line.startsWith("data: "));
    if (!line) throw new Error("Missing preview");
    expect(extensionQueryEventSchema.parse(JSON.parse(line.slice(6)) as unknown)).toMatchObject({
      type,
    });
  });

  it("returns capability-specific temporary details and complete SSE while retaining sequence and quota", async () => {
    const result = structuredQueryFixture();
    const unit = result.sentenceStructures[0];
    const quota = new FakeAnalysisQuota().summary();
    const events = [
      { type: "query.structure", generationId: "generation-1", sequence: 7, unit },
      { type: "query.completed", generationId: "generation-1", result, quota },
    ].map((value) => extensionQueryEventReadSchema.parse(value));
    const generation = {
      id: "generation-1",
      state: "completed" as const,
      result,
      createdAt: "2026-09-12T10:00:00Z",
      expiresAt: "2026-09-12T11:00:00Z",
    };
    const prepare = vi.fn(async () =>
      (async function* () {
        yield* events;
      })(),
    );
    const app = createExtensionQueryApp({
      authenticate: () => "owner",
      module: { get: async () => generation, prepare },
    });
    app.onError((_error, context) => context.json({ error: "rejected" }, 400));
    const old = extensionQueryGenerationSchema.parse(
      await (await app.request("/v1/extension-query-generations/generation-1")).json(),
    );
    expect(old).toMatchObject({ result: { type: "explain-sentence" } });
    expect(
      await (
        await app.request("/v1/extension-query-generations/generation-1", {
          headers: { Accept: structuredTeachingAccept.json },
        })
      ).json(),
    ).toEqual(generation);
    for (const accept of [
      undefined,
      structuredTeachingAccept.eventStream,
      `${structuredTeachingAccept.eventStream};q=0`,
    ]) {
      const response = await app.request("/v1/extension-queries:stream", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": "query",
          ...(accept === undefined ? {} : { Accept: accept }),
        },
        body: JSON.stringify({
          action: "explain",
          selectionKind: "sentence",
          sourceText: "We can.",
          sourceType: "web-selection",
        }),
      });
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(response.headers.get("vary")).toContain("Accept");
      const values = (await response.text())
        .split("\n")
        .filter((line) => line.startsWith("data: "))
        .map((line) => JSON.parse(line.slice(6)) as unknown);
      expect(values).toHaveLength(2);
      if (accept === structuredTeachingAccept.eventStream) expect(values).toEqual(events);
      else
        expect(values.map((value) => extensionQueryEventSchema.parse(value))).toMatchObject([
          { type: "query.preview", sequence: 7 },
          { type: "query.completed", result: { type: "explain-sentence" }, quota },
        ]);
    }
    const called = prepare.mock.calls.length;
    const nativeRequest = await app.request("/v1/extension-queries:stream", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": "new" },
      body: JSON.stringify({
        action: "explain",
        selectionKind: "sentence",
        sourceText: "We can.",
        sourceType: "web-selection",
        outputContract: "structured-teaching-v1",
      }),
    });
    expect(nativeRequest.status).toBe(200);
    expect(await nativeRequest.text()).toContain('"type":"query.completed"');
    expect(prepare).toHaveBeenCalledTimes(called + 1);
    expect(prepare).toHaveBeenLastCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({ outputContract: "structured-teaching-v1" }),
      }),
    );
  });
});
