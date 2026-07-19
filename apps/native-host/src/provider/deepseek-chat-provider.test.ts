import { describe, expect, it, vi } from "vitest";

import type { AnalyzeRequest } from "@huayi/protocol";

import type { DeepSeekApiKeyReader } from "../credentials/deepseek-keychain.js";
import type { AnalysisStreamUpdate } from "./analysis-provider.js";
import type { DeepSeekChatClient } from "./deepseek-chat-client.js";
import type { DeepSeekChatEvent } from "./deepseek-chat-events.js";
import { DeepSeekChatProvider } from "./deepseek-chat-provider.js";
import { ModelSchemaRepository } from "./model-schema-repository.js";

const schema = { additionalProperties: false, properties: {}, type: "object" };

function request(overrides: Partial<AnalyzeRequest> = {}): AnalyzeRequest {
  return {
    action: "translate",
    context: "The investigation remains open.",
    requestId: "deepseek-provider-1",
    schemaVersion: 5,
    selection: "investigation",
    selectionKind: "word",
    sentenceContext: "The investigation remains open.",
    targetLanguage: "zh-CN",
    type: "analyze",
    ...overrides,
  };
}

function events(text: string): DeepSeekChatEvent[] {
  return [
    {
      content: "",
      created: 1_700_000_000,
      finishReason: null,
      id: "chatcmpl-1",
      reasoningContent: null,
      role: "assistant",
      type: "chunk",
    },
    {
      content: text.slice(0, Math.floor(text.length / 2)),
      created: 1_700_000_000,
      finishReason: null,
      id: "chatcmpl-1",
      reasoningContent: null,
      role: null,
      type: "chunk",
    },
    {
      content: text.slice(Math.floor(text.length / 2)),
      created: 1_700_000_000,
      finishReason: null,
      id: "chatcmpl-1",
      reasoningContent: null,
      role: null,
      type: "chunk",
    },
    {
      content: "",
      created: 1_700_000_000,
      finishReason: "stop",
      id: "chatcmpl-1",
      reasoningContent: null,
      role: null,
      type: "chunk",
    },
    { type: "done" },
  ];
}

class FakeClient {
  readonly keys: string[] = [];
  readonly requests: unknown[] = [];
  private readonly streams: DeepSeekChatEvent[][];

  constructor(streams: DeepSeekChatEvent[][]) {
    this.streams = [...streams];
  }

  async *stream(chatRequest: unknown, key: string) {
    this.requests.push(chatRequest);
    this.keys.push(key);
    const stream = this.streams.shift();
    if (stream === undefined) throw new Error("Missing fake DeepSeek stream.");
    for (const event of stream) yield event;
  }
}

function provider(streams: DeepSeekChatEvent[][]) {
  const read = vi.fn(async () => "deepseek-secret");
  const client = new FakeClient(streams);
  return {
    client,
    provider: new DeepSeekChatProvider({
      apiKeyReader: { read } as unknown as DeepSeekApiKeyReader,
      client: client as unknown as DeepSeekChatClient,
      schemaRepository: new ModelSchemaRepository({
        readSchema: async () => schema,
        schemaDirectory: "/Applications/Huayi/provider/schemas",
      }),
    }),
    read,
  };
}

const cases = [
  {
    content: {
      pronunciation: null,
      contextualSense: { meaningZh: "调查", partOfSpeech: "noun" },
      dictionaryForm: "investigation",
      commonMeanings: [{ meaningsZh: ["调查"], partOfSpeech: "noun" }],
      commonPhrases: [],
      confusableWords: [],
    },
    expected: "translate-word",
    request: request(),
  },
  {
    content: { translationZh: "第一句。第二句。" },
    expected: "translate-passage",
    request: request({
      context: "First sentence. Second sentence.",
      selection: "First sentence. Second sentence.",
      selectionKind: "paragraph",
      sentenceContext: null,
    }),
  },
  {
    content: {
      contextualAnalysisZh: "此处表示持续状态。",
      wordForm: { baseForm: "sustain", formTypeZh: "过去分词", sentenceRoleZh: "定语" },
      wordFormationZh: null,
      usageNotes: [],
      synonyms: [],
    },
    expected: "explain-word",
    request: request({ action: "explain", selection: "sustained" }),
  },
  {
    content: {
      contextRole: "补充说明调查状态。",
      keyExpressions: [{ meaningZh: "处于早期阶段", text: "in its early stages" }],
      mainStructure: "主语加系动词加表语。",
      translationZh: "调查仍处于早期阶段。",
    },
    expected: "explain-sentence",
    request: request({
      action: "explain",
      selection: "The investigation remains at an early stage.",
      selectionKind: "sentence",
      sentenceContext: null,
    }),
  },
] as const;

