import { describe, expect, it, vi } from "vitest";

import type { AnalyzeRequest } from "@huayi/protocol";

import type { OpenAIApiKeyReader } from "../credentials/openai-keychain.js";
import type { CodexAppServer, CodexTurnRequest } from "../runtime/codex-app-server-lifecycle.js";
import type { AnalysisStreamUpdate } from "./analysis-provider.js";
import { CodexAppServerProvider } from "./codex-app-server-provider.js";
import { ModelSchemaRepository } from "./model-schema-repository.js";
import type { OpenAIResponseEvent } from "./openai-responses-events.js";
import type { OpenAIResponsesClient, OpenAIResponsesRequest } from "./openai-responses-client.js";
import { OpenAIResponsesProvider } from "./openai-responses-provider.js";
import type { ProviderValidationDiagnostic } from "./provider-validation.js";

const lexicalSchema = { additionalProperties: false, properties: {}, type: "object" };
const collocations = [{ meaningZh: "刑事调查", text: "criminal investigation" }] as const;
const similarTerms = [{ meaningZh: "调查", partOfSpeech: "noun", text: "inquiry" }] as const;
const lexicalContent = {
  collocations: [...collocations],
  contextExampleTranslationZh: "调查仍处于早期阶段。",
  contextualMeaningZh: "调查行为",
  partOfSpeech: "noun",
  pronunciation: null,
  similarTerms: [...similarTerms],
};

function createAnalysisRequest(overrides: Partial<AnalyzeRequest> = {}): AnalyzeRequest {
  return {
    action: "translate",
    context: "The investigation was in its early stages.",
    requestId: "analysis-1",
    schemaVersion: 4,
    selection: "investigation",
    selectionKind: "word",
    sentenceContext: "The investigation was in its early stages.",
    targetLanguage: "zh-CN",
    type: "analyze",
    ...overrides,
  };
}

function successfulEvents(text = JSON.stringify(lexicalContent)): OpenAIResponseEvent[] {
  return [
    { responseId: "resp-1", status: "in_progress", type: "response.created" },
    { responseId: "resp-1", status: "in_progress", type: "response.in_progress" },
    { itemId: "msg-1", type: "response.output_item.added" },
    { itemId: "msg-1", text: "", type: "response.content_part.added" },
    { delta: text.slice(0, 40), itemId: "msg-1", type: "response.output_text.delta" },
    { delta: text.slice(40), itemId: "msg-1", type: "response.output_text.delta" },
    { itemId: "msg-1", text, type: "response.output_text.done" },
    { itemId: "msg-1", text, type: "response.content_part.done" },
    { itemId: "msg-1", text, type: "response.output_item.done" },
    {
      itemId: "msg-1",
      responseId: "resp-1",
      status: "completed",
      text,
      type: "response.completed",
    },
  ];
}

function eventAt(events: OpenAIResponseEvent[], index: number): OpenAIResponseEvent {
  const event = events[index];
  if (event === undefined) throw new Error("Missing lifecycle fixture event.");
  return event;
}

const invalidLifecycleCases: (readonly [
  string,
  (events: OpenAIResponseEvent[]) => OpenAIResponseEvent[],
])[] = [
  [
    "in-progress before created",
    (events) => [eventAt(events, 1), eventAt(events, 0), ...events.slice(2)],
  ],
  [
    "second output item",
    (events) => [
      ...events.slice(0, 3),
      { itemId: "msg-2", type: "response.output_item.added" },
      ...events.slice(3),
    ],
  ],
  [
    "second content part",
    (events) => [...events.slice(0, 4), eventAt(events, 3), ...events.slice(4)],
  ],
  [
    "delta before content part",
    (events) => [...events.slice(0, 3), eventAt(events, 4), eventAt(events, 3), ...events.slice(5)],
  ],
  [
    "completed before text done",
    (events) => [...events.slice(0, 6), eventAt(events, 9), ...events.slice(6, 9)],
  ],
  [
    "duplicate text done",
    (events) => [...events.slice(0, 7), eventAt(events, 6), ...events.slice(7)],
  ],
  ["duplicate completed", (events) => [...events, eventAt(events, 9)]],
  [
    "event after terminal",
    (events) => [...events, { delta: "late", itemId: "msg-1", type: "response.output_text.delta" }],
  ],
  [
    "mismatched item identity",
    (events) =>
      events.map((event, index) => (index === 4 ? { ...event, itemId: "msg-other" } : event)),
  ],
];

