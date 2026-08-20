import type { AnalysisRequest, CredentialSlot, DeviceVault } from "@huayi/store-domain";
import { describe, expect, it, vi } from "vitest";

import { BrowserAnalysisEngine } from "./browser-analysis-engine.js";
import type { ProviderFetch } from "./bounded-provider-stream.js";
import { DEEPSEEK_MODEL } from "./provider-requests.js";

const encoder = new TextEncoder();

function request(providerId: AnalysisRequest["providerId"]): AnalysisRequest {
  return {
    action: "translate",
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

function sse(data: unknown): string {
  return `data: ${typeof data === "string" ? data : JSON.stringify(data)}\n\n`;
}

function deepSeekChunk(options: {
  content?: string | null;
  finishReason?: string | null;
  reasoning?: string | null;
  role?: "assistant" | null;
}): string {
  return sse({
    choices: [
      {
        delta: {
          content: options.content ?? null,
          reasoning_content: options.reasoning ?? null,
          role: options.role ?? null,
        },
        finish_reason: options.finishReason ?? null,
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

function eventStream(source: string): Awaited<ReturnType<ProviderFetch>> {
  return {
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(source));
        controller.close();
      },
    }),
    headers: new Headers({ "Content-Type": "text/event-stream" }),
    status: 200,
  };
}

async function analyze(
  providerId: AnalysisRequest["providerId"],
  fetch: ProviderFetch,
  options: {
    signal?: AbortSignal;
    streamLimits?: { stallTimeoutMs?: number; timeoutMs?: number };
    vault?: DeviceVault;
  } = {},
) {
  const engine = new BrowserAnalysisEngine({
    deviceVault:
      options.vault ?? vault({ "deepseek-api-key": "deep-key", "openai-api-key": "open-key" }),
    fetch,
    ...(options.streamLimits === undefined ? {} : { streamLimits: options.streamLimits }),
  });
  return await engine.analyze(
    request(providerId),
    options.signal ?? new AbortController().signal,
    () => undefined,
  );
}

describe("BrowserAnalysisEngine strict provider handling", () => {
  it("streams Classic word sections before a complete DeepSeek translation result", async () => {
    const modelResult = {
      pronunciation: null,
      contextualSense: { meaningZh: "在语境中表示失踪的", partOfSpeech: "adjective" },
      dictionaryForm: "missing",
      commonMeanings: [{ partOfSpeech: "adjective", meaningsZh: ["失踪的", "缺少的"] }],
      commonPhrases: [{ meaningZh: "失踪人员", text: "missing person" }],
      confusableWords: [],
    };
    const content = JSON.stringify(modelResult);
    const stream = [
      deepSeekChunk({ content: "", role: "assistant" }),
      deepSeekChunk({ content: content.slice(0, content.indexOf('"commonMeanings"')) }),
      deepSeekChunk({ content: content.slice(content.indexOf('"commonMeanings"')) }),
      deepSeekChunk({ finishReason: "stop" }),
      sse("[DONE]"),
    ].join("");
    const fetch = vi.fn<ProviderFetch>(async () => eventStream(stream));
    const engine = new BrowserAnalysisEngine({
      deviceVault: vault({ "deepseek-api-key": "deep-key" }),
      fetch,
    });
    const updates: unknown[] = [];

    await engine.analyze(
      {
        action: "translate",
        providerId: "deepseek",
        requestId: "translate-missing",
        selection: "missing",
        selectionKind: "word",
        sentenceContext: "At least 23 people are missing.",
        targetLanguage: "zh-CN",
      },
      new AbortController().signal,
      (update) => updates.push(update),
    );

    expect(updates).toContainEqual({
      requestId: "translate-missing",
      section: "contextual-sense",
      sequence: 0,
      type: "section",
      value: modelResult.contextualSense,
    });
    expect(updates).toContainEqual({
      requestId: "translate-missing",
      section: "common-meanings",
      sequence: 1,
      type: "section",
      value: modelResult.commonMeanings,
    });
  });

  it("accepts a complete DeepSeek explain-word object through the strict model and public schemas", async () => {
    const modelResult = {
      contextualAnalysisZh: "这里表示某人或某物处于缺失状态。",
      synonyms: [],
      usageNotes: [{ descriptionZh: "作形容词描述缺失状态。", titleZh: "形容词用法" }],
      wordForm: { baseForm: "miss", formTypeZh: "现在分词", sentenceRoleZh: "作后置定语" },
      wordFormationZh: null,
    };
    const stream = [
      deepSeekChunk({ content: "", role: "assistant" }),
      deepSeekChunk({ content: JSON.stringify(modelResult) }),
      deepSeekChunk({ finishReason: "stop" }),
      sse("[DONE]"),
    ].join("");
    const fetch = vi.fn<ProviderFetch>(async () => eventStream(stream));
    const engine = new BrowserAnalysisEngine({
      deviceVault: vault({ "deepseek-api-key": "deep-key" }),
      fetch,
    });

    await expect(
      engine.analyze(
        {
          action: "explain",
          providerId: "deepseek",
          requestId: "explain-missing",
          selection: "missing",
          selectionKind: "word",
          sentenceContext: "At least 23 people are missing.",
          targetLanguage: "zh-CN",
        },
        new AbortController().signal,
        () => undefined,
      ),
    ).resolves.toMatchObject({
      contextualAnalysisZh: modelResult.contextualAnalysisZh,
      requestId: "explain-missing",
      selectionKind: "word",
      sourceText: "missing",
      type: "explain-word",
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("classifies an incomplete DeepSeek explain-word object as invalid-response", async () => {
    const stream = [
      deepSeekChunk({ content: "", role: "assistant" }),
      deepSeekChunk({
        content: JSON.stringify({ contextualAnalysisZh: "语境解释", wordForm: {} }),
      }),
      deepSeekChunk({ finishReason: "stop" }),
      sse("[DONE]"),
    ].join("");
    const fetch = vi.fn<ProviderFetch>(async () => eventStream(stream));
    const engine = new BrowserAnalysisEngine({
      deviceVault: vault({ "deepseek-api-key": "deep-key" }),
      fetch,
    });

    await expect(
      engine.analyze(
        {
          action: "explain",
          providerId: "deepseek",
          requestId: "invalid-explain",
          selection: "missing",
          selectionKind: "word",
          sentenceContext: "At least 23 people are missing.",
          targetLanguage: "zh-CN",
        },
        new AbortController().signal,
        () => undefined,
      ),
    ).rejects.toMatchObject({ code: "invalid-response" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each(["length", "content_filter", "tool_calls", "insufficient_system_resource"])(
    "rejects DeepSeek finish reason %s without retry or fallback",
    async (finishReason) => {
      const stream = [
        deepSeekChunk({ content: "", role: "assistant" }),
        deepSeekChunk({ content: '{"translationZh":"你好。"}' }),
        deepSeekChunk({ finishReason }),
        sse("[DONE]"),
      ].join("");
      const fetch = vi.fn<ProviderFetch>(async () => eventStream(stream));

      await expect(analyze("deepseek", fetch)).rejects.toMatchObject({
        code: "invalid-response",
      });
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );

  it("rejects non-empty DeepSeek reasoning content without retry or fallback", async () => {
    const stream = [
      deepSeekChunk({ content: "", role: "assistant" }),
      deepSeekChunk({ reasoning: "secret chain of thought" }),
      deepSeekChunk({ finishReason: "stop" }),
      sse("[DONE]"),
    ].join("");
    const fetch = vi.fn<ProviderFetch>(async () => eventStream(stream));

    await expect(analyze("deepseek", fetch)).rejects.toMatchObject({ code: "invalid-response" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("maps device-vault failures to stable errors and lets cancellation win", async () => {
    const fetch = vi.fn<ProviderFetch>();
    const credentialFailure = {
      ...vault(),
      getCredential: async (): Promise<string | null> => {
        throw new Error("secret credential storage failure");
      },
    };

    await expect(analyze("openai", fetch, { vault: credentialFailure })).rejects.toMatchObject({
      code: "internal-error",
      message: "Local encrypted storage is unavailable.",
    });

    let rejectCredential: ((reason: unknown) => void) | undefined;
    const pendingCredential = {
      ...vault(),
      getCredential: async (): Promise<string | null> =>
        await new Promise<string | null>((_resolve, reject) => {
          rejectCredential = reject;
        }),
    };
    const controller = new AbortController();
    const result = analyze("openai", fetch, {
      signal: controller.signal,
      vault: pendingCredential,
    });
    await Promise.resolve();
    controller.abort();
    rejectCredential?.(new Error("secret late failure"));
    await expect(result).rejects.toMatchObject({ code: "cancelled" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("applies the overall timeout while a response-body read is pending", async () => {
    const pendingBody = vi.fn<ProviderFetch>(async () => ({
      body: new ReadableStream<Uint8Array>(),
      headers: new Headers({ "Content-Type": "text/event-stream" }),
      status: 200,
    }));
    const started = Date.now();

    await expect(
      analyze("openai", pendingBody, {
        streamLimits: { stallTimeoutMs: 500, timeoutMs: 10 },
      }),
    ).rejects.toMatchObject({ code: "timeout" });
    expect(Date.now() - started).toBeLessThan(250);
    expect(pendingBody).toHaveBeenCalledTimes(1);
  });
});
