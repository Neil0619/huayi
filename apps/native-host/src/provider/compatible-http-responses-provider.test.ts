import { describe, expect, it, vi } from "vitest";

import type { AnalyzeRequest } from "@huayi/protocol";

import type { CompatibleHttpConfigurationStore } from "../config/compatible-http-configuration-store.js";
import type { CompatibleHttpApiKeyReader } from "../credentials/compatible-http-keychain.js";
import type { AnalysisStreamUpdate } from "./analysis-provider.js";
import type { CompatibleHttpResponsesClient } from "./compatible-http-responses-client.js";
import type { CompatibleHttpResponseEvent } from "./compatible-http-responses-events.js";
import { CompatibleHttpResponsesProvider } from "./compatible-http-responses-provider.js";
import { successfulCompatibleEvents } from "./compatible-http-responses-provider-test-support.js";
import { ModelSchemaRepository } from "./model-schema-repository.js";
import type { ProviderValidationDiagnostic } from "./provider-validation.js";
import type { ResponsesRequest } from "./responses-request-body.js";

const lexicalContent = {
  collocations: [{ meaningZh: "刑事调查", text: "criminal investigation" }],
  contextExampleTranslationZh: "调查仍处于早期阶段。",
  contextualMeaningZh: "调查行为",
  partOfSpeech: "noun",
  pronunciation: null,
  similarTerms: [{ meaningZh: "调查", partOfSpeech: "noun", text: "inquiry" }],
};

function analysisRequest(): AnalyzeRequest {
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
  };
}

function successfulEvents(
  text = JSON.stringify(lexicalContent),
  options: Parameters<typeof successfulCompatibleEvents>[1] = {},
): CompatibleHttpResponseEvent[] {
  return successfulCompatibleEvents(text, options);
}

function eventAt(
  events: CompatibleHttpResponseEvent[],
  index: number,
): CompatibleHttpResponseEvent {
  const event = events[index];
  if (event === undefined) throw new Error("Missing compatible lifecycle fixture event.");
  return event;
}

class FakeClient {
  readonly calls: {
    baseUrl: string;
    key: string;
    request: ResponsesRequest;
    signal: AbortSignal;
  }[] = [];

  constructor(
    private readonly events: CompatibleHttpResponseEvent[],
    private readonly onYield?: () => void,
  ) {}

  async *stream(request: ResponsesRequest, key: string, baseUrl: string, signal: AbortSignal) {
    this.calls.push({ baseUrl, key, request, signal });
    for (const event of this.events) {
      yield event;
      this.onYield?.();
    }
  }
}

function createProvider(
  events: CompatibleHttpResponseEvent[],
  onValidationDiagnostic?: (diagnostic: ProviderValidationDiagnostic) => void,
  onYield?: () => void,
) {
  const client = new FakeClient(events, onYield);
  const configurationRead = vi.fn(async () => ({
    allowInsecureHttp: true as const,
    baseUrl: "http://101.133.153.118:9090/v1",
    effort: "low" as const,
    model: "gpt-5.4-mini" as const,
    schemaVersion: 1 as const,
  }));
  const keyRead = vi.fn(async () => "fake-compatible-key");
  const provider = new CompatibleHttpResponsesProvider({
    apiKeyReader: { read: keyRead } as unknown as CompatibleHttpApiKeyReader,
    client: client as unknown as CompatibleHttpResponsesClient,
    configurationStore: { read: configurationRead } as unknown as CompatibleHttpConfigurationStore,
    ...(onValidationDiagnostic === undefined ? {} : { onValidationDiagnostic }),
    schemaRepository: new ModelSchemaRepository({
      readSchema: async () => ({ additionalProperties: false, properties: {}, type: "object" }),
      schemaDirectory: "/Applications/Huayi/provider/schemas",
    }),
  });
  return { client, configurationRead, keyRead, provider };
}

