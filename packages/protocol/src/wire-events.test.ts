import { describe, expect, it } from "vitest";

import {
  MAX_STREAM_DELTA_LENGTH,
  analysisDeltaEventSchema,
  hostEventSchema,
  wordAddedEventSchema,
  wordStatusEventSchema,
} from "./index.js";

describe("hostEventSchema", () => {
  it("accepts health, progress, result, word-added, and error events", () => {
    const events = [
      {
        codexVersion: "codex-cli 0.144.1",
        hostVersion: "0.1.0",
        ready: true,
        requestId: "health-1",
        schemaVersion: 1,
        type: "health-result",
      },
      {
        requestId: "request-1",
        schemaVersion: 1,
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
        schemaVersion: 1,
        type: "result",
      },
      {
        outcome: "added",
        requestId: "word-1",
        schemaVersion: 1,
        type: "word-added",
      },
      {
        error: {
          code: "TIMEOUT",
          message: "处理超时，请重试。",
          retryable: true,
        },
        requestId: "request-1",
        schemaVersion: 1,
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
        schemaVersion: 1,
        type: "result",
      }).success,
    ).toBe(false);
    expect(
      hostEventSchema.safeParse({
        requestId: "request-1",
        schemaVersion: 2,
        stage: "queued",
        type: "progress",
      }).success,
    ).toBe(false);
    expect(
      hostEventSchema.safeParse({
        requestId: "request-1",
        schemaVersion: 1,
        stage: "queued",
        type: "progress",
        url: "https://example.com",
      }).success,
    ).toBe(false);
  });
});

describe("wordAddedEventSchema", () => {
  it.each(["added", "already-exists"] as const)("accepts the %s outcome", (outcome) => {
    expect(
      wordAddedEventSchema.parse({
        outcome,
        requestId: "word-1",
        schemaVersion: 1,
        type: "word-added",
      }).outcome,
    ).toBe(outcome);
  });

  it("rejects unknown fields", () => {
    expect(
      wordAddedEventSchema.safeParse({
        outcome: "added",
        requestId: "word-1",
        schemaVersion: 1,
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
    schemaVersion: 1,
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

  it("rejects unknown fields, schema version 2, and another event union member", () => {
    expect(() => analysisDeltaEventSchema.parse({ ...delta, rawJson: "{}" })).toThrow();
    expect(() => analysisDeltaEventSchema.parse({ ...delta, schemaVersion: 2 })).toThrow();
    expect(
      analysisDeltaEventSchema.safeParse({
        presence: "present",
        requestId: "check-1",
        schemaVersion: 1,
        type: "word-status",
      }).success,
    ).toBe(false);
  });
});

describe("wordStatusEventSchema", () => {
  const wordStatus = {
    presence: "present",
    requestId: "check-1",
    schemaVersion: 1,
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
    expect(() => wordStatusEventSchema.parse({ ...wordStatus, schemaVersion: 2 })).toThrow();
    expect(
      wordStatusEventSchema.safeParse({
        outcome: "added",
        requestId: "word-1",
        schemaVersion: 1,
        type: "word-added",
      }).success,
    ).toBe(false);
  });
});
