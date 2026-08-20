import { describe, expect, it } from "vitest";

import { classifyEnglishSelection, normalizeSelectionText } from "./selection.js";

describe("Store selection policy", () => {
  it.each([
    ["investigation", "word"],
    ["early stages", "phrase"],
    ["The investigation was still in its early stages.", "sentence"],
    ["First sentence. Second sentence.", "passage"],
  ] as const)("classifies %s as %s", (selection, kind) => {
    expect(classifyEnglishSelection(selection)).toBe(kind);
  });

  it("normalizes whitespace but rejects mixed Han and oversized text", () => {
    expect(normalizeSelectionText("  early\t stages  ")).toBe("early stages");
    expect(classifyEnglishSelection("investigation 调查")).toBeNull();
    expect(classifyEnglishSelection("a".repeat(2_001))).toBeNull();
  });
});
