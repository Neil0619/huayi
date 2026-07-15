import { describe, expect, it } from "vitest";

import {
  MAX_STREAM_DELTA_LENGTH,
  analysisDeltaEventSchema,
  hostEventSchema,
  modelProviderSchema,
  wordAddedEventSchema,
  wordStatusEventSchema,
} from "./index.js";

const PREVIOUS_SCHEMA_VERSION = 3;

const sectionEvents = [
  {
    requestId: "analysis-v2",
    schemaVersion: 4,
    section: "part-of-speech",
    sequence: 1,
    type: "analysis-section",
    value: "number",
  },
  {
    requestId: "analysis-v2",
    schemaVersion: 4,
    section: "pronunciation",
    sequence: 2,
    type: "analysis-section",
    value: { uk: "/ˈvɪktɪm/" },
  },
  {
    requestId: "analysis-v2",
    schemaVersion: 4,
    section: "base-form",
    sequence: 3,
    type: "analysis-section",
    value: "victim",
  },
  {
    requestId: "analysis-v2",
    schemaVersion: 4,
    section: "word-formation",
    sequence: 4,
    type: "analysis-section",
    value: "victim + -s",
  },
  {
    requestId: "analysis-v2",
    schemaVersion: 4,
    section: "core-meanings",
    sequence: 5,
    type: "analysis-section",
    value: [{ meaningZh: "受害者", partOfSpeech: "noun" }],
  },
  {
    requestId: "analysis-v2",
    schemaVersion: 4,
    section: "collocations",
    sequence: 6,
    type: "analysis-section",
    value: [{ meaningZh: "无辜的受害者", text: "innocent victims" }],
  },
  {
    requestId: "analysis-v2",
    schemaVersion: 4,
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
    schemaVersion: 4,
    section: "similar-terms",
    sequence: 8,
    type: "analysis-section",
    value: [{ meaningZh: "伤亡者", partOfSpeech: "noun", text: "casualty" }],
  },
  {
    requestId: "analysis-v2",
    schemaVersion: 4,
    section: "synonyms",
    sequence: 9,
    type: "analysis-section",
    value: [{ meaningZh: "受害者", partOfSpeech: "noun", text: "sufferer" }],
  },
] as const;

describe("hostEventSchema", () => {
  it("accepts strict compatible HTTP health on wire v4", () => {
    const compatibleHealth = {
      codexVersion: null,
      hostVersion: "0.6.0",
      model: "gpt-5.4-mini",
      provider: "openai-compatible-http",
      ready: true,
      requestId: "health-compatible",
      schemaVersion: 4,
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

  it("accepts strict provider-aware API health", () => {
    const apiHealth = {
      codexVersion: null,
      hostVersion: "0.5.0",
      model: "gpt-5.6-luna",
      provider: "openai-responses",
      ready: true,
      requestId: "health-api",
      schemaVersion: 4,
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
      hostVersion: "0.5.0",
      model: "gpt-5.4-mini",
      provider: "codex",
      ready: true,
      requestId: "health-codex",
      schemaVersion: 4,
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
        schemaVersion: 4,
        type: "health-result",
      },
      {
        requestId: "request-1",
        schemaVersion: 4,
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
        schemaVersion: 4,
        type: "result",
      },
      {
        outcome: "added",
        requestId: "word-1",
        schemaVersion: 4,
        type: "word-added",
      },
      {
        error: {
          code: "TIMEOUT",
          message: "处理超时，请重试。",
          retryable: true,
        },
        requestId: "request-1",
        schemaVersion: 4,
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
        schemaVersion: 4,
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
        schemaVersion: 4,
        stage: "queued",
        type: "progress",
        url: "https://example.com",
      }).success,
    ).toBe(false);
  });

  it("accepts only a strict warmup-ready event", () => {
    const warmupReady = {
      requestId: "warmup-1",
      schemaVersion: 4,
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
        schemaVersion: 4,
        type: "word-added",
      }).outcome,
    ).toBe(outcome);
  });

  it("rejects unknown fields", () => {
    expect(
      wordAddedEventSchema.safeParse({
        outcome: "added",
        requestId: "word-1",
        schemaVersion: 4,
        type: "word-added",
        word: "investigation",
      }).success,
    ).toBe(false);
  });
});

