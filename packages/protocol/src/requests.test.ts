import { describe, expect, it } from "vitest";

import {
  MAX_CONTEXT_LENGTH,
  MAX_SELECTION_LENGTH,
  addWordRequestSchema,
  analyzeRequestSchema,
  checkWordRequestSchema,
  hostRequestSchema,
  hostWorkRequestSchema,
} from "./index.js";

const PREVIOUS_SCHEMA_VERSION = 3;

const lexicalRequest = {
  action: "translate",
  context: "The victims were taken to safety.",
  requestId: "analysis-v2",
  schemaVersion: 5,
  selection: "victims",
  selectionKind: "word",
  sentenceContext: "The victims were taken to safety.",
  targetLanguage: "zh-CN",
  type: "analyze",
} as const;

describe("analyzeRequestSchema", () => {
  it("accepts a v2 lexical request with an exact English sentence context", () => {
    expect(analyzeRequestSchema.parse(lexicalRequest)).toEqual(lexicalRequest);
    expect(() =>
      analyzeRequestSchema.parse({ ...lexicalRequest, sentenceContext: "受害者 were safe." }),
    ).toThrow();
    expect(() =>
      analyzeRequestSchema.parse({
        ...lexicalRequest,
        selectionKind: "sentence",
        sentenceContext: lexicalRequest.sentenceContext,
      }),
    ).toThrow();
    expect(() =>
      analyzeRequestSchema.parse({
        ...lexicalRequest,
        schemaVersion: PREVIOUS_SCHEMA_VERSION,
      }),
    ).toThrow();
  });

  it("rejects unknown fields", () => {
    expect(
      analyzeRequestSchema.safeParse({ ...lexicalRequest, url: "https://example.com" }).success,
    ).toBe(false);
  });

  it("enforces selection and context limits", () => {
    expect(
      analyzeRequestSchema.safeParse({
        ...lexicalRequest,
        selection: "a".repeat(MAX_SELECTION_LENGTH + 1),
      }).success,
    ).toBe(false);
    expect(
      analyzeRequestSchema.safeParse({
        ...lexicalRequest,
        context: "a".repeat(MAX_CONTEXT_LENGTH + 1),
      }).success,
    ).toBe(false);
  });

  it("rejects paragraph explanation", () => {
    expect(
      analyzeRequestSchema.safeParse({
        ...lexicalRequest,
        action: "explain",
        selectionKind: "paragraph",
        sentenceContext: null,
      }).success,
    ).toBe(false);
  });
});

describe("hostRequestSchema", () => {
  it("accepts health, analyze, add-word, and cancel requests", () => {
    expect(
      hostRequestSchema.parse({
        requestId: "health-1",
        schemaVersion: 5,
        type: "health",
      }).type,
    ).toBe("health");
    expect(hostRequestSchema.parse(lexicalRequest).type).toBe("analyze");
    expect(
      hostRequestSchema.parse({
        context: "The investigation was in its early stages.",
        language: "en",
        requestId: "word-1",
        schemaVersion: 5,
        type: "add-word",
        word: "investigation",
      }).type,
    ).toBe("add-word");
    expect(
      hostRequestSchema.parse({
        requestId: "cancel-1",
        schemaVersion: 5,
        targetRequestId: lexicalRequest.requestId,
        type: "cancel",
      }).type,
    ).toBe("cancel");
  });

  it("accepts only a strict warmup request outside the host work union", () => {
    const warmup = {
      requestId: "warmup-1",
      schemaVersion: 5,
      type: "warmup",
    } as const;

    expect(hostRequestSchema.parse(warmup)).toEqual(warmup);
    expect(() => hostRequestSchema.parse({ ...warmup, selection: "secret" })).toThrow();
    expect(hostWorkRequestSchema.safeParse(warmup).success).toBe(false);
  });

  it("rejects unsupported message types and schema versions", () => {
    expect(
      hostRequestSchema.safeParse({
        requestId: "request-1",
        schemaVersion: 5,
        type: "unknown",
      }).success,
    ).toBe(false);
    expect(
      hostRequestSchema.safeParse({
        ...lexicalRequest,
        schemaVersion: PREVIOUS_SCHEMA_VERSION,
      }).success,
    ).toBe(false);
  });
});

