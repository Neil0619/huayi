import { describe, expect, it } from "vitest";

import {
  MAX_STREAM_DELTA_LENGTH,
  analysisDeltaEventSchema,
  hostEventSchema,
  wordStatusEventSchema,
} from "./index.js";

const PREVIOUS_SCHEMA_VERSION = 4;

describe("analysisDeltaEventSchema", () => {
  const delta = {
    delta: "调查",
    requestId: "analysis-1",
    schemaVersion: 5,
    section: "contextual-meaning",
    sequence: 0,
    type: "analysis-delta",
  } as const;

  it("accepts an analysis delta as a host event", () => {
    expect(analysisDeltaEventSchema.parse(delta)).toEqual(delta);
    expect(hostEventSchema.parse(delta)).toEqual(delta);
  });

  it.each([
    "contextual-meaning",
    "contextual-analysis",
    "translation",
    "main-structure",
    "context-role",
  ] as const)("accepts the %s section", (section) => {
    expect(analysisDeltaEventSchema.parse({ ...delta, section }).section).toBe(section);
  });

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
        schemaVersion: 5,
        type: "word-status",
      }).success,
    ).toBe(false);
  });
});

describe("wordStatusEventSchema", () => {
  const wordStatus = {
    presence: "present",
    requestId: "check-1",
    schemaVersion: 5,
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
        schemaVersion: 5,
        type: "word-added",
      }).success,
    ).toBe(false);
  });
});