describe("CompatibleHttpResponsesProvider", () => {
  it.each([
    ["minimal lifecycle", successfulEvents()],
    [
      "opening rate limits and reasoning",
      successfulEvents(undefined, { rateLimits: true, reasoning: true }),
    ],
    [
      "measured gateway terminal lifecycle",
      successfulEvents(undefined, { detailedTerminal: true, reasoning: true }),
    ],
    ["omitted terminal sequence", successfulEvents(undefined, { terminalSequence: null })],
  ])("accepts %s and assembles the public result", async (_label, events) => {
    const { client, configurationRead, keyRead, provider } = createProvider(events);
    const signal = new AbortController().signal;
    const updates: AnalysisStreamUpdate[] = [];

    const result = await provider.analyze(analysisRequest(), signal, (update) =>
      updates.push(update),
    );

    expect(configurationRead).toHaveBeenCalledWith(signal);
    expect(keyRead).toHaveBeenCalledWith(signal);
    expect(client.calls[0]).toMatchObject({
      baseUrl: "http://101.133.153.118:9090/v1",
      key: "fake-compatible-key",
      request: { modelConfiguration: { effort: "low", model: "gpt-5.4-mini" } },
      signal,
    });
    expect(updates).toContainEqual({
      delta: "调查行为",
      section: "contextual-meaning",
      type: "analysis-delta",
    });
    expect(result).toMatchObject({
      selectionKind: "word",
      sourceText: "investigation",
      type: "translate-lexical",
    });
  });

  it("warmup performs no configuration, Keychain, schema or HTTP work", async () => {
    const { client, configurationRead, keyRead, provider } = createProvider([]);
    await provider.warmup(new AbortController().signal);
    expect(configurationRead).not.toHaveBeenCalled();
    expect(keyRead).not.toHaveBeenCalled();
    expect(client.calls).toEqual([]);
  });

  it.each([
    [
      "duplicate sequence",
      (events: CompatibleHttpResponseEvent[]) =>
        events.map((event, index) => (index === 2 ? { ...event, sequence: 1 } : event)),
    ],
    [
      "gapped sequence",
      (events: CompatibleHttpResponseEvent[]) =>
        events.map((event, index) => (index === 2 ? { ...event, sequence: 3 } : event)),
    ],
    [
      "reversed sequence",
      (events: CompatibleHttpResponseEvent[]) =>
        events.map((event, index) => (index === 2 ? { ...event, sequence: 0 } : event)),
    ],
    [
      "late rate limit",
      (events: CompatibleHttpResponseEvent[]) => [
        eventAt(events, 0),
        { sequence: null, type: "codex.rate_limits" as const },
        ...events.slice(1),
      ],
    ],
    [
      "message before reasoning done",
      () => {
        const withReasoning = successfulEvents(undefined, { reasoning: true });
        return [
          eventAt(withReasoning, 0),
          eventAt(withReasoning, 1),
          eventAt(withReasoning, 2),
          ...withReasoning.slice(4),
          eventAt(withReasoning, 3),
        ];
      },
    ],
    [
      "reasoning added without done",
      () =>
        successfulEvents(undefined, { reasoning: true }).filter(
          (event) => event.type !== "response.output_item.done",
        ),
    ],
    [
      "reasoning done without added",
      (events: CompatibleHttpResponseEvent[]) => [
        ...events.slice(0, 2),
        {
          itemId: "reasoning-1",
          itemType: "reasoning" as const,
          outputIndex: 0 as const,
          sequence: 2,
          text: null,
          type: "response.output_item.done" as const,
        },
        ...events
          .slice(2)
          .map((event) =>
            event.sequence === null ? event : { ...event, sequence: event.sequence + 1 },
          ),
      ],
    ],
    [
      "duplicate reasoning",
      () => {
        const events = successfulEvents(undefined, { reasoning: true });
        return [...events.slice(0, 3), eventAt(events, 2), ...events.slice(3)];
      },
    ],
    [
      "duplicate assistant",
      (events: CompatibleHttpResponseEvent[]) => [
        ...events.slice(0, 3),
        eventAt(events, 2),
        ...events.slice(3),
      ],
    ],
    [
      "missing text done",
      (events: CompatibleHttpResponseEvent[]) =>
        events.filter((event) => event.type !== "response.output_text.done"),
    ],
    [
      "assistant output index without reasoning",
      (events: CompatibleHttpResponseEvent[]) =>
        events.map((event) =>
          event.type === "response.output_item.added" && event.itemType === "message"
            ? { ...event, outputIndex: 1 as const }
            : event,
        ),
    ],
    [
      "content part done without assistant item done",
      () =>
        successfulEvents(undefined, { detailedTerminal: true, reasoning: true }).filter(
          (event) => !(event.type === "response.output_item.done" && event.itemType === "message"),
        ),
    ],
    [
      "assistant item done without content part done",
      () =>
        successfulEvents(undefined, { detailedTerminal: true, reasoning: true }).filter(
          (event) => event.type !== "response.content_part.done",
        ),
    ],
    [
      "late event",
      (events: CompatibleHttpResponseEvent[]) => [
        ...events,
        {
          delta: "late",
          itemId: "message-1",
          outputIndex: 0 as const,
          sequence: 8,
          type: "response.output_text.delta" as const,
        },
      ],
    ],
  ])("rejects %s", async (_label, mutate) => {
    const { provider } = createProvider(mutate(successfulEvents()));
    await expect(
      provider.analyze(analysisRequest(), new AbortController().signal),
    ).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
  });

  it.each(["response.output_text.done", "response.completed"] as const)(
    "rejects a text mismatch at %s",
    async (type) => {
      const events = successfulEvents().map((event) =>
        event.type === type ? { ...event, text: `${event.text}x` } : event,
      );
      const { provider } = createProvider(events);
      await expect(
        provider.analyze(analysisRequest(), new AbortController().signal),
      ).rejects.toMatchObject({
        code: "INVALID_RESPONSE",
      });
    },
  );

  it("rejects invalid model JSON and cancelled requests", async () => {
    const invalid = createProvider(successfulEvents("not-json"));
    await expect(
      invalid.provider.analyze(analysisRequest(), new AbortController().signal),
    ).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
    const cancelled = createProvider(successfulEvents());
    const controller = new AbortController();
    controller.abort();
    await expect(
      cancelled.provider.analyze(analysisRequest(), controller.signal),
    ).rejects.toMatchObject({
      code: "CANCELLED",
    });
  });

  it("reports only bounded diagnostics for private-schema and result-assembly failures", async () => {
    const diagnostics: ProviderValidationDiagnostic[] = [];
    const privateSchemaText = JSON.stringify({
      ...lexicalContent,
      partOfSpeech: "secret-invalid-value",
    });
    const privateSchema = createProvider(successfulEvents(privateSchemaText), (diagnostic) =>
      diagnostics.push(diagnostic),
    );
    await expect(
      privateSchema.provider.analyze(analysisRequest(), new AbortController().signal),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });

    const assembly = createProvider(successfulEvents(), (diagnostic) =>
      diagnostics.push(diagnostic),
    );
    await expect(
      assembly.provider.analyze(
        { ...analysisRequest(), sentenceContext: null },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });

    const publicResult = createProvider(successfulEvents(), (diagnostic) =>
      diagnostics.push(diagnostic),
    );
    await expect(
      publicResult.provider.analyze(
        { ...analysisRequest(), selection: "" },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });

    expect(diagnostics).toEqual([
      { field: "partOfSpeech", stage: "model-schema" },
      { field: "contextExampleTranslationZh", stage: "result-assembly" },
      { stage: "protocol-validation" },
    ]);
    expect(JSON.stringify(diagnostics)).not.toContain("secret-invalid-value");
  });

  it("cancels during lifecycle iteration before a late event is consumed", async () => {
    const controller = new AbortController();
    const { provider } = createProvider(successfulEvents(), undefined, () => controller.abort());

    await expect(provider.analyze(analysisRequest(), controller.signal)).rejects.toMatchObject({
      code: "CANCELLED",
    });
  });

  it("rejects more than one MiB of accumulated UTF-8", async () => {
    const oversized = "汉".repeat(400_000);
    const { provider } = createProvider(successfulEvents(oversized));
    await expect(
      provider.analyze(analysisRequest(), new AbortController().signal),
    ).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
  });
});
