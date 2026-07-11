import { describe, expect, it } from "vitest";

import { parseContentCommand } from "./extension-messages.js";

const request = {
  action: "translate",
  context: "The investigation was in its early stages.",
  requestId: "request-1",
  schemaVersion: 1,
  selection: "investigation",
  selectionKind: "word",
  targetLanguage: "zh-CN",
  type: "analyze",
} as const;

const addWordRequest = {
  context: "The investigation was in its early stages.",
  language: "en",
  requestId: "word-1",
  schemaVersion: 1,
  type: "add-word",
  word: "investigation",
} as const;

describe("parseContentCommand", () => {
  it("parses analyze, add-word, and cancel commands", () => {
    expect(parseContentCommand({ request, type: "ANALYZE_SELECTION" })).toEqual({
      request,
      type: "ANALYZE_SELECTION",
    });
    expect(parseContentCommand({ request: addWordRequest, type: "ADD_WORD_TO_EUDIC" })).toEqual({
      request: addWordRequest,
      type: "ADD_WORD_TO_EUDIC",
    });
    expect(parseContentCommand({ requestId: "request-1", type: "CANCEL_REQUEST" })).toEqual({
      requestId: "request-1",
      type: "CANCEL_REQUEST",
    });
  });

  it("rejects unknown fields and malformed nested requests", () => {
    expect(
      parseContentCommand({ request, type: "ANALYZE_SELECTION", url: "https://example.com" }),
    ).toBeNull();
    expect(
      parseContentCommand({
        request: { ...request, action: "execute" },
        type: "ANALYZE_SELECTION",
      }),
    ).toBeNull();
    expect(
      parseContentCommand({ debug: true, requestId: "request-1", type: "CANCEL_REQUEST" }),
    ).toBeNull();
    expect(parseContentCommand({ requestId: "request-1", type: "CANCEL_ANALYSIS" })).toBeNull();
  });
});
