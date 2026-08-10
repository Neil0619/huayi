import { describe, expect, it } from "vitest";

import { parseContentCommand, parseShanbayCommand } from "./extension-messages.js";

const request = {
  action: "translate",
  context: "The investigation was in its early stages.",
  requestId: "request-1",
  schemaVersion: 7,
  selection: "investigation",
  selectionKind: "word",
  sentenceContext: null,
  targetLanguage: "zh-CN",
  type: "analyze",
} as const;

const addWordRequest = {
  context: "The investigation was in its early stages.",
  language: "en",
  requestId: "word-1",
  schemaVersion: 7,
  type: "add-word",
  word: "investigation",
} as const;

const checkWordRequest = {
  language: "en",
  requestId: "check-1",
  schemaVersion: 7,
  type: "check-word",
  word: "investigation",
} as const;

describe("parseContentCommand", () => {
  it("parses warmup, analyze, check-word, add-word, and cancel commands", () => {
    expect(parseContentCommand({ type: "WARMUP_HOST" })).toEqual({ type: "WARMUP_HOST" });
    expect(parseContentCommand({ request, type: "ANALYZE_SELECTION" })).toEqual({
      request,
      type: "ANALYZE_SELECTION",
    });
    expect(parseContentCommand({ request: addWordRequest, type: "ADD_WORD_TO_EUDIC" })).toEqual({
      request: addWordRequest,
      type: "ADD_WORD_TO_EUDIC",
    });
    expect(parseContentCommand({ request: checkWordRequest, type: "CHECK_WORD_IN_EUDIC" })).toEqual(
      {
        request: checkWordRequest,
        type: "CHECK_WORD_IN_EUDIC",
      },
    );
    expect(parseContentCommand({ requestId: "request-1", type: "CANCEL_REQUEST" })).toEqual({
      requestId: "request-1",
      type: "CANCEL_REQUEST",
    });
  });

  it("rejects unknown fields and malformed nested requests", () => {
    for (const extra of [
      { context: "page context" },
      { credential: "must-stay-host-private" },
      { endpoint: "http://third-party.example/v1" },
      { provider: "openai-compatible-http" },
      { request },
      { selection: "investigation" },
      { source: "overlay" },
    ]) {
      expect(parseContentCommand({ ...extra, type: "WARMUP_HOST" })).toBeNull();
    }
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
    expect(
      parseContentCommand({
        request: checkWordRequest,
        source: "overlay",
        type: "CHECK_WORD_IN_EUDIC",
      }),
    ).toBeNull();
    expect(
      parseContentCommand({
        request: { ...checkWordRequest, context: "unexpected" },
        type: "CHECK_WORD_IN_EUDIC",
      }),
    ).toBeNull();
    expect(parseContentCommand({ requestId: "request-1", type: "CANCEL_ANALYSIS" })).toBeNull();
  });
});

describe("parseShanbayCommand", () => {
  it("accepts only strict page-ready, batch-resolution, unresolved, and discard commands", () => {
    expect(parseShanbayCommand({ type: "SHANBAY_PAGE_READY" })).toEqual({
      type: "SHANBAY_PAGE_READY",
    });
    expect(
      parseShanbayCommand({
        batchId: "batch-1",
        rejectedTargets: ["orbiting"],
        type: "RESOLVE_SHANBAY_BATCH",
      }),
    ).toEqual({
      batchId: "batch-1",
      rejectedTargets: ["orbiting"],
      type: "RESOLVE_SHANBAY_BATCH",
    });
    expect(parseShanbayCommand({ offset: 100, type: "LIST_SHANBAY_UNRESOLVED" })).toEqual({
      offset: 100,
      type: "LIST_SHANBAY_UNRESOLVED",
    });
    expect(
      parseShanbayCommand({
        items: [{ sourceWord: "splendidly", targetWord: "splendid" }],
        type: "REQUEUE_SHANBAY_UNRESOLVED",
      }),
    ).toEqual({
      items: [{ sourceWord: "splendidly", targetWord: "splendid" }],
      type: "REQUEUE_SHANBAY_UNRESOLVED",
    });
    expect(
      parseShanbayCommand({
        sourceWords: ["splendidly"],
        type: "DISCARD_SHANBAY_UNRESOLVED",
      }),
    ).toEqual({
      sourceWords: ["splendidly"],
      type: "DISCARD_SHANBAY_UNRESOLVED",
    });
    expect(parseShanbayCommand({ type: "DISCARD_ALL_SHANBAY_UNRESOLVED" })).toEqual({
      type: "DISCARD_ALL_SHANBAY_UNRESOLVED",
    });
    expect(
      parseShanbayCommand({ type: "SHANBAY_PAGE_READY", url: "https://evil.invalid" }),
    ).toBeNull();
    expect(
      parseShanbayCommand({
        batchId: "bad batch",
        rejectedTargets: [],
        type: "RESOLVE_SHANBAY_BATCH",
      }),
    ).toBeNull();
    expect(
      parseShanbayCommand({
        batchId: "batch-1",
        rejectedTargets: ["Orbiting", "orbiting"],
        type: "RESOLVE_SHANBAY_BATCH",
      }),
    ).toBeNull();
    expect(
      parseShanbayCommand({
        sourceWords: [],
        type: "DISCARD_SHANBAY_UNRESOLVED",
      }),
    ).toBeNull();
    expect(
      parseShanbayCommand({
        sourceWords: ["splendidly"],
        type: "DISCARD_ALL_SHANBAY_UNRESOLVED",
      }),
    ).toBeNull();
    expect(
      parseShanbayCommand({
        confirm: true,
        type: "DISCARD_ALL_SHANBAY_UNRESOLVED",
      }),
    ).toBeNull();
  });
});
