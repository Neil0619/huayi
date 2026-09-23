import { describe, expect, it } from "vitest";

import {
  MAX_ASBPLAYER_SNAPSHOT_BYTES,
  parseAsbplayerCues,
  snapshotFitsBudget,
  type AsbplayerSnapshot,
} from "./asbplayer-snapshot.js";
import { adapterHarness, cue } from "./asbplayer.test-support.js";

describe("asbplayer normalized snapshot budget", () => {
  it("accepts all eight tracks and exactly 2000 UTF-16 text units", () => {
    const { adapter, port } = adapterHarness();
    port.send({
      command: "subtitles",
      value: Array.from({ length: 8 }, (_, track) => cue({ track, text: "x".repeat(2000) })),
    });
    expect(adapter.getSnapshot().status).toBe("ready");
    expect(adapter.getSnapshot().cues).toHaveLength(8);
  });

  it("measures escaped and multibyte text after allowlist normalization", () => {
    const parsed = parseAsbplayerCues([cue({ text: '界\n"\\', fileName: "private" }), cue()], 0);
    expect(parsed).not.toBeNull();
    if (parsed === null) throw new Error("Expected valid fixture.");
    expect(parsed.contentBytes).toBe(
      new TextEncoder().encode(JSON.stringify(parsed.cues)).byteLength - 2,
    );
  });

  it("counts snapshot metadata at the exact 2 MiB boundary", () => {
    const snapshot: AsbplayerSnapshot = {
      status: "ready",
      reason: null,
      session: 1,
      revision: 1,
      offsetMs: 0,
      offsetKnown: true,
      cues: [],
      playback: null,
      playModes: [],
    };
    const metadataBytes = new TextEncoder().encode(JSON.stringify(snapshot)).byteLength;
    expect(snapshotFitsBudget(snapshot, MAX_ASBPLAYER_SNAPSHOT_BYTES - metadataBytes)).toBe(true);
    expect(snapshotFitsBudget(snapshot, MAX_ASBPLAYER_SNAPSHOT_BYTES - metadataBytes + 1)).toBe(
      false,
    );
  });

  it("does not retain the last good text after a byte overflow", () => {
    const { adapter, port } = adapterHarness();
    port.send({ command: "subtitles", value: [cue()] });
    port.send({
      command: "subtitles",
      value: Array.from({ length: 400 }, () => cue({ text: "界".repeat(2000) })),
    });
    expect(adapter.getSnapshot()).toMatchObject({
      status: "invalidated",
      cues: [],
      playback: null,
      playModes: null,
    });
    expect(new TextEncoder().encode(JSON.stringify(adapter.getSnapshot())).byteLength).toBeLessThan(
      MAX_ASBPLAYER_SNAPSHOT_BYTES,
    );
  });
});
