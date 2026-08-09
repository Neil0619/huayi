import { describe, expect, it } from "vitest";

import { isValidBridgePlayerState } from "./youtube-player-state.js";

function createPlayer(captionText?: string): {
  player: HTMLElement;
  video: HTMLVideoElement;
} {
  const player = document.createElement("div");
  const video = document.createElement("video");
  const captions = document.createElement("button");
  captions.className = "ytp-subtitles-button";
  captions.setAttribute("aria-pressed", "true");
  player.append(video, captions);
  if (captionText !== undefined) {
    const segment = document.createElement("span");
    segment.className = "ytp-caption-segment";
    segment.textContent = captionText;
    player.append(segment);
  }
  document.body.append(player);
  return { player, video };
}

describe("isValidBridgePlayerState", () => {
  it("accepts the transient empty cue state caused by restoring the verified English track", () => {
    const { player, video } = createPlayer();

    expect(isValidBridgePlayerState(player, video, { languageCode: "en" }, "source")).toBe(true);
  });

  it("rejects a visible non-English caption after capture", () => {
    const { player, video } = createPlayer("这是另一条字幕轨");

    expect(isValidBridgePlayerState(player, video, { languageCode: "en" }, "source")).toBe(false);
  });

  it("waits while the translated track driven by the bridge is still visible", () => {
    const { player, video } = createPlayer("这是自动翻译字幕");

    expect(isValidBridgePlayerState(player, video, { languageCode: "en" }, "translated")).toBe(
      "retry",
    );
  });
});
