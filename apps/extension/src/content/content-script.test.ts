import { describe, expect, it } from "vitest";

import { createAnalyzeRequest } from "./content-script.js";

describe("createAnalyzeRequest", () => {
  it("creates a versioned protocol request without page metadata", () => {
    expect(
      createAnalyzeRequest(
        {
          context: "The investigation was in its early stages.",
          selection: "investigation",
          selectionKind: "word",
        },
        "translate",
        "request-1",
      ),
    ).toEqual({
      action: "translate",
      context: "The investigation was in its early stages.",
      requestId: "request-1",
      schemaVersion: 1,
      selection: "investigation",
      selectionKind: "word",
      targetLanguage: "zh-CN",
      type: "analyze",
    });
  });

  it("refuses paragraph explanation", () => {
    expect(() =>
      createAnalyzeRequest(
        {
          context: "First sentence. Second sentence.",
          selection: "First sentence. Second sentence.",
          selectionKind: "paragraph",
        },
        "explain",
        "request-2",
      ),
    ).toThrow();
  });
});