describe("DeepSeekChatProvider", () => {
  it.each(cases)("assembles and validates $expected", async (fixture) => {
    const runtime = provider([events(JSON.stringify(fixture.content))]);

    const result = await runtime.provider.analyze(fixture.request, new AbortController().signal);

    expect(result.type).toBe(fixture.expected);
    expect(result.sourceText).toBe(fixture.request.selection);
    expect(runtime.read).toHaveBeenCalledOnce();
    expect(runtime.client.keys).toEqual(["deepseek-secret"]);
  });

  it("emits validated progressive updates before final success", async () => {
    const content = cases[0].content;
    const runtime = provider([events(JSON.stringify(content))]);
    const updates: AnalysisStreamUpdate[] = [];

    await runtime.provider.analyze(request(), new AbortController().signal, (update) =>
      updates.push(update),
    );

    expect(updates).toContainEqual({
      section: "contextual-sense",
      type: "analysis-section",
      value: { meaningZh: "调查", partOfSpeech: "noun" },
    });
  });

  it("finishes a Flimsy translation after previewing redundant confusable words", async () => {
    const content = {
      pronunciation: null,
      contextualSense: { meaningZh: "结构单薄、不牢固的", partOfSpeech: "adjective" },
      dictionaryForm: "flimsy",
      commonMeanings: [{ meaningsZh: ["不牢固的"], partOfSpeech: "adjective" }],
      commonPhrases: [],
      confusableWords: [
        {
          distinctionZh: "这是所查单词本身。",
          meaningZh: "不牢固的",
          partOfSpeech: "adjective",
          text: "flimsy",
        },
        {
          distinctionZh: "fragile 更强调易碎。",
          meaningZh: "易碎的",
          partOfSpeech: "adjective",
          text: "fragile",
        },
      ],
    };
    const caption = "Why American Houses Are So Flimsy";
    const runtime = provider([events(JSON.stringify(content))]);
    const updates: AnalysisStreamUpdate[] = [];

    const result = await runtime.provider.analyze(
      request({
        context: caption,
        selection: "Flimsy",
        sentenceContext: caption,
      }),
      new AbortController().signal,
      (update) => updates.push(update),
    );

    expect(updates).toContainEqual({
      section: "confusable-words",
      type: "analysis-section",
      value: content.confusableWords,
    });
    expect(result).toMatchObject({
      confusableWords: [content.confusableWords[1]],
      sourceText: "Flimsy",
      type: "translate-word",
    });
  });

  it.each([
    [
      "non-empty reasoning",
      (stream: DeepSeekChatEvent[]) =>
        stream.map((event, index) =>
          index === 1 && event.type === "chunk" ? { ...event, reasoningContent: "hidden" } : event,
        ),
    ],
    ["missing DONE", (stream: DeepSeekChatEvent[]) => stream.slice(0, -1)],
    ["missing stop", (stream: DeepSeekChatEvent[]) => stream.filter((_, index) => index !== 3)],
    [
      "mismatched id",
      (stream: DeepSeekChatEvent[]) =>
        stream.map((event, index) =>
          index === 2 && event.type === "chunk" ? { ...event, id: "chatcmpl-other" } : event,
        ),
    ],
  ] as const)("rejects %s", async (_label, mutate) => {
    const runtime = provider([mutate(events(JSON.stringify(cases[0].content)))]);

    await expect(
      runtime.provider.analyze(request(), new AbortController().signal),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it.each([
    ["empty content", ""],
    ["invalid JSON", "{not-json}"],
    ["wrong result schema", JSON.stringify({ translationZh: "错误类型" })],
  ])("rejects %s after the stream lifecycle completes", async (_label, content) => {
    const runtime = provider([events(content)]);

    await expect(
      runtime.provider.analyze(request(), new AbortController().signal),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("warmup remains local", async () => {
    const runtime = provider([]);

    await expect(runtime.provider.warmup(new AbortController().signal)).resolves.toBeUndefined();
    expect(runtime.read).not.toHaveBeenCalled();
    expect(runtime.client.requests).toEqual([]);
  });
});
