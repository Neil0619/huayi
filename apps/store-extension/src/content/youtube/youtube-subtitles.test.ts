import { describe, expect, it } from "vitest";

import { alignTranslatedSentence, segmentSubtitleCues } from "./youtube-subtitles.js";

describe("Store YouTube subtitle sentence model", () => {
  it("joins rolling English cues into selectable sentences at punctuation", () => {
    expect(
      segmentSubtitleCues([
        { endMs: 2_000, startMs: 0, text: "The investigation was" },
        { endMs: 4_000, startMs: 2_000, text: "still in its early stages." },
        { endMs: 6_000, startMs: 4_000, text: "Another sentence." },
      ]),
    ).toEqual([
      {
        endMs: 4_000,
        startMs: 0,
        text: "The investigation was still in its early stages.",
      },
      { endMs: 6_000, startMs: 4_000, text: "Another sentence." },
    ]);
  });

  it("aligns translated cues only by positive overlap with the source sentence", () => {
    expect(
      alignTranslatedSentence({ endMs: 4_000, startMs: 0, text: "Hello world." }, [
        { endMs: 2_000, startMs: 0, text: "你好" },
        { endMs: 4_000, startMs: 2_000, text: "世界。" },
        { endMs: 5_000, startMs: 4_000, text: "不应包含" },
      ]),
    ).toBe("你好世界。");
  });
});
