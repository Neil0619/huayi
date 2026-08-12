import type {
  AnalysisRequest,
  AnalysisUpdate,
  CredentialSlot,
  DeviceVault,
} from "@huayi/store-domain";
import { describe, expect, it, vi } from "vitest";

import { BrowserAnalysisEngine } from "./browser-analysis-engine.js";
import type { ProviderFetch, ProviderFetchInit } from "./bounded-provider-stream.js";
import {
  DEEPSEEK_CHAT_ENDPOINT,
  DEEPSEEK_MODEL,
  OPENAI_MODEL,
  OPENAI_RESPONSES_ENDPOINT,
} from "./provider-requests.js";

const encoder = new TextEncoder();

function request(providerId: AnalysisRequest["providerId"]): AnalysisRequest {
  return {
    action: "translate",
    context: "A friendly greeting.",
    providerId,
    requestId: "request-1",
    selection: "Hello world.",
    selectionKind: "sentence",
    sentenceContext: "Hello world.",
    targetLanguage: "zh-CN",
  };
}

function vault(credentials: Partial<Record<CredentialSlot, string>> = {}): DeviceVault {
  return {
    deleteCredential: async () => undefined,
    ensureReady: async () => undefined,
    getDek: async () => new Uint8Array(32),
    getCredential: async (slot) => credentials[slot] ?? null,
    getReadiness: async () => "ready",
    migrateLegacy: async () => undefined,
    setCredential: async () => undefined,
  };
}

function response(chunks: readonly Uint8Array[]): Awaited<ReturnType<ProviderFetch>> {
  return {
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
        controller.close();
      },
    }),
    headers: new Headers({ "Content-Type": "text/event-stream; charset=utf-8" }),
    status: 200,
  };
}

function sse(event: string | undefined, data: unknown): string {
  return [
    ...(event === undefined ? [] : [`event: ${event}`]),
    `data: ${typeof data === "string" ? data : JSON.stringify(data)}`,
    "",
    "",
  ].join("\n");
}

function openAiStream(text: string): string {
  const part = { annotations: [], text, type: "output_text" };
  const doneItem = {
    content: [part],
    id: "item-1",
    role: "assistant",
    status: "completed",
    type: "message",
  };
  return [
    sse("response.created", {
      response: {
        error: null,
        id: "response-1",
        incomplete_details: null,
        output: [],
        status: "in_progress",
      },
      sequence_number: 0,
      type: "response.created",
    }),
    sse("response.in_progress", {
      response: {
        error: null,
        id: "response-1",
        incomplete_details: null,
        output: [],
        status: "in_progress",
      },
      sequence_number: 1,
      type: "response.in_progress",
    }),
    sse("response.output_item.added", {
      item: {
        content: [],
        id: "item-1",
        role: "assistant",
        status: "in_progress",
        type: "message",
      },
      output_index: 0,
      sequence_number: 2,
      type: "response.output_item.added",
    }),
    sse("response.content_part.added", {
      content_index: 0,
      item_id: "item-1",
      output_index: 0,
      part: { annotations: [], text: "", type: "output_text" },
      sequence_number: 3,
      type: "response.content_part.added",
    }),
    sse("response.output_text.delta", {
      content_index: 0,
      delta: text,
      item_id: "item-1",
      output_index: 0,
      sequence_number: 4,
      type: "response.output_text.delta",
    }),
    sse("response.output_text.done", {
      content_index: 0,
      item_id: "item-1",
      output_index: 0,
      sequence_number: 5,
      text,
      type: "response.output_text.done",
    }),
    sse("response.content_part.done", {
      content_index: 0,
      item_id: "item-1",
      output_index: 0,
      part,
      sequence_number: 6,
      type: "response.content_part.done",
    }),
    sse("response.output_item.done", {
      item: doneItem,
      output_index: 0,
      sequence_number: 7,
      type: "response.output_item.done",
    }),
    sse("response.completed", {
      response: {
        error: null,
        id: "response-1",
        incomplete_details: null,
        output: [doneItem],
        status: "completed",
      },
      sequence_number: 8,
      type: "response.completed",
    }),
  ].join("");
}

