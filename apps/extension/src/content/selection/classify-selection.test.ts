import { describe, expect, it } from "vitest";

import { classifySelection, supportsAction } from "./classify-selection.js";

describe("classifySelection", () => {
  it.each([
    ["investigation", "word"],
    ["state-of-the-art", "word"],
    ["sustained heatwave", "phrase"],
    ["He said the investigation was in its early stages.", "sentence"],
    ["This selection has enough words to form one sentence without final punctuation", "sentence"],
    ["First sentence. Second sentence.", "paragraph"],
    ["First line\nSecond line", "paragraph"],
  ] as const)("classifies %j as %s", (text, expected) => {
    expect(classifySelection(text)).toBe(expected);
  });
});

describe("supportsAction", () => {
  it("allows paragraph translation but not paragraph explanation", () => {
    expect(supportsAction("paragraph", "translate")).toBe(true);
    expect(supportsAction("paragraph", "explain")).toBe(false);
  });
});
