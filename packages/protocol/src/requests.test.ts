import { describe, expect, it } from "vitest";

import {
  MAX_CONTEXT_LENGTH,
  MAX_SELECTION_LENGTH,
  analyzeRequestSchema,
  hostRequestSchema,
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
  it("accepts health, analyze, and cancel requests", () => {
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