function deepSeekChunk(
  content: string | null,
  role: "assistant" | null,
  finishReason: string | null,
): string {
  return sse(undefined, {
    choices: [
      {
        delta: { content, reasoning_content: null, role },
        finish_reason: finishReason,
        index: 0,
        logprobs: null,
      },
    ],
    created: 1,
    id: "chat-1",
    model: DEEPSEEK_MODEL,
    object: "chat.completion.chunk",
  });
}

function deepSeekStream(text: string): string {
  const split = Math.floor(text.length / 2);
  return [
    deepSeekChunk("", "assistant", null),
    deepSeekChunk(text.slice(0, split), null, null),
    deepSeekChunk(text.slice(split), null, null),
    deepSeekChunk(null, null, "stop"),
    sse(undefined, "[DONE]"),
  ].join("");
}

async function analyze(
  providerId: AnalysisRequest["providerId"],
  fetch: ProviderFetch,
  options: {
    limits?: {
      eventBytes?: number;
      stallTimeoutMs?: number;
      timeoutMs?: number;
      totalBytes?: number;
    };
    vault?: DeviceVault;
  } = {},
): Promise<{
  result: Awaited<ReturnType<BrowserAnalysisEngine["analyze"]>>;
  updates: AnalysisUpdate[];
}> {
  const engine = new BrowserAnalysisEngine({
    deviceVault:
      options.vault ?? vault({ "deepseek-api-key": "deep-key", "openai-api-key": "open-key" }),
    fetch,
    ...(options.limits === undefined ? {} : { streamLimits: options.limits }),
  });
  const updates: AnalysisUpdate[] = [];
  const result = await engine.analyze(
    request(providerId),
    new AbortController().signal,
    (update) => {
      updates.push(update);
    },
  );
  return { result, updates };
}

