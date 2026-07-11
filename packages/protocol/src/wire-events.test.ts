import { describe, expect, it } from "vitest";

import { hostEventSchema, wordAddedEventSchema } from "./index.js";

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