describe("analysisDeltaEventSchema", () => {
  const delta = {
    delta: "调查",
    requestId: "analysis-1",
    schemaVersion: 4,
    section: "contextual-meaning",
    sequence: 0,
    type: "analysis-delta",
  } as const;

  it("accepts an analysis delta as a host event", () => {
    expect(analysisDeltaEventSchema.parse(delta)).toEqual(delta);
    expect(hostEventSchema.parse(delta)).toEqual(delta);
  });

  it.each(["contextual-meaning", "translation", "main-structure", "context-role"] as const)(
    "accepts the %s section",
    (section) => {
      expect(analysisDeltaEventSchema.parse({ ...delta, section }).section).toBe(section);
    },
  );

  it("enforces delta and safe sequence limits", () => {
    expect(
      analysisDeltaEventSchema.safeParse({
        ...delta,
        delta: "x".repeat(MAX_STREAM_DELTA_LENGTH),
        sequence: Number.MAX_SAFE_INTEGER,
      }).success,
    ).toBe(true);
    expect(() => hostEventSchema.parse({ ...delta, sequence: -1 })).toThrow();
    expect(() => hostEventSchema.parse({ ...delta, sequence: 0.5 })).toThrow();
    expect(() =>
      hostEventSchema.parse({ ...delta, sequence: Number.MAX_SAFE_INTEGER + 1 }),
    ).toThrow();
    expect(() => hostEventSchema.parse({ ...delta, delta: "" })).toThrow();
    expect(() =>
      hostEventSchema.parse({ ...delta, delta: "x".repeat(MAX_STREAM_DELTA_LENGTH + 1) }),
    ).toThrow();
  });

  it("rejects unknown fields, the previous schema version, and another event union member", () => {
    expect(() => analysisDeltaEventSchema.parse({ ...delta, rawJson: "{}" })).toThrow();
    expect(() =>
      analysisDeltaEventSchema.parse({
        ...delta,
        schemaVersion: PREVIOUS_SCHEMA_VERSION,
      }),
    ).toThrow();
    expect(
      analysisDeltaEventSchema.safeParse({
        presence: "present",
        requestId: "check-1",
        schemaVersion: 4,
        type: "word-status",
      }).success,
    ).toBe(false);
  });
});

describe("wordStatusEventSchema", () => {
  const wordStatus = {
    presence: "present",
    requestId: "check-1",
    schemaVersion: 4,
    type: "word-status",
  } as const;

  it("accepts present as a host event", () => {
    expect(hostEventSchema.parse(wordStatus)).toMatchObject({
      presence: "present",
      type: "word-status",
    });
  });

  it.each(["present", "absent"] as const)("accepts the %s presence", (presence) => {
    expect(wordStatusEventSchema.parse({ ...wordStatus, presence }).presence).toBe(presence);
  });

  it("rejects unknown fields, values, schema versions, and another event union member", () => {
    expect(() => wordStatusEventSchema.parse({ ...wordStatus, word: "investigation" })).toThrow();
    expect(() => wordStatusEventSchema.parse({ ...wordStatus, presence: "unknown" })).toThrow();
    expect(() =>
      wordStatusEventSchema.parse({
        ...wordStatus,
        schemaVersion: PREVIOUS_SCHEMA_VERSION,
      }),
    ).toThrow();
    expect(
      wordStatusEventSchema.safeParse({
        outcome: "added",
        requestId: "word-1",
        schemaVersion: 4,
        type: "word-added",
      }).success,
    ).toBe(false);
  });
});
