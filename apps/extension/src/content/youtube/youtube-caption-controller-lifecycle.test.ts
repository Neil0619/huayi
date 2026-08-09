import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  CapturedCaptionTrack,
  YouTubeCaptionBridge,
} from "./youtube-caption-bridge-client.js";
import { YouTubeCaptionController } from "./youtube-caption-controller.js";

const SOURCE: CapturedCaptionTrack = {
  cues: [
    { endMs: 4_000, startMs: 0, text: "The investigation was" },
    { endMs: 8_000, startMs: 4_000, text: "still in its early stages." },
  ],
  track: { kind: "asr", languageCode: "en" },
};
const TRANSLATED: CapturedCaptionTrack = {
  cues: [{ endMs: 8_000, startMs: 0, text: "调查仍处于早期阶段。" }],
  track: { kind: "asr", languageCode: "en" },
};

interface LifecycleFixture {
  bridge: YouTubeCaptionBridge;
  controller: YouTubeCaptionController;
  player: HTMLElement;
  setSource(source: CapturedCaptionTrack): void;
}

const controllers: YouTubeCaptionController[] = [];

function createFixture(): LifecycleFixture {
  document.body.textContent = "";
  const player = document.createElement("div");
  player.className = "html5-video-player";
  const video = document.createElement("video");
  Object.defineProperties(video, {
    currentTime: { configurable: true, get: () => 1 },
    duration: { configurable: true, get: () => 120 },
    paused: { configurable: true, get: () => false },
    pause: { configurable: true, value: vi.fn() },
    play: { configurable: true, value: vi.fn(() => Promise.resolve()) },
  });
  const nativeCaption = document.createElement("span");
  nativeCaption.className = "ytp-caption-segment";
  nativeCaption.textContent = "The investigation was";
  const captionRect = {
    bottom: 620,
    height: 32,
    left: 180,
    right: 620,
    top: 588,
    width: 440,
  };
  Object.defineProperty(nativeCaption, "getBoundingClientRect", {
    value: () => captionRect,
  });
  Object.defineProperty(nativeCaption, "getClientRects", { value: () => [captionRect] });
  const controls = document.createElement("div");
  controls.className = "ytp-chrome-controls ytp-right-controls";
  const cc = document.createElement("button");
  cc.className = "ytp-subtitles-button";
  cc.setAttribute("aria-pressed", "true");
  controls.append(cc);
  player.append(video, nativeCaption, controls);
  document.body.append(player);

  let source = SOURCE;
  let sourceStatus: "same-source" | "different-english" = "same-source";
  const capture = vi.fn(async ({ target }: { target: "source" | "translated" }) =>
    target === "source" ? source : TRANSLATED,
  );
  const bridge: YouTubeCaptionBridge = {
    capture,
    destroy: vi.fn(),
    probeSource: vi.fn(async () => sourceStatus),
  };
  const controller = new YouTubeCaptionController({
    bridge,
    document,
    getVideoId: () => "video-1",
    isOverlayVisible: () => false,
    isWatchPage: () => true,
    onPresentationChange: vi.fn(),
    onSelection: vi.fn(),
    onSessionClose: vi.fn(),
    onWarmup: vi.fn(),
  });
  controllers.push(controller);
  return {
    bridge,
    controller,
    player,
    setSource: (value) => {
      source = value;
      sourceStatus = "different-english";
    },
  };
}

async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

afterEach(() => {
  for (const controller of controllers.splice(0)) controller.destroy();
  document.body.textContent = "";
  vi.restoreAllMocks();
});

describe("YouTubeCaptionController lifecycle", () => {
  it("keeps the subtitle surface while YouTube rebuilds its controls", async () => {
    const fixture = createFixture();
    await settle();
    const surface = fixture.player.querySelector("[data-huayi-youtube-subtitle-surface]");
    fixture.player.querySelector(".ytp-chrome-controls")?.remove();
    await settle();

    expect(surface?.isConnected).toBe(true);

    const controls = document.createElement("div");
    controls.className = "ytp-chrome-controls ytp-right-controls";
    const cc = document.createElement("button");
    cc.className = "ytp-subtitles-button";
    cc.setAttribute("aria-pressed", "true");
    controls.append(cc);
    fixture.player.append(controls);
    await settle();

    expect(fixture.player.querySelector("[data-huayi-youtube-subtitle-surface]")).toBe(surface);
    expect(fixture.player.querySelector("[data-huayi-youtube-bilingual]")).not.toBeNull();
    expect(fixture.bridge.capture).toHaveBeenCalledTimes(2);
  });

  it("keeps navigation pending through page-data updates until navigation finishes", async () => {
    const fixture = createFixture();
    await settle();

    document.dispatchEvent(new Event("yt-navigate-start"));
    document.dispatchEvent(new Event("yt-page-data-updated"));
    await settle();

    expect(fixture.bridge.capture).toHaveBeenCalledTimes(2);

    document.dispatchEvent(new Event("yt-navigate-finish"));
    await settle();

    expect(fixture.bridge.capture).toHaveBeenCalledTimes(4);
  });

  it.each([
    ["bridge-driven Chinese", "这是自动翻译字幕"],
    ["rolling English correction", "An interim rolling caption correction"],
  ])("ignores a transient %s mismatch", async (_label, transientText) => {
    const fixture = createFixture();
    await settle();
    const surface = fixture.player.querySelector("[data-huayi-youtube-subtitle-surface]");
    const nativeCaption = fixture.player.querySelector(".ytp-caption-segment");
    if (nativeCaption === null) throw new Error("Expected native captions.");

    nativeCaption.textContent = transientText;
    await settle();
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    nativeCaption.textContent = "The investigation was";
    await settle();
    await new Promise((resolve) => setTimeout(resolve, 2_000));

    expect(fixture.player.querySelector("[data-huayi-youtube-subtitle-surface]")).toBe(surface);
    expect(fixture.bridge.capture).toHaveBeenCalledTimes(2);
  });

  it("reloads after a visible English track change remains stable", async () => {
    const fixture = createFixture();
    await settle();
    fixture.setSource({
      cues: [{ endMs: 8_000, startMs: 0, text: "A different English track." }],
      track: { kind: "asr", languageCode: "en" },
    });
    const nativeCaption = fixture.player.querySelector(".ytp-caption-segment");
    if (nativeCaption === null) throw new Error("Expected native captions.");

    nativeCaption.textContent = "A different English track.";
    await settle();
    await new Promise((resolve) => setTimeout(resolve, 2_100));
    await settle();

    expect(fixture.player.querySelector("[data-huayi-youtube-english]")?.textContent).toBe(
      "A different English track.",
    );
    expect(fixture.bridge.capture).toHaveBeenCalledTimes(4);
  });
});