class FakeClient {
  readonly requests: OpenAIResponsesRequest[] = [];
  readonly keys: string[] = [];
  readonly signals: AbortSignal[] = [];
  private readonly streams: OpenAIResponseEvent[][];

  constructor(streams: OpenAIResponseEvent[][]) {
    this.streams = [...streams];
  }

  async *stream(request: OpenAIResponsesRequest, key: string, signal: AbortSignal) {
    this.requests.push(request);
    this.keys.push(key);
    this.signals.push(signal);
    const events = this.streams.shift();
    if (events === undefined) throw new Error("Missing fake stream.");
    for (const event of events) yield event;
  }
}

function fakeKeyReader(keys = ["secret-one"]): {
  reader: OpenAIApiKeyReader;
  read: ReturnType<typeof vi.fn>;
} {
  const values = [...keys];
  const read = vi.fn(async () => values.shift() ?? "secret-last");
  return { reader: { read } as unknown as OpenAIApiKeyReader, read };
}

function schemaRepository(): ModelSchemaRepository {
  return new ModelSchemaRepository({
    readSchema: async () => lexicalSchema,
    schemaDirectory: "/Applications/Huayi/provider/schemas",
  });
}

function createProvider(
  client: FakeClient,
  keys = ["secret-one"],
  onValidationDiagnostic?: (diagnostic: ProviderValidationDiagnostic) => void,
) {
  const keyReader = fakeKeyReader(keys);
  return {
    keyReader,
    provider: new OpenAIResponsesProvider({
      apiKeyReader: keyReader.reader,
      client: client as unknown as OpenAIResponsesClient,
      ...(onValidationDiagnostic === undefined ? {} : { onValidationDiagnostic }),
      schemaRepository: schemaRepository(),
    }),
  };
}

