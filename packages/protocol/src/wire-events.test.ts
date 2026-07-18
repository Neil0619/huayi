import { describe, expect, it } from "vitest";

import { hostEventSchema, modelProviderSchema, wordAddedEventSchema } from "./index.js";

const PREVIOUS_SCHEMA_VERSION = 4;

const sectionEvents = [
  {
    requestId: "analysis-v2",
    schemaVersion: 5,
    section: "part-of-speech",
    sequence: 1,
    type: "analysis-section",
    value: "number",
  },
  {
    requestId: "analysis-v2",
    schemaVersion: 5,
    section: "pronunciation",
    sequence: 2,
    type: "analysis-section",
    value: { uk: "/ˈvɪktɪm/" },
  },
  {
    requestId: "analysis-v2",
    schemaVersion: 5,
    section: "base-form",
    sequence: 3,
    type: "analysis-section",
    value: "victim",
  },
  {
    requestId: "analysis-v2",
    schemaVersion: 5,
    section: "word-formation",
    sequence: 4,
    type: "analysis-section",
    value: "victim + -s",
  },
  {
    requestId: "analysis-v2",
    schemaVersion: 5,
    section: "core-meanings",
    sequence: 5,
    type: "analysis-section",
    value: [{ meaningZh: "受害者", partOfSpeech: "noun" }],
  },
  {
    requestId: "analysis-v2",
    schemaVersion: 5,
    section: "collocations",
    sequence: 6,
    type: "analysis-section",
    value: [{ meaningZh: "无辜的受害者", text: "innocent victims" }],
  },
  {
    requestId: "analysis-v2",
    schemaVersion: 5,
    section: "context-example",
    sequence: 7,
    type: "analysis-section",
    value: {
      english: "The victims were taken to safety.",
      translationZh: "受害者已被转移到安全地点。",
    },
  },
  {
    requestId: "analysis-v2",
    schemaVersion: 5,
    section: "similar-terms",
    sequence: 8,
    type: "analysis-section",
    value: [{ meaningZh: "伤亡者", partOfSpeech: "noun", text: "casualty" }],
  },
  {
    requestId: "analysis-v2",
    schemaVersion: 5,
    section: "synonyms",
    sequence: 9,
    type: "analysis-section",
    value: [{ meaningZh: "受害者", partOfSpeech: "noun", text: "sufferer" }],
  },
  {
    requestId: "analysis-v5",
    schemaVersion: 5,
    section: "contextual-sense",
    sequence: 10,
    type: "analysis-section",
    value: { meaningZh: "主要的", partOfSpeech: "adjective" },
  },
  {
    requestId: "analysis-v5",
    schemaVersion: 5,
    section: "common-meanings",
    sequence: 11,
    type: "analysis-section",
    value: [{ meaningsZh: ["主要的"], partOfSpeech: "adjective" }],
  },
  {
    requestId: "analysis-v5",
    schemaVersion: 5,
    section: "common-phrases",
    sequence: 12,
    type: "analysis-section",
    value: [{ meaningZh: "校长", text: "school principal" }],
  },
  {
    requestId: "analysis-v5",
    schemaVersion: 5,
    section: "confusable-words",
    sequence: 13,
    type: "analysis-section",
    value: [
      {
        distinctionZh: "principle 表示原则。",
        meaningZh: "原则",
        partOfSpeech: "noun",
        text: "principle",
      },
    ],
  },
  {
    requestId: "analysis-v5",
    schemaVersion: 5,
    section: "word-form",
    sequence: 14,
    type: "analysis-section",
    value: { baseForm: "sustain", formTypeZh: "过去式", sentenceRoleZh: "谓语" },
  },
  {
    requestId: "analysis-v5",
    schemaVersion: 5,
    section: "usage-notes",
    sequence: 15,
    type: "analysis-section",
    value: [{ descriptionZh: "后接名词。", titleZh: "及物用法" }],
  },
  {
    requestId: "analysis-v5",
    schemaVersion: 5,
    section: "synonym-comparisons",
    sequence: 16,
    type: "analysis-section",
    value: [
      {
        distinctionZh: "maintain 更强调保持。",
        meaningZh: "维持",
        partOfSpeech: "verb",
        text: "maintain",
      },
    ],
  },
] as const;

