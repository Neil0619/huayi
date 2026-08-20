import { describe, expect, it } from "vitest";

import {
  STORE_MESSAGE_VERSION,
  parseLocalWordImportRequest,
  parseLocalWordImportResponse,
} from "./index.js";

describe("local word import messages", () => {
  it("accepts only strict Options commands without content or authority fields", () => {
    expect(
      parseLocalWordImportRequest({
        messageVersion: STORE_MESSAGE_VERSION,
        type: "store/local-word-import-preview",
      }),
    ).toBeTruthy();
    expect(
      parseLocalWordImportRequest({
        messageVersion: STORE_MESSAGE_VERSION,
        previewId: "a".repeat(64),
        type: "store/local-word-import-confirm",
      }),
    ).toBeTruthy();
    expect(() =>
      parseLocalWordImportRequest({
        messageVersion: STORE_MESSAGE_VERSION,
        sourceText: "must stay inside the service worker",
        type: "store/local-word-import-preview",
      }),
    ).toThrow();
  });

  it("parses only bounded aggregate preview, progress, and completion projections", () => {
    expect(
      parseLocalWordImportResponse({
        contextCount: 4,
        messageVersion: STORE_MESSAGE_VERSION,
        outcome: "preview",
        previewId: "a".repeat(64),
        type: "store/local-word-import-result",
        wordCount: 3,
      }),
    ).toBeTruthy();
    expect(
      parseLocalWordImportResponse({
        contextCount: 4,
        messageVersion: STORE_MESSAGE_VERSION,
        outcome: "progress",
        processedContextCount: 2,
        processedWordCount: 1,
        type: "store/local-word-import-result",
        wordCount: 3,
      }),
    ).toBeTruthy();
    expect(
      parseLocalWordImportResponse({
        contextCount: 4,
        createdContextCount: 3,
        createdWordCount: 2,
        duplicateContextCount: 1,
        existingWordCount: 1,
        messageVersion: STORE_MESSAGE_VERSION,
        outcome: "completed",
        type: "store/local-word-import-result",
        wordCount: 3,
      }),
    ).toBeTruthy();
    expect(() =>
      parseLocalWordImportResponse({
        messageVersion: STORE_MESSAGE_VERSION,
        outcome: "empty",
        sessionToken: "secret",
        type: "store/local-word-import-result",
      }),
    ).toThrow();
  });
});
