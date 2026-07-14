import { describe, expect, it, vi } from "vitest";

import type { AnalyzeRequest } from "@huayi/protocol";

import { message } from "./openai-responses-events-test-fixtures.js";
import type { fixtures } from "./openai-responses-events-test-fixtures.js";
import {
  OpenAIResponsesClient,
  openAIResponsesClientLimitsForTest,
  type OpenAIFetch,
  type OpenAIFetchResponse,
  type OpenAIResponsesRequest,
} from "./openai-responses-client.js";
import { buildAnalysisPrompt } from "./prompt-builder.js";

const encoder = new TextEncoder();
const lexicalSchemaFixture = { additionalProperties: false, properties: {}, type: "object" };

function createAnalysisRequest(overrides: Partial<AnalyzeRequest> = {}): AnalyzeRequest {
  return {
    action: "translate",
    context: "The investigation was in its early stages.",
    requestId: "analysis-1",
    schemaVersion: 3,
    selection: "investigation",
    selectionKind: "word",
    sentenceContext: "The investigation was in its early stages.",
    targetLanguage: "zh-CN",
    type: "analyze",
    ...overrides,
  };
}

function createRequest(overrides: Partial<OpenAIResponsesRequest> = {}): OpenAIResponsesRequest {
  return {
    analysisRequest: createAnalysisRequest(),
    modelConfiguration: { effort: "none", model: "gpt-5.6-luna" },
    outputSchema: lexicalSchemaFixture,
    outputSchemaName: "translate_lexical",
    ...overrides,
  };
}

function sseMessage(eventName: keyof typeof fixtures): string {
  const event = message(eventName);
  return `event: ${event.event}\ndata: ${event.data}\n\n`;
}

function eventStreamResponse(source = sseMessage("response.created")): Response {
  return new Response(source, {
    headers: { "content-type": "text/event-stream; charset=utf-8" },
    status: 200,
  });
}

async function collect(client: OpenAIResponsesClient, request = createRequest()) {
  const events = [];
  for await (const event of client.stream(
    request,
    "secret-sentinel",
    new AbortController().signal,
  )) {
    events.push(event);
  }
  return events;
}

