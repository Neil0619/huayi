import { MAX_SELECTION_LENGTH } from "@huayi/protocol";
import { describe, expect, it } from "vitest";

import { createCaptionSelection } from "./caption-selection.js";

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

  it("keeps the full frozen caption when selecting a capitalized final word", () => {
    const titleCaption = "Why American Houses Are So Flimsy";

    expect(createCaptionSelection("Flimsy", titleCaption)).toEqual({
      context: titleCaption,
      selection: "Flimsy",
      selectionKind: "word",
      sentenceContext: titleCaption,
      wordbookContext: titleCaption,
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

  it("routes an exact full sentence through the frozen subtitle context", () => {
    expect(createCaptionSelection(caption, caption)).toEqual({
      context: caption,
      selection: caption,
      selectionKind: "sentence",
      sentenceContext: null,
      wordbookContext: null,
    });
  });

  it("treats an exact punctuation-free segmented caption as one sentence", () => {
    const shortCaption = "still in its early stages";

    expect(createCaptionSelection(shortCaption, shortCaption)).toEqual({
      context: shortCaption,
      selection: shortCaption,
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