describe("OpenAIResponsesProvider", () => {
  it("warmup performs no Keychain read, schema read, or HTTP stream", async () => {
    const client = new FakeClient([]);
    const { keyReader, provider } = createProvider(client);

    await expect(provider.warmup(new AbortController().signal)).resolves.toBeUndefined();

    expect(keyReader.read).not.toHaveBeenCalled();
    expect(client.requests).toEqual([]);
  });

  it("reads the current key per analysis and forwards the caller signal", async () => {
    const client = new FakeClient([successfulEvents(), successfulEvents()]);
    const { keyReader, provider } = createProvider(client, ["secret-one", "secret-two"]);
    const firstSignal = new AbortController().signal;
    const secondSignal = new AbortController().signal;

    await provider.analyze(createAnalysisRequest(), firstSignal);
    await provider.analyze(createAnalysisRequest({ requestId: "analysis-2" }), secondSignal);

    expect(keyReader.read).toHaveBeenCalledTimes(2);
    expect(client.keys).toEqual(["secret-one", "secret-two"]);
    expect(client.signals).toEqual([firstSignal, secondSignal]);
    expect(client.requests[0]).toMatchObject({
      modelConfiguration: { effort: "none", model: "gpt-5.6-luna" },
      outputSchema: lexicalSchema,
      outputSchemaName: "translate_lexical",
    });
  });

  it("emits validated string and cumulative array updates before returning trusted metadata", async () => {
    const client = new FakeClient([successfulEvents()]);
    const { provider } = createProvider(client);
    const updates: AnalysisStreamUpdate[] = [];

    const result = await provider.analyze(
      createAnalysisRequest(),
      new AbortController().signal,
      (update) => updates.push(update),
    );

    expect(updates).toContainEqual({
      delta: "调查行为",
      section: "contextual-meaning",
      type: "analysis-delta",
    });
    expect(updates).toContainEqual({
      section: "collocations",
      type: "analysis-section",
      value: [...collocations],
    });
    expect(updates).toContainEqual({
      section: "similar-terms",
      type: "analysis-section",
      value: [...similarTerms],
    });
    expect(result).toMatchObject({
      selectionKind: "word",
      sourceText: "investigation",
      type: "translate-lexical",
    });
  });

  it("returns exactly the same public result as the Codex Provider", async () => {
    const text = JSON.stringify(lexicalContent);
    const client = new FakeClient([successfulEvents(text)]);
    const { provider } = createProvider(client);
    const appServer: CodexAppServer = {
      dispose: () => undefined,
      interrupt: async () => undefined,
      runTurn: async (turn: CodexTurnRequest) => {
        turn.onAssistantDelta(text);
        return text;
      },
      warmup: async () => undefined,
    };
    const codex = new CodexAppServerProvider({
      appServer,
      schemaRepository: schemaRepository(),
    });
    const request = createAnalysisRequest();

    await expect(provider.analyze(request, new AbortController().signal)).resolves.toEqual(
      await codex.analyze(request, new AbortController().signal),
    );
  });

  it.each(invalidLifecycleCases)("rejects %s", async (_label, mutate) => {
    const client = new FakeClient([mutate(successfulEvents())]);
    const { provider } = createProvider(client);

    await expect(
      provider.analyze(createAnalysisRequest(), new AbortController().signal),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it.each([
    "response.output_text.done",
    "response.content_part.done",
    "response.output_item.done",
    "response.completed",
  ] as const)("rejects mismatched text in %s", async (type) => {
    const events = successfulEvents().map((event) =>
      event.type === type ? { ...event, text: `${event.text}x` } : event,
    );
    const { provider } = createProvider(new FakeClient([events]));

    await expect(
      provider.analyze(createAnalysisRequest(), new AbortController().signal),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it.each([
    { responseId: "resp-1", status: "failed", type: "response.failed" },
    { responseId: "resp-1", status: "incomplete", type: "response.incomplete" },
    { type: "error" },
  ] as const)("rejects terminal $type", async (terminal) => {
    const prefix = successfulEvents().slice(0, 6);
    const { provider } = createProvider(new FakeClient([[...prefix, terminal]]));

    await expect(
      provider.analyze(createAnalysisRequest(), new AbortController().signal),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("rejects a valid preview followed by invalid final JSON with safe diagnostics", async () => {
    const diagnostics: ProviderValidationDiagnostic[] = [];
    const text = JSON.stringify({ ...lexicalContent, partOfSpeech: "secret-invalid-value" });
    const client = new FakeClient([successfulEvents(text)]);
    const { provider } = createProvider(client, ["secret-key"], (diagnostic) =>
      diagnostics.push(diagnostic),
    );

    await expect(
      provider.analyze(createAnalysisRequest(), new AbortController().signal),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    expect(diagnostics).toEqual([{ field: "partOfSpeech", stage: "model-schema" }]);
    expect(JSON.stringify(diagnostics)).not.toContain("secret");
  });

  it("passes through diagnostic model configuration only when explicitly supplied", async () => {
    const client = new FakeClient([successfulEvents()]);
    const keyReader = fakeKeyReader();
    const provider = new OpenAIResponsesProvider({
      apiKeyReader: keyReader.reader,
      client: client as unknown as OpenAIResponsesClient,
      modelConfiguration: { effort: "low", model: "gpt-5.4-mini" },
      schemaRepository: schemaRepository(),
    });

    await provider.analyze(createAnalysisRequest(), new AbortController().signal);

    expect(client.requests[0]?.modelConfiguration).toEqual({
      effort: "low",
      model: "gpt-5.4-mini",
    });
  });
});
