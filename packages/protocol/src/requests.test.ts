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

const validAnalyzeRequest = {
  action: "translate",
  context: "The investigation was in its early stages.",
  requestId: "request-1",
  schemaVersion: 1,
  selection: "investigation",
  selectionKind: "word",
  targetLanguage: "zh-CN",
  type: "analyze",
} as const;

describe("analyzeRequestSchema", () => {
  it("accepts a valid analysis request", () => {
    expect(analyzeRequestSchema.parse(validAnalyzeRequest)).toEqual(validAnalyzeRequest);
  });

  it("rejects unknown fields", () => {
    expect(
      analyzeRequestSchema.safeParse({ ...validAnalyzeRequest, url: "https://example.com" })
        .success,
    ).toBe(false);
  });

  it("enforces selection and context limits", () => {
    expect(
      analyzeRequestSchema.safeParse({
        ...validAnalyzeRequest,
        selection: "a".repeat(MAX_SELECTION_LENGTH + 1),
      }).success,
    ).toBe(false);
    expect(
      analyzeRequestSchema.safeParse({
        ...validAnalyzeRequest,
        context: "a".repeat(MAX_CONTEXT_LENGTH + 1),
      }).success,
    ).toBe(false);
  });

  it("rejects paragraph explanation", () => {
    expect(
      analyzeRequestSchema.safeParse({
        ...validAnalyzeRequest,
        action: "explain",
        selectionKind: "paragraph",
      }).success,
    ).toBe(false);
  });
});

describe("hostRequestSchema", () => {
  it("accepts health, analyze, add-word, and cancel requests", () => {
    expect(
      hostRequestSchema.parse({
        requestId: "health-1",
        schemaVersion: 1,
        type: "health",
      }).type,
    ).toBe("health");
    expect(hostRequestSchema.parse(validAnalyzeRequest).type).toBe("analyze");
    expect(
      hostRequestSchema.parse({
        context: "The investigation was in its early stages.",
        language: "en",
        requestId: "word-1",
        schemaVersion: 1,
        type: "add-word",
        word: "investigation",
      }).type,
    ).toBe("add-word");
    expect(
      hostRequestSchema.parse({
        requestId: "cancel-1",
        schemaVersion: 1,
        targetRequestId: "request-1",
        type: "cancel",
      }).type,
    ).toBe("cancel");
  });

  it("rejects unsupported message types and schema versions", () => {
    expect(
      hostRequestSchema.safeParse({
        requestId: "request-1",
        schemaVersion: 1,
        type: "unknown",
      }).success,
    ).toBe(false);
    expect(hostRequestSchema.safeParse({ ...validAnalyzeRequest, schemaVersion: 2 }).success).toBe(
      false,
    );
  });
});

describe("addWordRequestSchema", () => {
  const validRequest = {
    context: "The investigation was in its early stages.",
    language: "en",
    requestId: "word-1",
    schemaVersion: 1,
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

  it("rejects unknown fields and schema version 2", () => {
    expect(
      addWordRequestSchema.safeParse({ ...validRequest, url: "https://example.com" }).success,
    ).toBe(false);
    expect(addWordRequestSchema.safeParse({ ...validRequest, schemaVersion: 2 }).success).toBe(
      false,
    );
  });
});

describe("checkWordRequestSchema", () => {
  const checkWord = {
    language: "en",
    requestId: "check-1",
    schemaVersion: 1,
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

  it("rejects context, other unknown fields, and schema version 2", () => {
    expect(() => checkWordRequestSchema.parse({ ...checkWord, context: "not allowed" })).toThrow();
    expect(() =>
      checkWordRequestSchema.parse({ ...checkWord, url: "https://example.com" }),
    ).toThrow();
    expect(() => checkWordRequestSchema.parse({ ...checkWord, schemaVersion: 2 })).toThrow();
  });

  it("does not accept another host-work union member", () => {
    expect(
      checkWordRequestSchema.safeParse({
        context: "The investigation was in its early stages.",
        language: "en",
        requestId: "word-1",
        schemaVersion: 1,
        type: "add-word",
        word: "investigation",
      }).success,
    ).toBe(false);
  });
});
