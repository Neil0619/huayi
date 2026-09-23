import { afterEach, describe, expect, it, vi } from "vitest";

import { selectAsbplayerVideo } from "./asbplayer-video.js";
import { TEST_MEDIA } from "./asbplayer.test-support.js";

function video(preload: HTMLVideoElement["preload"] = "auto", left = 0) {
  const element = document.createElement("video");
  element.src = TEST_MEDIA;
  element.preload = preload;
  vi.spyOn(element, "getBoundingClientRect").mockReturnValue({
    x: left,
    y: 0,
    left,
    top: 0,
    right: left + 640,
    bottom: 360,
    width: 640,
    height: 360,
    toJSON: () => ({}),
  });
  const container = document.createElement("div");
  container.className = "asbplayer-token-container";
  container.append(element);
  document.body.append(container);
  return element;
}

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("asbplayer main media selection", () => {
  it("selects the visible main player while the same-src preview is hidden offscreen", () => {
    const main = video();
    video("none", -9999);
    expect(selectAsbplayerVideo(document, TEST_MEDIA)).toBe(main);
  });

  it("fails safely for two plausible visible players", () => {
    video();
    video();
    expect(selectAsbplayerVideo(document, TEST_MEDIA)).toBeNull();
  });

  it("requires official structure, exact src, visible layout, and a connected element", () => {
    const main = video();
    expect(selectAsbplayerVideo(document, `${TEST_MEDIA}-other`)).toBeNull();
    main.parentElement?.classList.remove("asbplayer-token-container");
    expect(selectAsbplayerVideo(document, TEST_MEDIA)).toBeNull();
    main.parentElement?.classList.add("asbplayer-token-container");
    main.parentElement?.setAttribute("hidden", "");
    expect(selectAsbplayerVideo(document, TEST_MEDIA)).toBeNull();
    main.parentElement?.removeAttribute("hidden");
    main.style.opacity = "0";
    expect(selectAsbplayerVideo(document, TEST_MEDIA)).toBeNull();
    main.remove();
    expect(selectAsbplayerVideo(document, TEST_MEDIA)).toBeNull();
  });
});
