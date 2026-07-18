import { describe, expect, it } from "vitest";

import { isYouTubeHost, isYouTubeWatchPage, readCurrentCaption } from "./caption-reader.js";

function setVisibleRect(element: Element, top: number, left: number): void {
  const rect = {
    bottom: top + 20,
    height: 20,
    left,
    right: left + 120,
    top,
    width: 120,
    x: left,
    y: top,
    toJSON: () => ({}),
  };
  Object.defineProperty(element, "getBoundingClientRect", {
    configurable: true,
    value: () => rect,
  });
  Object.defineProperty(element, "getClientRects", {
    configurable: true,
    value: () => [rect],
  });
}

function appendCaption(player: Element, text: string, top: number, left: number): HTMLElement {
  const segment = document.createElement("span");
  segment.className = "ytp-caption-segment";
  segment.textContent = text;
  setVisibleRect(segment, top, left);
  player.append(segment);
  return segment;
}

describe("isYouTubeWatchPage", () => {
  it("accepts only standard YouTube watch pages", () => {
    expect(isYouTubeHost(new URL("https://www.youtube.com/"))).toBe(true);
    expect(isYouTubeHost(new URL("https://example.com/"))).toBe(false);
    expect(isYouTubeWatchPage(new URL("https://www.youtube.com/watch?v=example"))).toBe(true);
    expect(isYouTubeWatchPage(new URL("https://m.youtube.com/watch?v=example"))).toBe(true);
    expect(isYouTubeWatchPage(new URL("https://www.youtube.com/shorts/example"))).toBe(false);
    expect(isYouTubeWatchPage(new URL("https://www.youtube.com/live/example"))).toBe(false);
    expect(isYouTubeWatchPage(new URL("https://example.com/watch?v=example"))).toBe(false);
  });
});

describe("readCurrentCaption", () => {
  it("combines visible caption segments in visual order and ignores stale nodes", () => {
    const player = document.createElement("div");
    document.body.append(player);
    appendCaption(player, "still in its early stages.", 140, 20);
    appendCaption(player, "The investigation was", 120, 20);
    const stale = appendCaption(player, "Old duplicate caption", 100, 20);
    stale.style.display = "none";

    expect(readCurrentCaption(player)).toEqual({
      text: "The investigation was still in its early stages.",
    });
  });

  it("rejects captions without English text", () => {
    const player = document.createElement("div");
    document.body.append(player);
    appendCaption(player, "这是中文字幕", 120, 20);

    expect(readCurrentCaption(player)).toBeNull();
  });

  it("ignores a caption hidden by an ancestor", () => {
    const player = document.createElement("div");
    const hiddenWindow = document.createElement("div");
    hiddenWindow.style.opacity = "0";
    player.append(hiddenWindow);
    document.body.append(player);
    appendCaption(hiddenWindow, "Stale English caption", 120, 20);

    expect(readCurrentCaption(player)).toBeNull();
  });
});
