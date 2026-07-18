import { MAX_SELECTION_LENGTH } from "@huayi/protocol";
import { describe, expect, it } from "vitest";

import { createCaptionSelection, segmentCaptionText } from "./caption-selection.js";

describe("segmentCaptionText", () => {
  it("preserves the caption while keeping apostrophes and hyphens inside words", () => {
    const caption = "A state-of-the-art tool doesn't guess.";
    const segments = segmentCaptionText(caption);

    expect(segments.map((segment) => segment.text).join("")).toBe(caption);
    expect(segments.filter((segment) => segment.isWordLike).map((segment) => segment.text)).toEqual(
      ["A", "state-of-the-art", "tool", "doesn't", "guess"],
    );
  });

  it("uses the same boundaries when Intl.Segmenter is unavailable", () => {
    const segments = segmentCaptionText("We're well-known.", null);

    expect(segments.map((segment) => segment.text).join("")).toBe("We're well-known.");
    expect(segments.filter((segment) => segment.isWordLike).map((segment) => segment.text)).toEqual(
      ["We're", "well-known"],
    );
  });
});

describe("createCaptionSelection", () => {
  const caption = "The investigation was still in its early stages.";

  it("uses the frozen caption as sentence and wordbook context for one word", () => {
    expect(createCaptionSelection("investigation", caption)).toEqual({
      context: caption,
      selection: "investigation",
      selectionKind: "word",
      sentenceContext: caption,
      wordbookContext: caption,
    });
  });

  it("uses the frozen caption as sentence context for a phrase", () => {
    expect(createCaptionSelection("early stages", caption)).toEqual({
      context: caption,
      selection: "early stages",
      selectionKind: "phrase",
      sentenceContext: caption,
      wordbookContext: null,
    });
  });

  it("does not fabricate lexical context for a full sentence", () => {
    expect(createCaptionSelection(caption, caption)).toEqual({
      context: caption,
      selection: caption,
      selectionKind: "sentence",
      sentenceContext: null,
      wordbookContext: null,
    });
  });

  it("rejects non-English and overlong content", () => {
    expect(createCaptionSelection("字幕", caption)).toBeNull();
    expect(createCaptionSelection("word", "x".repeat(MAX_SELECTION_LENGTH + 1))).toBeNull();
  });
});