describe("BrowserAnalysisEngine", () => {
  it("uses the exact OpenAI endpoint, credential slot, safe fetch options, and strict body", async () => {
    const fetch = vi.fn<ProviderFetch>(async () =>
      response([encoder.encode(openAiStream('{"translationZh":"你好，世界。"}'))]),
    );
    const result = await analyze("openai", fetch);

    expect(result.result).toEqual({
      requestId: "request-1",
      selectionKind: "sentence",
      sourceText: "Hello world.",
      translationZh: "你好，世界。",
      type: "translate-passage",
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [endpoint, init] = fetch.mock.calls[0] as [string, ProviderFetchInit];
    expect(endpoint).toBe(OPENAI_RESPONSES_ENDPOINT);
    expect(init).toMatchObject({ credentials: "omit", method: "POST", redirect: "error" });
    expect(init.headers.Authorization).toBe("Bearer open-key");
    expect(JSON.parse(init.body)).toMatchObject({
      model: OPENAI_MODEL,
      reasoning: { effort: "none" },
      store: false,
      stream: true,
      text: { format: { strict: true, type: "json_schema" } },
    });
    expect(result.updates).toEqual([
      { requestId: "request-1", stage: "queued", type: "progress" },
      { requestId: "request-1", stage: "running", type: "progress" },
      {
        requestId: "request-1",
        section: "translation",
        sequence: 0,
        text: "你好，世界。",
        type: "delta",
      },
    ]);
  });

  it("uses the pinned DeepSeek provider and handles fragmented UTF-8 SSE", async () => {
    const bytes = encoder.encode(deepSeekStream('{"translationZh":"你好🌍。"}'));
    const chunks = Array.from(bytes, (byte) => new Uint8Array([byte]));
    const fetch = vi.fn<ProviderFetch>(async () => response(chunks));
    const { result } = await analyze("deepseek", fetch);

    expect(result).toMatchObject({ translationZh: "你好🌍。", type: "translate-passage" });
    const [endpoint, init] = fetch.mock.calls[0] as [string, ProviderFetchInit];
    expect(endpoint).toBe(DEEPSEEK_CHAT_ENDPOINT);
    expect(init.headers.Authorization).toBe("Bearer deep-key");
    expect(JSON.parse(init.body)).toMatchObject({
      max_tokens: 4096,
      model: DEEPSEEK_MODEL,
      response_format: { type: "json_object" },
      stream: true,
      temperature: 0,
      thinking: { type: "disabled" },
    });
  });

  it.each([
    ["unknown event", sse("response.tool_call", {})],
    [
      "duplicate terminal",
      `${openAiStream('{"translationZh":"你好。"}')}${sse("response.completed", {})}`,
    ],
    [
      "missing terminal",
      openAiStream('{"translationZh":"你好。"}').split("event: response.completed")[0] ?? "",
    ],
    ["invalid JSON", openAiStream("not-json")],
    ["invalid schema", openAiStream('{"translationZh":"你好。","unexpected":true}')],
  ])("fails closed for %s without retry", async (_name, stream) => {
    const fetch = vi.fn<ProviderFetch>(async () => response([encoder.encode(stream)]));
    await expect(analyze("openai", fetch)).rejects.toMatchObject({ code: "invalid-response" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("reports missing credentials without making a request", async () => {
    const fetch = vi.fn<ProviderFetch>();
    await expect(analyze("openai", fetch, { vault: vault() })).rejects.toMatchObject({
      code: "credential-missing",
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("cancels before fetch and exposes no sensitive data in public errors", async () => {
    const fetch = vi.fn<ProviderFetch>();
    const controller = new AbortController();
    controller.abort();
    const engine = new BrowserAnalysisEngine({
      deviceVault: vault({ "openai-api-key": "secret-key" }),
      fetch,
    });
    await expect(
      engine.analyze(request("openai"), controller.signal, () => undefined),
    ).rejects.toMatchObject({ code: "cancelled", message: "Analysis was cancelled." });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("enforces event bounds and stall timeout with one provider attempt", async () => {
    const oversized = vi.fn<ProviderFetch>(async () =>
      response([encoder.encode(openAiStream('{"translationZh":"你好。"}'))]),
    );
    await expect(
      analyze("openai", oversized, { limits: { eventBytes: 32 } }),
    ).rejects.toMatchObject({ code: "invalid-response" });

    const stalled = vi.fn<ProviderFetch>(async () => ({
      body: new ReadableStream<Uint8Array>(),
      headers: new Headers({ "Content-Type": "text/event-stream" }),
      status: 200,
    }));
    await expect(
      analyze("openai", stalled, { limits: { stallTimeoutMs: 5 } }),
    ).rejects.toMatchObject({ code: "timeout" });
    expect(stalled).toHaveBeenCalledTimes(1);
  });

  it("enforces total body bounds and the overall timeout", async () => {
    const bounded = vi.fn<ProviderFetch>(async () =>
      response([encoder.encode(openAiStream('{"translationZh":"你好。"}'))]),
    );
    await expect(
      analyze("openai", bounded, { limits: { eventBytes: 65_536, totalBytes: 128 } }),
    ).rejects.toMatchObject({ code: "invalid-response" });

    const pending = vi.fn<ProviderFetch>(
      async (_endpoint, init) =>
        await new Promise<Awaited<ReturnType<ProviderFetch>>>((_resolve, reject) => {
          init.signal.addEventListener("abort", () => reject(new Error("secret transport data")));
        }),
    );
    await expect(analyze("openai", pending, { limits: { timeoutMs: 5 } })).rejects.toMatchObject({
      code: "timeout",
      message: "The provider request timed out.",
    });
    expect(pending).toHaveBeenCalledTimes(1);
  });

  it("maps HTTP failures to a fixed safe error", async () => {
    const fetch = vi.fn<ProviderFetch>(async () => ({
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode("secret-key Hello world. request-1"));
          controller.close();
        },
      }),
      headers: new Headers({ "Content-Type": "application/json" }),
      status: 401,
    }));
    await expect(analyze("openai", fetch)).rejects.toMatchObject({
      code: "provider-error",
      message: "The provider rejected the request.",
    });
  });
});
