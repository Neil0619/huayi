import { describe, expect, it, vi } from "vitest";

import { createCloudExtensionQueryApi } from "./cloud-extension-query-api.js";

const quota = {
  availableMicroUsd: 900,
  limitMicroUsd: 1_000,
  percentUsed: 10,
  periodEnd: "2026-09-01T00:00:00.000Z",
  periodStart: "2026-08-01T00:00:00.000Z",
  reservedMicroUsd: 0,
  usedMicroUsd: 100,
  warning: "available",
};

function stream(events: readonly unknown[]): Response {
  const body = events
    .map((event, index) => `event: query\ndata: ${JSON.stringify(event)}\nid: ${index + 1}\n\n`)
    .join("");
  return new Response(body, { headers: { "Content-Type": "text/event-stream" } });
}

describe("cloud ExtensionQuery API", () => {
  it("sends only the strict query intent and parses the bounded stream", async () => {
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      void input;
      void init;
      return stream([
        { generationId: "generation-1", type: "query.started" },
        {
          generationId: "generation-1",
          quota,
          result: {
            contextRole: "谓语",
            keyExpressions: [{ meaningZh: "落空", text: "fell through" }],
            mainStructure: "主语 + 谓语",
            requestId: "generation-1",
            selectionKind: "sentence",
            sourceText: "The plan fell through.",
            translationZh: "计划落空了。",
            type: "explain-sentence",
          },
          type: "query.completed",
        },
      ]);
    });
    const api = createCloudExtensionQueryApi({
      apiOrigin: "https://api.huayi.example",
      clientVersion: "1.0.0",
      fetch,
    });

    const events = [];
    for await (const event of api.start(
      {
        action: "explain",
        selectionKind: "sentence",
        sourceText: "The plan fell through.",
        sourceType: "web-selection",
      },
      "query-key-1",
      "s".repeat(32),
    )) {
      events.push(event);
    }

    expect(events.map((event) => event.type)).toEqual(["query.started", "query.completed"]);
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(String(url)).toBe("https://api.huayi.example/v1/extension-queries:stream");
    expect(JSON.parse(String(init?.body))).toEqual({
      action: "explain",
      selectionKind: "sentence",
      sourceText: "The plan fell through.",
      sourceType: "web-selection",
    });
    expect(init?.headers).toMatchObject({
      Authorization: `HuayiExtension ${"s".repeat(32)}`,
      "Idempotency-Key": "query-key-1",
    });
  });

  it("forwards cancellation and rejects malformed or incomplete streams", async () => {
    const signal = new AbortController().signal;
    const fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.signal).toBe(signal);
      return new Response('event: query\nid: 1\ndata: {"type":"query.started"}', {
        headers: { "Content-Type": "text/event-stream" },
      });
    });
    const api = createCloudExtensionQueryApi({
      apiOrigin: "https://api.huayi.example",
      clientVersion: "1.0.0",
      fetch,
    });

    const consume = async () => {
      for await (const event of api.start(
        {
          action: "translate",
          selectionKind: "phrase",
          sentenceContext: "It fell through yesterday.",
          sourceText: "fell through",
          sourceType: "web-selection",
        },
        "query-key-2",
        "s".repeat(32),
        signal,
      )) {
        void event;
      }
    };
    await expect(consume()).rejects.toThrow("Incomplete ExtensionQuery event stream");
  });
});