describe("hostEventSchema", () => {
  it("accepts strict compatible HTTP health on wire v5", () => {
    const compatibleHealth = {
      codexVersion: null,
      hostVersion: "0.9.0",
      model: "gpt-5.4-mini",
      provider: "openai-compatible-http",
      ready: true,
      requestId: "health-compatible",
      schemaVersion: 5,
      type: "health-result",
    } as const;

    expect(modelProviderSchema.parse("openai-compatible-http")).toBe("openai-compatible-http");
    expect(hostEventSchema.parse(compatibleHealth)).toEqual(compatibleHealth);
    expect(() =>
      hostEventSchema.parse({ ...compatibleHealth, schemaVersion: PREVIOUS_SCHEMA_VERSION }),
    ).toThrow();
    expect(() => hostEventSchema.parse({ ...compatibleHealth, codexVersion: "0.144.2" })).toThrow();
    expect(() =>
      hostEventSchema.parse({ ...compatibleHealth, endpoint: "http://example" }),
    ).toThrow();
  });

  it("accepts strict DeepSeek health only for the fixed model", () => {
    const deepSeekHealth = {
      codexVersion: null,
      hostVersion: "0.9.0",
      model: "deepseek-v4-flash",
      provider: "deepseek-chat-completions",
      ready: true,
      requestId: "health-deepseek",
      schemaVersion: 5,
      type: "health-result",
    } as const;

    expect(modelProviderSchema.parse("deepseek-chat-completions")).toBe(
      "deepseek-chat-completions",
    );
    expect(hostEventSchema.parse(deepSeekHealth)).toEqual(deepSeekHealth);
    expect(() => hostEventSchema.parse({ ...deepSeekHealth, model: "deepseek-chat" })).toThrow();
    expect(() => hostEventSchema.parse({ ...deepSeekHealth, codexVersion: "0.144.2" })).toThrow();
    expect(() =>
      hostEventSchema.parse({ ...deepSeekHealth, endpoint: "https://evil.invalid" }),
    ).toThrow();
  });

  it("accepts strict provider-aware API health", () => {
    const apiHealth = {
      codexVersion: null,
      hostVersion: "0.9.0",
      model: "gpt-5.6-luna",
      provider: "openai-responses",
      ready: true,
      requestId: "health-api",
      schemaVersion: 5,
      type: "health-result",
    } as const;

    expect(hostEventSchema.parse(apiHealth)).toEqual(apiHealth);
    expect(() =>
      hostEventSchema.parse({ ...apiHealth, schemaVersion: PREVIOUS_SCHEMA_VERSION }),
    ).toThrow();
    expect(() =>
      hostEventSchema.parse({ ...apiHealth, endpoint: "https://evil.invalid" }),
    ).toThrow();
    expect(() =>
      hostEventSchema.parse({ ...apiHealth, codexVersion: "codex-cli 0.144.1" }),
    ).toThrow();
  });

  it("accepts Codex health only with a Codex version", () => {
    const codexHealth = {
      codexVersion: "codex-cli 0.144.1",
      hostVersion: "0.9.0",
      model: "gpt-5.4-mini",
      provider: "codex",
      ready: true,
      requestId: "health-codex",
      schemaVersion: 5,
      type: "health-result",
    } as const;

    expect(hostEventSchema.parse(codexHealth)).toEqual(codexHealth);
    expect(() => hostEventSchema.parse({ ...codexHealth, codexVersion: null })).toThrow();
  });

  it("accepts health, progress, result, word-added, and error events", () => {
    const events = [
      {
        codexVersion: "codex-cli 0.144.1",
        hostVersion: "0.1.0",
        model: "gpt-5.4-mini",
        provider: "codex",
        ready: true,
        requestId: "health-1",
        schemaVersion: 5,
        type: "health-result",
      },
      {
        requestId: "request-1",
        schemaVersion: 5,
        stage: "queued",
        type: "progress",
      },
      {
        requestId: "request-1",
        result: {
          selectionKind: "sentence",
          sourceText: "It is ready.",
          translationZh: "它已准备就绪。",
          type: "translate-passage",
        },
        schemaVersion: 5,
        type: "result",
      },
      {
        outcome: "added",
        requestId: "word-1",
        schemaVersion: 5,
        type: "word-added",
      },
      {
        error: {
          code: "TIMEOUT",
          message: "处理超时，请重试。",
          retryable: true,
        },
        requestId: "request-1",
        schemaVersion: 5,
        type: "error",
      },
    ] as const;

    expect(events.map((event) => hostEventSchema.parse(event).type)).toEqual([
      "health-result",
      "progress",
      "result",
      "word-added",
      "error",
    ]);
  });

  it("rejects invalid nested results, schema versions, and unknown fields", () => {
    expect(
      hostEventSchema.safeParse({
        requestId: "request-1",
        result: { type: "unvalidated" },
        schemaVersion: 5,
        type: "result",
      }).success,
    ).toBe(false);
    expect(
      hostEventSchema.safeParse({
        requestId: "request-1",
        schemaVersion: PREVIOUS_SCHEMA_VERSION,
        stage: "queued",
        type: "progress",
      }).success,
    ).toBe(false);
    expect(
      hostEventSchema.safeParse({
        requestId: "request-1",
        schemaVersion: 5,
        stage: "queued",
        type: "progress",
        url: "https://example.com",
      }).success,
    ).toBe(false);
  });

  it("accepts only a strict warmup-ready event", () => {
    const warmupReady = {
      requestId: "warmup-1",
      schemaVersion: 5,
      type: "warmup-ready",
    } as const;

    expect(hostEventSchema.parse(warmupReady)).toMatchObject({ type: "warmup-ready" });
    expect(() => hostEventSchema.parse({ ...warmupReady, selection: "secret" })).toThrow();
    expect(() =>
      hostEventSchema.parse({
        ...warmupReady,
        schemaVersion: PREVIOUS_SCHEMA_VERSION,
      }),
    ).toThrow();
  });

  it.each(sectionEvents)("accepts the $section structured section", (event) => {
    expect(hostEventSchema.parse(event)).toEqual(event);
  });

  it.each(sectionEvents)("keeps the $section structured section strict", (event) => {
    expect(() => hostEventSchema.parse({ ...event, rawJson: "{}" })).toThrow();
  });
});

describe("wordAddedEventSchema", () => {
  it.each(["added", "already-exists"] as const)("accepts the %s outcome", (outcome) => {
    expect(
      wordAddedEventSchema.parse({
        outcome,
        requestId: "word-1",
        schemaVersion: 5,
        type: "word-added",
      }).outcome,
    ).toBe(outcome);
  });

  it("rejects unknown fields", () => {
    expect(
      wordAddedEventSchema.safeParse({
        outcome: "added",
        requestId: "word-1",
        schemaVersion: 5,
        type: "word-added",
        word: "investigation",
      }).success,
    ).toBe(false);
  });
});
