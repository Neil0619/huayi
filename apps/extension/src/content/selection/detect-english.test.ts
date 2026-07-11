import { describe, expect, it } from "vitest";

import { isEnglishText, normalizeSelectionText } from "./detect-english.js";

describe("normalizeSelectionText", () => {
  it("normalizes horizontal whitespace while preserving meaningful line breaks", () => {
    expect(normalizeSelectionText("  First\t sentence.\r\n  Second   sentence.  ")).toBe(
      "First sentence.\nSecond sentence.",
    );
  });

  it("collapses repeated blank lines", () => {
    expect(normalizeSelectionText("First.\n\n\n\nSecond.")).toBe("First.\n\nSecond.");
  });
});

describe("isEnglishText", () => {
  it("accepts English with punctuation and numbers", () => {
    expect(isEnglishText("The investigation is in stage 2.")).toBe(true);
  });

  it("rejects empty, punctuation-only, and Chinese text", () => {
    expect(isEnglishText("   ")).toBe(false);
    expect(isEnglishText("123 -- ?")).toBe(false);
    expect(isEnglishText("investigation 调查")).toBe(false);
  });
});
