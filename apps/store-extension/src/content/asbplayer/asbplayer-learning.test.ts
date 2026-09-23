import { describe, expect, it } from "vitest";
import { adapterHarness, cue } from "./asbplayer.test-support.js";
import { parseBridgeSnapshot } from "./asbplayer-bridge-contract.js";
import { createSubtitleIndex, segmentLocalCues } from "../subtitles/local-subtitles.js";
import { prepareAsbplayerTracks } from "./asbplayer-tracks.js";

describe("asbplayer learning readiness", () => {
  it("requires the first offset even when it is zero, then ignores echoes", () => {
    const { adapter, port } = adapterHarness();
    port.send({ command: "subtitles", value: [cue()] });
    expect(adapter.getSnapshot().offsetKnown).toBe(false);
    port.send({ command: "offset", value: 0 });
    const known = adapter.getSnapshot();
    expect(known.offsetKnown).toBe(true);
    port.send({ command: "offset", value: 0 });
    expect(adapter.getSnapshot()).toBe(known);
  });
  it("rejects private or forged fields at the isolated boundary", () => {
    const { adapter, port } = adapterHarness();
    port.send({ command: "subtitles", value: [cue()] });
    port.send({ command: "offset", value: 1500 });
    const snapshot = adapter.getSnapshot();
    expect(parseBridgeSnapshot(snapshot)).toEqual(snapshot);
    expect(parseBridgeSnapshot({ ...snapshot, fileName: "private.srt" })).toBeNull();
    expect(
      parseBridgeSnapshot({ ...snapshot, cues: [{ ...snapshot.cues[0], startMs: 0 }] }),
    ).toBeNull();
    expect(
      parseBridgeSnapshot({ ...snapshot, cues: [{ ...snapshot.cues[0], url: "secret" }] }),
    ).toBeNull();
  });
  it("splits only clear bilingual lines and rejects mixed lines", () => {
    const { adapter, port } = adapterHarness();
    port.send({ command: "subtitles", value: [cue({ text: "Hello world.\n你好世界。" })] });
    expect(prepareAsbplayerTracks(adapter.getSnapshot().cues, 0, 0)).toMatchObject({
      english: [{ text: "Hello world." }],
      chinese: [{ text: "你好世界。" }],
    });
    port.send({ command: "subtitles", value: [cue({ text: "Hello 你好 world" })] });
    expect(prepareAsbplayerTracks(adapter.getSnapshot().cues, 0, 0)).toBeNull();
  });
});

describe("local subtitle segmentation and interval index", () => {
  it("retains repeated and overlapping cues without rolling-ASR dedup", () => {
    const segments = segmentLocalCues([
      { startMs: 0, endMs: 1000, text: "Go" },
      { startMs: 500, endMs: 1500, text: "Go" },
      { startMs: 1600, endMs: 2000, text: "Go." },
    ]);
    expect(segments).toHaveLength(3);
    expect(
      createSubtitleIndex(segments)
        .at(700)
        .map((s) => s.text),
    ).toEqual(["Go", "Go"]);
    expect(createSubtitleIndex(segments).overlapping(800, 1700)).toHaveLength(3);
  });
  it("caps long unpunctuated blocks and never labels their fragments as sentences", () => {
    const segments = segmentLocalCues([{ startMs: 0, endMs: 40000, text: "word ".repeat(180) }]);
    expect(segments.length).toBeGreaterThan(1);
    expect(segments.every((s) => s.text.length <= 200 && s.endMs - s.startMs <= 15000)).toBe(true);
    expect(segments.every((s) => !s.complete)).toBe(true);
  });
  it("enforces duration caps even when rounded text partitions exceed fifteen seconds", () => {
    const segments = segmentLocalCues([{ startMs: 0, endMs: 40000, text: "abcdefghij" }]);
    expect(segments.every((s) => s.endMs - s.startMs <= 15000)).toBe(true);
    expect(segments[0]?.startMs).toBe(0);
    expect(segments.at(-1)?.endMs).toBe(40000);
  });
  it("does not turn a continuation after a forced soft bound into a complete sentence", () => {
    const segments = segmentLocalCues([
      { startMs: 0, endMs: 12000, text: "The start of the sentence" },
      { startMs: 12000, endMs: 15000, text: "and its ending." },
    ]);
    expect(segments[1]?.complete).toBe(false);
  });
  it("rejects pathological duration expansion without allocating unbounded derived segments", () => {
    expect(
      segmentLocalCues([{ startMs: 0, endMs: Number.MAX_SAFE_INTEGER, text: "Hello." }]),
    ).toEqual([]);
  });
  it("matches an independent linear overlap oracle, including exact interval boundaries", () => {
    const cues = Array.from({ length: 600 }, (_, id) => ({
      id,
      text: String(id),
      startMs: (id * 37) % 5000,
      endMs: ((id * 37) % 5000) + 1 + ((id * 73) % 1200),
    }));
    const index = createSubtitleIndex(cues);
    const ids = (values: typeof cues) => values.map((cue) => cue.id).sort((a, b) => a - b);
    for (let time = 0; time <= 6200; time += 17) {
      expect(ids(index.at(time))).toEqual(
        ids(cues.filter((cue) => cue.startMs <= time && time < cue.endMs)),
      );
      expect(ids(index.overlapping(time, time + 37))).toEqual(
        ids(cues.filter((cue) => cue.startMs < time + 37 && cue.endMs > time)),
      );
    }
  });
  it("marks complete sentence boundaries while preserving independent overlapping speakers", () => {
    const segments = segmentLocalCues([
      { startMs: 0, endMs: 1000, text: "This is" },
      { startMs: 1000, endMs: 2200, text: "a complete sentence." },
    ]);
    expect(segments).toEqual([
      { id: 0, startMs: 0, endMs: 2200, text: "This is a complete sentence.", complete: true },
    ]);
  });
});
