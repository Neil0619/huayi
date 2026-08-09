import { describe, expect, it } from "vitest";

import type { TimedCaptionCue } from "./youtube-caption-transcript.js";
import {
  LocalSubtitleSentenceSegmenter,
  alignTranslatedSentence,
  findSubtitleSentenceAt,
} from "./subtitle-sentence-segmenter.js";

function cue(startMs: number, endMs: number, text: string): TimedCaptionCue {
  return { endMs, startMs, text };
}

describe("LocalSubtitleSentenceSegmenter", () => {
  const segmenter = new LocalSubtitleSentenceSegmenter();

  it("ends a sentence at punctuation and displays the whole sentence from its first cue", () => {
    const sentences = segmenter.segment([
      cue(0, 1_000, "The investigation was"),
      cue(1_000, 2_000, "still in its early stages."),
      cue(2_000, 3_000, "Another sentence."),
    ]);

    expect(sentences).toEqual([
      {
        endMs: 2_000,
        startMs: 0,
        text: "The investigation was still in its early stages.",
      },
      { endMs: 3_000, startMs: 2_000, text: "Another sentence." },
    ]);
    expect(findSubtitleSentenceAt(sentences, 250)?.text).toBe(
      "The investigation was still in its early stages.",
    );
  });

  it("uses a 1.5 second inter-cue gap as a boundary without punctuation", () => {
    expect(
      segmenter.segment([cue(0, 1_000, "First thought"), cue(2_500, 3_000, "Second thought")]),
    ).toEqual([
      { endMs: 1_000, startMs: 0, text: "First thought" },
      { endMs: 3_000, startMs: 2_500, text: "Second thought" },
    ]);
  });

  it("soft-cuts at 120 Unicode code points or 12 seconds", () => {
    const byLength = segmenter.segment([
      cue(0, 2_000, "😀".repeat(120)),
      cue(2_000, 3_000, "tail"),
    ]);
    expect(byLength).toHaveLength(2);
    expect([...String(byLength[0]?.text)]).toHaveLength(120);

    const byDuration = segmenter.segment([cue(0, 12_000, "one two"), cue(12_000, 13_000, "three")]);
    expect(byDuration.map((sentence) => sentence.text)).toEqual(["one two", "three"]);
  });

  it("soft-cuts at the nearest cue boundary before a cue crosses the soft limit", () => {
    const byLength = segmenter.segment([
      cue(0, 1_000, "a".repeat(100)),
      cue(1_000, 2_000, "b".repeat(30)),
    ]);
    expect(byLength.map((sentence) => sentence.text.length)).toEqual([100, 30]);

    const byDuration = segmenter.segment([cue(0, 11_000, "first"), cue(11_000, 13_000, "second")]);
    expect(byDuration.map((sentence) => sentence.text)).toEqual(["first", "second"]);
  });

  it("hard-cuts before a cue would cross 200 code points or 15 seconds", () => {
    const byLength = segmenter.segment([
      cue(0, 1_000, "a".repeat(100)),
      cue(1_000, 2_000, "b".repeat(101)),
    ]);
    expect(byLength.map((sentence) => sentence.text.length)).toEqual([100, 101]);

    const byDuration = segmenter.segment([cue(0, 8_000, "one"), cue(8_000, 16_000, "two")]);
    expect(byDuration.map((sentence) => sentence.text)).toEqual(["one", "two"]);
  });
});

describe("alignTranslatedSentence", () => {
  it("uses positive time overlap rather than cue indexes and removes rolling duplicates", () => {
    const sentence = { endMs: 4_000, startMs: 1_000, text: "A complete sentence." };
    const translated = [
      cue(4_000, 5_000, "不应包含"),
      cue(2_000, 3_000, "完整的句子。"),
      cue(1_000, 2_100, "一个完整的"),
      cue(2_100, 3_100, "完整的句子。"),
      cue(0, 1_000, "不应包含"),
    ];

    expect(alignTranslatedSentence(sentence, translated)).toBe("一个完整的句子。");
  });

  it("omits Chinese when no translated cue overlaps the source sentence", () => {
    expect(
      alignTranslatedSentence({ endMs: 2_000, startMs: 1_000, text: "English." }, [
        cue(2_000, 3_000, "中文"),
      ]),
    ).toBeNull();
  });
});