describe("addWordRequestSchema", () => {
  const validRequest = {
    context: "The investigation was in its early stages.",
    language: "en",
    requestId: "word-1",
    schemaVersion: 5,
    type: "add-word",
    word: "investigation",
  } as const;

  it.each(["investigation", "state-of-the-art", "don't", "writer’s"])(
    "accepts the English word %s",
    (word) => {
      expect(addWordRequestSchema.parse({ ...validRequest, word }).word).toBe(word);
    },
  );

  it("rejects phrases, Han text, empty and oversized context", () => {
    expect(addWordRequestSchema.safeParse({ ...validRequest, word: "early stages" }).success).toBe(
      false,
    );
    expect(addWordRequestSchema.safeParse({ ...validRequest, word: "调查" }).success).toBe(false);
    expect(
      addWordRequestSchema.safeParse({ ...validRequest, context: "调查 ongoing" }).success,
    ).toBe(false);
    expect(addWordRequestSchema.safeParse({ ...validRequest, context: "𠀀 ongoing" }).success).toBe(
      false,
    );
    expect(addWordRequestSchema.safeParse({ ...validRequest, context: "" }).success).toBe(false);
    expect(
      addWordRequestSchema.safeParse({
        ...validRequest,
        context: "a".repeat(MAX_CONTEXT_LENGTH + 1),
      }).success,
    ).toBe(false);
  });

  it("rejects unknown fields and the previous schema version", () => {
    expect(
      addWordRequestSchema.safeParse({ ...validRequest, url: "https://example.com" }).success,
    ).toBe(false);
    expect(
      addWordRequestSchema.safeParse({
        ...validRequest,
        schemaVersion: PREVIOUS_SCHEMA_VERSION,
      }).success,
    ).toBe(false);
  });
});

describe("checkWordRequestSchema", () => {
  const checkWord = {
    language: "en",
    requestId: "check-1",
    schemaVersion: 5,
    type: "check-word",
    word: "mother-in-law",
  } as const;

  it("accepts a strict read-only word lookup request in both host request unions", () => {
    expect(checkWordRequestSchema.parse(checkWord)).toEqual(checkWord);
    expect(hostWorkRequestSchema.parse(checkWord)).toEqual(checkWord);
    expect(hostRequestSchema.parse(checkWord)).toEqual(checkWord);
  });

  it.each(["mother-in-law", "don't", "writer’s"])("accepts the English word %s", (word) => {
    expect(checkWordRequestSchema.parse({ ...checkWord, word }).word).toBe(word);
  });

  it("rejects phrases and Han text", () => {
    expect(() => checkWordRequestSchema.parse({ ...checkWord, word: "two words" })).toThrow();
    expect(() => checkWordRequestSchema.parse({ ...checkWord, word: "调查" })).toThrow();
    expect(() => checkWordRequestSchema.parse({ ...checkWord, word: "𠀀" })).toThrow();
  });

  it("rejects context, other unknown fields, and the previous schema version", () => {
    expect(() => checkWordRequestSchema.parse({ ...checkWord, context: "not allowed" })).toThrow();
    expect(() =>
      checkWordRequestSchema.parse({ ...checkWord, url: "https://example.com" }),
    ).toThrow();
    expect(() =>
      checkWordRequestSchema.parse({
        ...checkWord,
        schemaVersion: PREVIOUS_SCHEMA_VERSION,
      }),
    ).toThrow();
  });

  it("does not accept another host-work union member", () => {
    expect(
      checkWordRequestSchema.safeParse({
        context: "The investigation was in its early stages.",
        language: "en",
        requestId: "word-1",
        schemaVersion: 5,
        type: "add-word",
        word: "investigation",
      }).success,
    ).toBe(false);
  });
});
