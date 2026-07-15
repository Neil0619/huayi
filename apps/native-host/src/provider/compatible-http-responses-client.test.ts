import { describe, expect, it, vi } from "vitest";

import type { AnalyzeRequest } from "@huayi/protocol";

import {
  compatibleMessage,
  createdFixture,
  inProgressFixture,
} from "./compatible-http-responses-events-test-fixtures.js";
import {
  CompatibleHttpResponsesClient,
  compatibleHttpResponsesClientLimitsForTest,
  type CompatibleHttpFetch,
  type CompatibleHttpFetchResponse,
} from "./compatible-http-responses-client.js";
import type { ResponsesRequest } from "./responses-request-body.js";

const encoder = new TextEncoder();

function request(): ResponsesRequest {
  const analysisRequest: AnalyzeRequest = {
    action: "translate",
    context: "The investigation was in its early stages.",
    requestId: "analysis-1",
    schemaVersion: 4,
    selection: "investigation",
    selectionKind: "word",
    sentenceContext: "The investigation was in its early stages.",
    targetLanguage: "zh-CN",
    type: "analyze",
  };
  return {
    analysisRequest,
    modelConfiguration: { effort: "low", model: "gpt-5.4-mini" },
    outputSchema: { additionalProperties: false, properties: {}, type: "object" },
    outputSchemaName: "translate_lexical",
  };
}

function sse(event: string, value: unknown): string {
  const message = compatibleMessage(event, value);
  return `event: ${message.event}\ndata: ${message.data}\n\n`;
}

function eventStream(source = sse("response.created", createdFixture)): Response {
  return new Response(source, {
    headers: { "content-type": "text/event-stream; charset=utf-8" },
    status: 200,
  });
}

async function collect(
  client: CompatibleHttpResponsesClient,
  signal = new AbortController().signal,
) {
  const events = [];
  for await (const event of client.stream(
    request(),
    "fake-compatible-key",
    "http://101.133.153.118:9090/v1",
    signal,
  )) {
    events.push(event);
  }
  return events;
}

describe("CompatibleHttpResponsesClient", () => {
  it("posts once to the configured base with the bounded streaming request", async () => {
    const fetch = vi.fn<CompatibleHttpFetch>().mockResolvedValue(eventStream());
    const client = new CompatibleHttpResponsesClient({ fetch });

    await collect(client);

    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe("http://101.133.153.118:9090/v1/responses");
    expect(init).toMatchObject({ credentials: "omit", method: "POST", redirect: "error" });
    expect(new Headers(init?.headers)).toEqual(
      new Headers({
        Accept: "text/event-stream",
        Authorization: "Bearer fake-compatible-key",
        "Content-Type": "application/json",
      }),
    );
    expect(new Headers(init?.headers).has("Cookie")).toBe(false);
    expect(JSON.parse(String(init?.body))).not.toHaveProperty("tools");
    expect(JSON.parse(String(init?.body))).not.toHaveProperty("previous_response_id");
  });

  it("decodes UTF-8 and SSE boundaries split across chunks", async () => {
    const source = encoder.encode(
      sse("response.created", createdFixture) + sse("response.in_progress", inProgressFixture),
    );
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const byte of source) controller.enqueue(Uint8Array.of(byte));
        controller.close();
      },
    });
    const client = new CompatibleHttpResponsesClient({
      fetch: async () =>
        new Response(body, { headers: { "content-type": "text/event-stream" }, status: 200 }),
    });

    await expect(collect(client)).resolves.toEqual([
      { responseId: "resp_compatible_test", sequence: 0, type: "response.created" },
      { responseId: "resp_compatible_test", sequence: 1, type: "response.in_progress" },
    ]);
  });

  it.each([
    [401, "MODEL_PROVIDER_AUTH_FAILED"],
    [403, "RATE_LIMITED"],
    [429, "RATE_LIMITED"],
    [502, "NETWORK_ERROR"],
    [503, "NETWORK_ERROR"],
    [504, "NETWORK_ERROR"],
    [400, "INVALID_RESPONSE"],
    [404, "INVALID_RESPONSE"],
    [500, "INVALID_RESPONSE"],
    [302, "INVALID_RESPONSE"],
  ] as const)("maps HTTP %i to %s without retry", async (status, code) => {
    const fetch = vi.fn<CompatibleHttpFetch>().mockResolvedValue(new Response("{}", { status }));
    const client = new CompatibleHttpResponsesClient({ fetch });

    await expect(collect(client)).rejects.toMatchObject({ code });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it.each([
    [new Response("", { headers: { "content-type": "application/json" }, status: 200 })],
    [{ body: null, headers: new Headers({ "content-type": "text/event-stream" }), status: 200 }],
  ])("rejects malformed success responses", async (response) => {
    const client = new CompatibleHttpResponsesClient({ fetch: async () => response });
    await expect(collect(client)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("bounds non-success response bodies before mapping status", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          new Uint8Array(compatibleHttpResponsesClientLimitsForTest().errorBodyBytes + 1),
        );
        controller.close();
      },
    });
    const response: CompatibleHttpFetchResponse = {
      body: body as NonNullable<Response["body"]>,
      headers: new Headers({ "content-type": "application/json" }),
      status: 429,
    };
    const client = new CompatibleHttpResponsesClient({ fetch: async () => response });
    await expect(collect(client)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("does not retry network failures or redirect rejections", async () => {
    for (const [failure, code] of [
      [new TypeError("fetch failed"), "NETWORK_ERROR"],
      [
        new TypeError("fetch failed", { cause: new Error("unexpected redirect") }),
        "INVALID_RESPONSE",
      ],
    ] as const) {
      const fetch = vi.fn<CompatibleHttpFetch>().mockRejectedValue(failure);
      const client = new CompatibleHttpResponsesClient({ fetch });
      await expect(collect(client)).rejects.toMatchObject({ code });
      expect(fetch).toHaveBeenCalledOnce();
    }
  });

  it("propagates external cancellation while fetch is pending", async () => {
    const fetch = vi.fn<CompatibleHttpFetch>(
      async (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener("abort", () => reject(new TypeError("aborted")), {
            once: true,
          });
        }),
    );
    const controller = new AbortController();
    const pending = collect(new CompatibleHttpResponsesClient({ fetch }), controller.signal);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: "CANCELLED" });
  });

  it("maps its internal deadline to timeout", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn<CompatibleHttpFetch>(
      async (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener("abort", () => reject(new TypeError("aborted")), {
            once: true,
          });
        }),
    );
    try {
      const pending = collect(new CompatibleHttpResponsesClient({ fetch })).catch(
        (error: unknown) => error,
      );
      await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
      await vi.advanceTimersByTimeAsync(compatibleHttpResponsesClientLimitsForTest().timeoutMs);
      await expect(pending).resolves.toMatchObject({ code: "TIMEOUT" });
    } finally {
      vi.useRealTimers();
    }
  });
});
