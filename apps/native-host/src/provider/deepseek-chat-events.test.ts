import { describe, expect, it } from "vitest";

import { parseDeepSeekSseData } from "./deepseek-chat-events.js";

function chunk(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    choices: [
      {
        delta: { content: "调查", role: null },
        finish_reason: null,
        index: 0,
        logprobs: null,
      },
    ],
    created: 1_700_000_000,
    id: "chatcmpl-deepseek-1",
    model: "deepseek-v4-flash",
    object: "chat.completion.chunk",
    system_fingerprint: "fp_deepseek",
    usage: null,
    ...overrides,
  });
}

describe("parseDeepSeekSseData", () => {
  it("normalizes documented content chunks and the DONE sentinel", () => {
    expect(parseDeepSeekSseData(chunk())).toEqual({
      content: "调查",
      created: 1_700_000_000,
      finishReason: null,
      id: "chatcmpl-deepseek-1",
      reasoningContent: null,
      role: null,
      type: "chunk",
    });
    expect(parseDeepSeekSseData("[DONE]")).toEqual({ type: "done" });
  });

  it("accepts a role-only opening chunk and a stop chunk", () => {
    const opening = JSON.parse(chunk()) as Record<string, unknown>;
    opening.choices = [
      {
        delta: { content: "", role: "assistant" },
        finish_reason: null,
        index: 0,
        logprobs: null,
      },
    ];
    const stopped = JSON.parse(chunk()) as Record<string, unknown>;
    stopped.choices = [
      {
        delta: { content: "", role: null },
        finish_reason: "stop",
        index: 0,
        logprobs: null,
      },
    ];
    stopped.usage = {
      completion_tokens: 42,
      completion_tokens_details: { reasoning_tokens: 0 },
      prompt_cache_hit_tokens: 120,
      prompt_cache_miss_tokens: 30,
      prompt_tokens: 150,
      prompt_tokens_details: { cached_tokens: 120 },
      total_tokens: 192,
    };

    expect(parseDeepSeekSseData(JSON.stringify(opening))).toMatchObject({
      content: "",
      finishReason: null,
      role: "assistant",
    });
    expect(parseDeepSeekSseData(JSON.stringify(stopped))).toMatchObject({
      content: "",
      finishReason: "stop",
    });
  });

  it.each([
    "{}",
    chunk({ model: "deepseek-v4-pro" }),
    chunk({ unexpected: true }),
    chunk({ choices: [] }),
    chunk({
      usage: {
        completion_tokens: 1,
        prompt_tokens: 1,
        total_tokens: 2,
        unexpected: true,
      },
    }),
  ])("rejects an undocumented or mismatched chunk", (data) => {
    expect(() => parseDeepSeekSseData(data)).toThrowError();
  });
});