describe("OpenAIResponsesClient", () => {
  it("posts only the fixed official streaming request shape", async () => {
    const fetch = vi.fn<OpenAIFetch>().mockResolvedValue(eventStreamResponse());
    const request = createRequest();
    const client = new OpenAIResponsesClient({ fetch });

    await collect(client, request);

    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = fetch.mock.calls[0] ?? [];
    expect(url).toBe("https://api.openai.com/v1/responses");
    expect(init?.method).toBe("POST");
    expect(init?.redirect).toBe("error");
    expect(init?.credentials).toBe("omit");
    const headers = new Headers(init?.headers);
    expect(headers.get("Authorization")).toBe("Bearer secret-sentinel");
    expect(headers.get("Accept")).toBe("text/event-stream");
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(headers.has("Cookie")).toBe(false);
    expect(JSON.parse(String(init?.body))).toEqual({
      input: buildAnalysisPrompt(request.analysisRequest),
      model: "gpt-5.6-luna",
      reasoning: { effort: "none" },
      store: false,
      stream: true,
      text: {
        format: {
          name: "translate_lexical",
          schema: lexicalSchemaFixture,
          strict: true,
          type: "json_schema",
        },
      },
    });
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    for (const forbidden of [
      "tools",
      "previous_response_id",
      "url",
      "title",
      "eudic",
      "endpoint",
    ]) {
      expect(body).not.toHaveProperty(forbidden);
    }
  });

  it("decodes typed SSE events across response chunks", async () => {
    const source = encoder.encode(
      sseMessage("response.created") + sseMessage("response.in_progress"),
    );
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const byte of source) controller.enqueue(Uint8Array.of(byte));
        controller.close();
      },
    });
    const client = new OpenAIResponsesClient({
      fetch: async () =>
        new Response(body, {
          headers: { "content-type": "text/event-stream" },
          status: 200,
        }),
    });

    await expect(collect(client)).resolves.toEqual([
      { responseId: "resp_test", status: "in_progress", type: "response.created" },
      { responseId: "resp_test", status: "in_progress", type: "response.in_progress" },
    ]);
  });

  it.each([
    [401, {}, "MODEL_PROVIDER_AUTH_FAILED"],
    [429, { error: { code: "insufficient_quota" } }, "QUOTA_EXCEEDED"],
    [429, { error: { code: "rate_limit_exceeded" } }, "RATE_LIMITED"],
    [503, {}, "NETWORK_ERROR"],
    [500, {}, "INTERNAL_ERROR"],
    [400, {}, "INVALID_RESPONSE"],
  ] as const)("maps HTTP %i to %s", async (status, errorBody, code) => {
    const client = new OpenAIResponsesClient({
      fetch: async () =>
        new Response(JSON.stringify(errorBody), {
          headers: { "content-type": "application/json" },
          status,
        }),
    });

    await expect(collect(client)).rejects.toMatchObject({ code });
  });

  it("bounds non-success bodies before classifying their contents", async () => {
    const cancel = vi.fn(async () => undefined);
    const body = {
      getReader: () => ({
        cancel,
        read: vi
          .fn()
          .mockResolvedValueOnce({
            done: false,
            value: new Uint8Array(openAIResponsesClientLimitsForTest().errorBodyBytes + 1),
          })
          .mockResolvedValue({ done: true }),
      }),
    } as unknown as NonNullable<Response["body"]>;
    const response: OpenAIFetchResponse = {
      body,
      headers: new Headers({ "content-type": "application/json" }),
      status: 429,
    };
    const client = new OpenAIResponsesClient({ fetch: async () => response });

    await expect(collect(client)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it.each([
    [
      new Response("", { headers: { "content-type": "application/json" }, status: 200 }),
      "wrong content type",
    ],
    [
      { body: null, headers: new Headers({ "content-type": "text/event-stream" }), status: 200 },
      "missing body",
    ],
    [new Response("", { status: 302 }), "returned redirect"],
  ] as const)("rejects a success response with %s", async (response, label) => {
    void label;
    const client = new OpenAIResponsesClient({ fetch: async () => response });

    await expect(collect(client)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("cancels a response body rejected for the wrong content type", async () => {
    const cancel = vi.fn(async () => undefined);
    const response: OpenAIFetchResponse = {
      body: { cancel } as unknown as NonNullable<Response["body"]>,
      headers: new Headers({ "content-type": "application/json" }),
      status: 200,
    };
    const client = new OpenAIResponsesClient({ fetch: async () => response });

    await expect(collect(client)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("does not retry rejected network or redirect fetches", async () => {
    for (const [failure, code] of [
      [new TypeError("fetch failed: private host"), "NETWORK_ERROR"],
      [
        new TypeError("fetch failed", { cause: new Error("unexpected redirect to private host") }),
        "INVALID_RESPONSE",
      ],
    ] as const) {
      const fetch = vi.fn<OpenAIFetch>().mockRejectedValue(failure);
      const client = new OpenAIResponsesClient({ fetch });

      const error = await collect(client).catch((reason: unknown) => reason);
      expect(error).toMatchObject({ code });
      expect(String(error)).not.toContain("private host");
      expect(fetch).toHaveBeenCalledOnce();
    }
  });

  it("maps external cancellation while fetch is pending", async () => {
    const fetch = vi.fn<OpenAIFetch>(
      async (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener("abort", () => reject(new TypeError("aborted")), {
            once: true,
          });
        }),
    );
    const controller = new AbortController();
    const client = new OpenAIResponsesClient({ fetch });
    const pending = collectWithSignal(client, controller.signal);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());

    controller.abort();

    await expect(pending).rejects.toMatchObject({ code: "CANCELLED" });
  });

  it("maps its internal 60-second deadline and clears the timer", async () => {
    vi.useFakeTimers();
    try {
      const fetch = vi.fn<OpenAIFetch>(
        async (_url, init) =>
          new Promise((_resolve, reject) => {
            init.signal.addEventListener("abort", () => reject(new TypeError("aborted")), {
              once: true,
            });
          }),
      );
      const client = new OpenAIResponsesClient({ fetch });
      const pending = collect(client);
      const assertion = expect(pending).rejects.toMatchObject({ code: "TIMEOUT" });

      await vi.advanceTimersByTimeAsync(60_000);

      await assertion;
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects a late chunk returned after external abort and cancels the reader", async () => {
    let resolveRead: ((result: ReadableStreamReadResult<Uint8Array>) => void) | undefined;
    const cancel = vi.fn(async () => undefined);
    const reader = {
      cancel,
      read: () =>
        new Promise<ReadableStreamReadResult<Uint8Array>>((resolve) => {
          resolveRead = resolve;
        }),
    };
    const response: OpenAIFetchResponse = {
      body: { getReader: () => reader } as unknown as NonNullable<Response["body"]>,
      headers: new Headers({ "content-type": "text/event-stream" }),
      status: 200,
    };
    const controller = new AbortController();
    const client = new OpenAIResponsesClient({ fetch: async () => response });
    const pending = collectWithSignal(client, controller.signal);
    await vi.waitFor(() => expect(resolveRead).toBeTypeOf("function"));

    controller.abort();
    resolveRead?.({ done: false, value: encoder.encode(sseMessage("response.created")) });

    await expect(pending).rejects.toMatchObject({ code: "CANCELLED" });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("removes its timeout after a completed response stream", async () => {
    vi.useFakeTimers();
    try {
      const client = new OpenAIResponsesClient({ fetch: async () => eventStreamResponse() });
      await collect(client);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

async function collectWithSignal(client: OpenAIResponsesClient, signal: AbortSignal) {
  const events = [];
  for await (const event of client.stream(createRequest(), "secret-sentinel", signal)) {
    events.push(event);
  }
  return events;
}
