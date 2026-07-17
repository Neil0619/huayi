import { describe, expect, it, vi } from "vitest";

import type { AnalyzeRequest } from "@huayi/protocol";

import {
  DEEPSEEK_CHAT_COMPLETIONS_ENDPOINT,
  DeepSeekChatClient,
  type DeepSeekFetch,
  type DeepSeekFetchResponse,
} from "./deepseek-chat-client.js";
import type { DeepSeekChatRequest } from "./deepseek-request-body.js";

const request: AnalyzeRequest = {
  action: "translate",
  context: "The investigation remains open.",
  requestId: "deepseek-client-1",
  schemaVersion: 5,
  selection: "investigation",
  selectionKind: "word",
  sentenceContext: "The investigation remains open.",
  targetLanguage: "zh-CN",
  type: "analyze",
};

const chatRequest: DeepSeekChatRequest = {
  analysisRequest: request,
  outputSchema: { additionalProperties: false, properties: {}, type: "object" },
  resultType: "translate-lexical",
};

function streamBody(parts: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const part of parts) controller.enqueue(encoder.encode(part));
      controller.close();
    },
  });
}

function chunk(
  content: string,
  finishReason: string | null,
  role: string | null = null,
  usage: unknown = null,
): string {
  return JSON.stringify({
    choices: [
      {
        delta: { content, role },
        finish_reason: finishReason,
        index: 0,
        logprobs: null,
      },
    ],
    created: 1_700_000_000,
    id: "chatcmpl-1",
    model: "deepseek-v4-flash",
    object: "chat.completion.chunk",
    system_fingerprint: "fp-1",
    usage,
  });
}

function response(
  body: ReadableStream<Uint8Array> | null,
  status = 200,
  contentType = "text/event-stream",
): DeepSeekFetchResponse {
  return {
    body: body as DeepSeekFetchResponse["body"],
    headers: new Headers({ "content-type": contentType }),
    status,
  };
}

describe("DeepSeekChatClient", () => {
  it("posts to the fixed endpoint and parses fragmented data-only SSE with keep-alives", async () => {
    const opening = `: keep-alive\n\ndata: ${chunk("", null, "assistant")}\n\n`;
    const delta = `data: ${chunk('{"translationZh":"调查"}', null)}\n\n`;
    const stopped = `data: ${chunk("", "stop", null, {
      completion_tokens: 42,
      prompt_cache_hit_tokens: 120,
      prompt_cache_miss_tokens: 30,
      prompt_tokens: 150,
      prompt_tokens_details: { cached_tokens: 120 },
      total_tokens: 192,
    })}\n\ndata: [DONE]\n\n`;
    const fetch = vi.fn<DeepSeekFetch>(async () =>
      response(streamBody([opening.slice(0, 13), opening.slice(13), delta, stopped])),
    );
    const client = new DeepSeekChatClient({ fetch });
    const events = [];

    for await (const event of client.stream(
      chatRequest,
      "deepseek-secret",
      new AbortController().signal,
    )) {
      events.push(event);
    }

    expect(events).toHaveLength(4);
    expect(events.at(-1)).toEqual({ type: "done" });
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0]?.[0]).toBe(DEEPSEEK_CHAT_COMPLETIONS_ENDPOINT);
    const init = fetch.mock.calls[0]?.[1];
    expect(init).toMatchObject({
      credentials: "omit",
      headers: {
        Accept: "text/event-stream",
        Authorization: "Bearer deepseek-secret",
        "Content-Type": "application/json",
      },
      method: "POST",
      redirect: "error",
    });
    expect(JSON.parse(init?.body ?? "{}")).toMatchObject({
      model: "deepseek-v4-flash",
      stream: true,
      thinking: { type: "disabled" },
    });
  });

  it.each([
    [401, "MODEL_PROVIDER_AUTH_FAILED"],
    [403, "MODEL_PROVIDER_AUTH_FAILED"],
    [402, "QUOTA_EXCEEDED"],
    [429, "RATE_LIMITED"],
    [500, "NETWORK_ERROR"],
    [502, "NETWORK_ERROR"],
    [503, "NETWORK_ERROR"],
    [504, "NETWORK_ERROR"],
    [400, "INVALID_RESPONSE"],
    [422, "INVALID_RESPONSE"],
  ] as const)("maps HTTP %i to %s", async (status, code) => {
    const client = new DeepSeekChatClient({
      fetch: async () => response(streamBody(["{}"]), status, "application/json"),
    });

    const collect = async () => {
      for await (const event of client.stream(
        chatRequest,
        "secret",
        new AbortController().signal,
      )) {
        void event;
      }
    };

    await expect(collect()).rejects.toMatchObject({ code });
  });

  it("rejects a successful non-SSE response", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
      },
    });
    const client = new DeepSeekChatClient({
      fetch: async () => response(body, 200, "application/json"),
    });

    const collect = async () => {
      for await (const event of client.stream(
        chatRequest,
        "secret",
        new AbortController().signal,
      )) {
        void event;
      }
    };

    await expect(collect()).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    expect(cancelled).toBe(true);
  });

  it("maps caller cancellation without retrying or leaking the key", async () => {
    const controller = new AbortController();
    const fetch = vi.fn<DeepSeekFetch>(
      async (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener("abort", () => reject(new DOMException("", "AbortError")), {
            once: true,
          });
        }),
    );
    const client = new DeepSeekChatClient({ fetch });
    const collect = async () => {
      for await (const event of client.stream(
        chatRequest,
        "secret-cancel-key",
        controller.signal,
      )) {
        void event;
      }
    };
    const pending = collect();

    controller.abort();

    await expect(pending).rejects.toMatchObject({ code: "CANCELLED" });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("maps its fixed internal deadline to timeout", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn<DeepSeekFetch>(
      async (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener("abort", () => reject(new TypeError("aborted")), {
            once: true,
          });
        }),
    );
    const client = new DeepSeekChatClient({ fetch });
    const collect = async () => {
      for await (const event of client.stream(
        chatRequest,
        "secret-timeout-key",
        new AbortController().signal,
      )) {
        void event;
      }
    };
    try {
      const pending = collect().catch((error: unknown) => error);
      await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
      await vi.advanceTimersByTimeAsync(60_000);

      await expect(pending).resolves.toMatchObject({ code: "TIMEOUT" });
      expect(fetch).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("fails a rejected redirect closed", async () => {
    const client = new DeepSeekChatClient({
      fetch: async () => {
        throw new TypeError("unexpected redirect");
      },
    });
    const collect = async () => {
      for await (const event of client.stream(
        chatRequest,
        "secret",
        new AbortController().signal,
      )) {
        void event;
      }
    };

    await expect(collect()).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });
});
