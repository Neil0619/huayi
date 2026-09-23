import { describe, expect, it, vi } from "vitest";

import { createAsbplayerAdapter } from "./asbplayer-adapter.js";
import { adapterHarness, cue, TEST_URL } from "./asbplayer.test-support.js";

describe("passive asbplayer adapter", () => {
  it("starts waiting and never requests upstream state or credentials", () => {
    const { adapter, port } = adapterHarness();
    expect(adapter.getSnapshot().status).toBe("waiting");
    for (const command of [
      "ready",
      "init",
      "ankiSettings",
      "miscSettings",
      "saveTokenLocal",
      "copy",
    ]) {
      port.send({ command, token: "private", names: ["private.srt"] });
    }
    expect(adapter.getSnapshot().status).toBe("waiting");
    expect(JSON.stringify(adapter.getSnapshot())).not.toContain("private");
  });

  it("keeps only bounded subtitle fields, indexes and original timings", () => {
    const { adapter, port } = adapterHarness();
    port.send({
      command: "subtitles",
      value: [
        cue({
          tokenization: { token: "private" },
          fileName: "private.srt",
          textImage: { dataUrl: "private" },
        }),
      ],
      names: ["private.srt"],
    });
    expect(adapter.getSnapshot()).toMatchObject({
      status: "ready",
      offsetMs: 0,
      cues: [
        {
          index: 0,
          track: 0,
          text: "Hello world",
          originalStartMs: 1000,
          originalEndMs: 2000,
          startMs: 1000,
          endMs: 2000,
        },
      ],
    });
    expect(JSON.stringify(adapter.getSnapshot())).not.toMatch(/private|blob:|mediaUrl|channel/);
    expect(Object.isFrozen(adapter.getSnapshot().cues[0])).toBe(true);
  });

  it("applies absolute offset exactly once before/after snapshots and updates", () => {
    const { adapter, port } = adapterHarness();
    port.send({ command: "offset", value: 500 });
    port.send({ command: "subtitles", value: [cue()] });
    expect(adapter.getSnapshot().cues[0]?.startMs).toBe(1500);
    port.send({ command: "offset", value: 500 });
    port.send({ command: "subtitlesUpdated", subtitles: [cue({ index: 0, text: "Edited" })] });
    port.send({
      command: "subtitlesUpdated",
      updatedSubtitles: [cue({ index: 0, text: "Edited again" })],
    });
    expect(adapter.getSnapshot().cues[0]).toMatchObject({ text: "Edited again", startMs: 1500 });
    port.send({ command: "offset", value: -2000 });
    expect(adapter.getSnapshot().cues[0]?.startMs).toBe(-1000);
  });

  it("does not fabricate a full snapshot from updates or playback messages", () => {
    const { adapter, port } = adapterHarness();
    port.send({ command: "subtitlesUpdated", subtitles: [cue({ index: 0 })] });
    port.send({
      command: "playbackState",
      timestampMs: 1200,
      showingSubtitleIndexes: [0],
      paused: false,
    });
    expect(adapter.getSnapshot().status).toBe("waiting");
    expect(adapter.getSnapshot().cues).toEqual([]);
  });

  it("sanitizes playback state and accepts actual playModes array", () => {
    const { adapter, port } = adapterHarness();
    port.send({ command: "subtitles", value: [cue(), cue({ track: 1 })] });
    port.send({
      command: "playbackState",
      timestampMs: 1200,
      showingSubtitleIndexes: [0, 1],
      hiddenSubtitleIndexes: [1],
      paused: true,
      url: "private",
    });
    port.send({ command: "playModes", playModes: [1, 3] });
    expect(adapter.getSnapshot().playback).toEqual({
      timestampMs: 1200,
      showingSubtitleIndexes: [0, 1],
      hiddenSubtitleIndexes: [1],
      paused: true,
    });
    expect(adapter.getSnapshot().playModes).toEqual([1, 3]);
    port.send({
      command: "playbackState",
      timestampMs: 1300,
      showingSubtitleIndexes: [],
      paused: false,
    });
    expect(adapter.getSnapshot().playback?.hiddenSubtitleIndexes).toEqual([]);
  });

  it("keeps identical echoed offsets as a no-op", () => {
    const { adapter, port } = adapterHarness();
    port.send({ command: "subtitles", value: [cue()] });
    port.send({ command: "offset", value: 500 });
    const before = adapter.getSnapshot();
    port.send({ command: "offset", value: 500 });
    expect(adapter.getSnapshot()).toBe(before);
  });

  it("rejects reuse of a channel for different media because upstream has no session marker", () => {
    const { adapter, port, navigate, createChannel } = adapterHarness();
    port.send({ command: "subtitles", value: [cue()] });
    navigate(TEST_URL.replace("7fe82f76", "8fe82f76"));
    adapter.refreshContext();
    port.late({ command: "subtitles", value: [cue({ text: "Stale" })] });
    expect(adapter.getSnapshot()).toMatchObject({ status: "invalidated", cues: [] });
    expect(createChannel).toHaveBeenCalledTimes(1);
  });

  it("clears a rejected snapshot, then permits recovery only from a new full snapshot", () => {
    const { adapter, port } = adapterHarness();
    port.send({ command: "subtitles", value: [cue()] });
    port.send({ command: "subtitles", value: [cue({ text: "x".repeat(2001) })] });
    expect(adapter.getSnapshot()).toMatchObject({
      status: "invalidated",
      cues: [],
      playback: null,
    });
    port.send({ command: "subtitlesUpdated", subtitles: [cue({ index: 0 })] });
    expect(adapter.getSnapshot().status).toBe("invalidated");
    port.send({ command: "subtitles", value: [] });
    expect(adapter.getSnapshot()).toMatchObject({ status: "ready", cues: [] });
  });

  it.each([
    { command: "subtitles", value: [cue({ originalStart: Number.NaN })] },
    { command: "subtitles", value: [cue({ originalEnd: 999 })] },
    { command: "subtitles", value: [cue({ track: 8 })] },
    { command: "subtitles", value: [cue({ text: {} })] },
    { command: "subtitles", value: Array.from({ length: 50_001 }, () => cue()) },
    {
      command: "subtitles",
      value: Array.from({ length: 1000 }, () => cue({ text: "界".repeat(1000) })),
    },
    { command: "subtitlesUpdated", subtitles: [cue({ index: 1 })] },
    { command: "subtitlesUpdated", subtitles: [cue({ index: 0 }), cue({ index: 0 })] },
    {
      command: "subtitlesUpdated",
      subtitles: [cue({ index: 0 })],
      updatedSubtitles: [cue({ index: 0 })],
    },
    { command: "subtitlesUpdated", subtitles: [cue({ index: 0, originalStart: 999 })] },
    { command: "offset", value: Number.POSITIVE_INFINITY },
    { command: "playbackState", timestampMs: 0, showingSubtitleIndexes: [99999], paused: false },
    { command: "playModes", playModes: [1, 6] },
  ])("fails closed for malformed/oversized known messages %#", (data) => {
    const { adapter, port } = adapterHarness();
    port.send({ command: "subtitles", value: [cue()] });
    port.send(data);
    expect(adapter.getSnapshot().status).toBe("invalidated");
    expect(adapter.getSnapshot().cues).toEqual([]);
  });

  it("rejects queued events from the previous channel/session and clears on context loss", () => {
    const { adapter, port, ports, navigate } = adapterHarness();
    port.send({ command: "subtitles", value: [cue()] });
    navigate(TEST_URL.replace("test-channel", "next-channel"));
    port.late({ command: "subtitles", value: [cue({ text: "Old" })] });
    expect(adapter.getSnapshot()).toMatchObject({ status: "waiting", cues: [] });
    expect(port.close).toHaveBeenCalledOnce();
    ports[1]?.send({ command: "subtitles", value: [cue({ text: "New" })] });
    port.late({ command: "close" });
    expect(adapter.getSnapshot().cues[0]?.text).toBe("New");
    navigate("https://app.asbplayer.dev/");
    adapter.refreshContext();
    expect(adapter.getSnapshot()).toMatchObject({ status: "invalidated", cues: [] });
  });

  it.each(["close", "exit"])("cleans up on upstream %s without posting commands", (command) => {
    const { adapter, port } = adapterHarness();
    const listener = vi.fn();
    adapter.subscribe(listener);
    port.send({ command: "subtitles", value: [cue()] });
    port.send({ command });
    expect(adapter.getSnapshot()).toMatchObject({ status: "invalidated", cues: [] });
    expect(port.close).toHaveBeenCalledOnce();
    const calls = listener.mock.calls.length;
    port.late({ command: "subtitles", value: [cue()] });
    adapter.dispose();
    expect(listener).toHaveBeenCalledTimes(calls);
    expect(port.close).toHaveBeenCalledOnce();
  });

  it("unsubscribes observers and handles unavailable BroadcastChannel without leaking errors", () => {
    const { adapter, port } = adapterHarness();
    const listener = vi.fn();
    const unsubscribe = adapter.subscribe(listener);
    unsubscribe();
    port.send({ command: "subtitles", value: [cue()] });
    expect(listener).not.toHaveBeenCalled();
    expect(
      createAsbplayerAdapter({
        readContext: () => ({ channel: "test", mediaUrl: "private" }),
        createChannel: () => {
          throw new Error("private");
        },
      }).getSnapshot(),
    ).toMatchObject({ status: "invalidated", reason: "channel-unavailable" });
  });
});
