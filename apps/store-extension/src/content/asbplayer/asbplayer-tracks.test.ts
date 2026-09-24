import { describe, expect, it } from "vitest";
import { adapterHarness, cue } from "./asbplayer.test-support.js";
import { prepareAsbplayerTracks } from "./asbplayer-tracks.js";

function prepare(texts: readonly string[]) {
  const { adapter, port } = adapterHarness();
  port.send({
    command: "subtitles",
    value: texts.map((text, index) =>
      cue({ text, originalStart: index * 1000, originalEnd: (index + 1) * 1000 }),
    ),
  });
  return prepareAsbplayerTracks(adapter.getSnapshot().cues, 0, 0);
}

describe("real-file bilingual track preparation", () => {
  it("keeps Latin names in the Chinese line when an independent English line exists", () => {
    expect(prepare(["Please use Wi-Fi.\n请使用 Wi-Fi。"])).toMatchObject({
      english: [{ text: "Please use Wi-Fi.", startMs: 0, endMs: 1000 }],
      chinese: [{ text: "请使用 Wi-Fi。", startMs: 0, endMs: 1000 }],
      native: [],
    });
  });

  it("preserves credits, symbols and mixed-only cues for native display without rejecting dialogue", () => {
    expect(
      prepare([
        "字幕制作：Example 小组",
        "We can begin.\n我们可以开始了。",
        "■",
        "Hello 你好 world",
        "片尾说明",
        "Good night.",
      ]),
    ).toMatchObject({
      english: [{ text: "We can begin." }, { text: "Good night." }],
      chinese: [{ text: "我们可以开始了。" }],
      native: [
        { text: "字幕制作：Example 小组", startMs: 0, endMs: 1000 },
        { text: "■", startMs: 2000, endMs: 3000 },
        { text: "Hello 你好 world", startMs: 3000, endMs: 4000 },
        { text: "片尾说明", startMs: 4000, endMs: 5000 },
      ],
    });
  });

  it("preserves the whole cue when an additional line has an unknown language", () => {
    expect(prepare(["Ready.\n准备好了。", "Next.\n下一项。\nПривет"])).toMatchObject({
      english: [{ text: "Ready." }],
      native: [{ text: "Next.\n下一项。\nПривет" }],
    });
  });

  it.each(["Hello 你好 world", "Hello.\nWorld.", "中文说明", "■"])(
    "still requires independent bilingual evidence: %s",
    (text) => {
      expect(prepare([text])).toBeNull();
    },
  );
});
