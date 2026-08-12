import { afterEach, describe, expect, it, vi } from "vitest";

import type { CaptionBridge, CapturedCaptionTrack } from "./youtube-bridge-client.js";
import { YouTubeCaptionController } from "./youtube-caption-controller.js";

const source: CapturedCaptionTrack = {
  cues: [
    { endMs: 2_000, startMs: 0, text: "The investigation was" },
    { endMs: 4_000, startMs: 2_000, text: "still in its early stages." },
  ],
  track: { kind: "asr", languageCode: "en" },
};
const translated: CapturedCaptionTrack = {
  cues: [{ endMs: 4_000, startMs: 0, text: "调查仍处于早期阶段。" }],
  track: { kind: "asr", languageCode: "en" },
};

async function settle(): Promise<void> {
  for (let attempt = 0; attempt < 8; attempt += 1) await Promise.resolve();
}

afterEach(() => {
  document.body.textContent = "";
  window.getSelection()?.removeAllRanges();
  vi.restoreAllMocks();
});

describe("Store YouTube visible source-track lifecycle", () => {
  it("clears an English session for a visible German cue and rebuilds once on English", async () => {
    const player = document.createElement("div");
    player.className = "html5-video-player";
    const video = document.createElement("video");
    let paused = false;
    const pause = vi.fn(() => {
      paused = true;
    });
    const play = vi.fn(async () => {
      paused = false;
    });
    Object.defineProperties(video, {
      currentTime: { configurable: true, get: () => 1 },
      duration: { configurable: true, get: () => 120 },
      paused: { configurable: true, get: () => paused },
      pause: { configurable: true, value: pause },
      play: { configurable: true, value: play },
    });
    const nativeCaption = document.createElement("span");
    nativeCaption.className = "ytp-caption-segment";
    nativeCaption.textContent = "The investigation was";
    const cc = document.createElement("button");
    cc.className = "ytp-subtitles-button";
    cc.setAttribute("aria-pressed", "true");
    const controls = document.createElement("div");
    controls.className = "ytp-chrome-controls ytp-right-controls";
    controls.append(cc);
    player.append(video, nativeCaption, controls);
    document.body.append(player);

    const capture = vi.fn<CaptionBridge["capture"]>(async (request) => {
      if (request.target === "translated") return translated;
      return nativeCaption.textContent?.startsWith("The investigation") === true ? source : null;
    });
    const overlay = { close: vi.fn(), show: vi.fn() };
    const controller = new YouTubeCaptionController({
      acceptsUserGesture: () => true,
      bridge: { capture, destroy: vi.fn() },
      document,
      getVideoId: () => "video-1",
      isWatchPage: () => true,
      mode: "english",
      overlay,
      waitForTranslatedRetry: async () => undefined,
    });
    controller.start();
    await settle();

    const english = player.querySelector<HTMLElement>("[data-huayi-store-youtube-english]");
    const text = english?.firstChild;
    if (!(english instanceof HTMLElement) || !(text instanceof Text)) {
      throw new Error("Expected an established Store English subtitle.");
    }
    const range = document.createRange();
    range.setStart(text, 4);
    range.setEnd(text, 17);
    Object.defineProperty(range, "getBoundingClientRect", {
      value: () => ({ bottom: 40, left: 20, top: 20 }),
    });
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
    english.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    expect(overlay.show).toHaveBeenCalledOnce();
    expect(pause).toHaveBeenCalledOnce();

    nativeCaption.textContent = "wie eine Schicht auf der Oberfläche";
    await settle();

    expect(player.hasAttribute("data-huayi-store-youtube-active")).toBe(false);
    expect(player.querySelector("[data-huayi-store-youtube-subtitles]")).toBeNull();
    expect(player.querySelector("[data-huayi-store-youtube-control-host]")).toBeNull();
    expect(player.querySelector("[data-huayi-store-youtube-bilingual]")).toBeNull();
    expect(player.querySelector("[data-huayi-store-youtube-temporary-translation]")).toBeNull();
    expect(window.getSelection()?.isCollapsed).toBe(true);
    expect(overlay.close).toHaveBeenCalledWith("owner-clear");
    expect(play).not.toHaveBeenCalled();
    expect(capture).toHaveBeenCalledTimes(3);

    player.classList.add("unrelated-player-state");
    await settle();
    expect(capture).toHaveBeenCalledTimes(3);

    nativeCaption.textContent = "The investigation was";
    await settle();

    expect(player.querySelectorAll("[data-huayi-store-youtube-subtitles]")).toHaveLength(1);
    expect(player.querySelectorAll("[data-huayi-store-youtube-control-host]")).toHaveLength(1);
    expect(player.querySelectorAll("[data-huayi-store-youtube-bilingual]")).toHaveLength(1);
    expect(
      player.querySelectorAll("[data-huayi-store-youtube-temporary-translation]"),
    ).toHaveLength(1);
    expect(capture.mock.calls.map(([request]) => request.target)).toEqual([
      "source",
      "translated",
      "source",
      "source",
      "translated",
    ]);
    controller.stop();
  });

  it("refreshes an English ASR revision without clearing the established view", async () => {
    const revisedSource: CapturedCaptionTrack = {
      cues: [{ endMs: 4_000, startMs: 0, text: "The inquiry was still in its early phase." }],
      track: { kind: "asr", languageCode: "en" },
    };
    const player = document.createElement("div");
    player.className = "html5-video-player";
    const video = document.createElement("video");
    Object.defineProperties(video, {
      currentTime: { configurable: true, get: () => 1 },
      duration: { configurable: true, get: () => 120 },
    });
    const nativeCaption = document.createElement("span");
    nativeCaption.className = "ytp-caption-segment";
    nativeCaption.textContent = "The investigation was";
    const cc = document.createElement("button");
    cc.className = "ytp-subtitles-button";
    cc.setAttribute("aria-pressed", "true");
    const controls = document.createElement("div");
    controls.className = "ytp-chrome-controls ytp-right-controls";
    controls.append(cc);
    player.append(video, nativeCaption, controls);
    document.body.append(player);

    let sourceCaptures = 0;
    const capture = vi.fn<CaptionBridge["capture"]>(async (request) => {
      if (request.target === "translated") return translated;
      sourceCaptures += 1;
      return sourceCaptures === 1 ? source : revisedSource;
    });
    const overlay = { close: vi.fn(), show: vi.fn() };
    const controller = new YouTubeCaptionController({
      bridge: { capture, destroy: vi.fn() },
      document,
      getVideoId: () => "video-1",
      isWatchPage: () => true,
      mode: "english",
      overlay,
      waitForTranslatedRetry: async () => undefined,
    });
    controller.start();
    await settle();
    const surface = player.querySelector("[data-huayi-store-youtube-subtitles]");
    const controlHost = player.querySelector("[data-huayi-store-youtube-control-host]");
    const closeCount = overlay.close.mock.calls.length;

    nativeCaption.textContent = "The inquiry was still in its early phase.";
    await settle();

    expect(player.querySelector("[data-huayi-store-youtube-subtitles]")).toBe(surface);
    expect(player.querySelector("[data-huayi-store-youtube-control-host]")).toBe(controlHost);
    expect(player.querySelector("[data-huayi-store-youtube-english]")?.textContent).toBe(
      "The inquiry was still in its early phase.",
    );
    expect(player.hasAttribute("data-huayi-store-youtube-active")).toBe(true);
    expect(overlay.close).toHaveBeenCalledTimes(closeCount);
    expect(capture.mock.calls.map(([request]) => request.target)).toEqual([
      "source",
      "translated",
      "source",
      "translated",
    ]);
    controller.stop();
  });

  it("does not bootstrap from a non-English bridge source", async () => {
    const player = document.createElement("div");
    player.className = "html5-video-player";
    const video = document.createElement("video");
    Object.defineProperty(video, "duration", { configurable: true, get: () => 120 });
    const nativeCaption = document.createElement("span");
    nativeCaption.className = "ytp-caption-segment";
    nativeCaption.textContent = "The investigation was";
    const cc = document.createElement("button");
    cc.className = "ytp-subtitles-button";
    cc.setAttribute("aria-pressed", "true");
    player.append(video, nativeCaption, cc);
    document.body.append(player);
    const capture = vi.fn<CaptionBridge["capture"]>(async () => ({
      ...source,
      track: { languageCode: "de" },
    }));
    const controller = new YouTubeCaptionController({
      bridge: { capture, destroy: vi.fn() },
      document,
      getVideoId: () => "video-1",
      isWatchPage: () => true,
      mode: "english",
      overlay: { close: vi.fn(), show: vi.fn() },
    });

    controller.start();
    await settle();
    player.classList.add("unrelated-player-state");
    await settle();

    expect(player.hasAttribute("data-huayi-store-youtube-active")).toBe(false);
    expect(player.querySelector("[data-huayi-store-youtube-subtitles]")).toBeNull();
    expect(capture).toHaveBeenCalledOnce();
    controller.stop();
  });

  it("revalidates one mismatching visible cue at most once", async () => {
    const stillDifferent: CapturedCaptionTrack = {
      cues: [{ endMs: 4_000, startMs: 0, text: "The authoritative source remains different." }],
      track: { kind: "asr", languageCode: "en" },
    };
    const player = document.createElement("div");
    player.className = "html5-video-player";
    const video = document.createElement("video");
    Object.defineProperties(video, {
      currentTime: { configurable: true, get: () => 1 },
      duration: { configurable: true, get: () => 120 },
    });
    const nativeCaption = document.createElement("span");
    nativeCaption.className = "ytp-caption-segment";
    nativeCaption.textContent = "The investigation was";
    const cc = document.createElement("button");
    cc.className = "ytp-subtitles-button";
    cc.setAttribute("aria-pressed", "true");
    const controls = document.createElement("div");
    controls.className = "ytp-chrome-controls ytp-right-controls";
    controls.append(cc);
    player.append(video, nativeCaption, controls);
    document.body.append(player);

    let sourceCaptures = 0;
    const neverSettles = new Promise<CapturedCaptionTrack | null>(() => undefined);
    const capture = vi.fn<CaptionBridge["capture"]>(async (request) => {
      if (request.target === "translated") return translated;
      sourceCaptures += 1;
      if (sourceCaptures === 1) return source;
      if (sourceCaptures === 2) return stillDifferent;
      return neverSettles;
    });
    const overlay = { close: vi.fn(), show: vi.fn() };
    const controller = new YouTubeCaptionController({
      bridge: { capture, destroy: vi.fn() },
      document,
      getVideoId: () => "video-1",
      isWatchPage: () => true,
      mode: "english",
      overlay,
      waitForTranslatedRetry: async () => undefined,
    });

    controller.start();
    try {
      await settle();
      const surface = player.querySelector("[data-huayi-store-youtube-subtitles]");
      const closeCount = overlay.close.mock.calls.length;

      nativeCaption.textContent = "interim words rendered by YouTube";
      await settle();
      player.classList.add("unrelated-state-one");
      player.classList.add("unrelated-state-two");
      await settle();

      expect(sourceCaptures).toBe(2);
      expect(capture.mock.calls.map(([request]) => request.target)).toEqual([
        "source",
        "translated",
        "source",
        "translated",
      ]);
      expect(player.querySelector("[data-huayi-store-youtube-subtitles]")).toBe(surface);
      expect(overlay.close).toHaveBeenCalledTimes(closeCount);
    } finally {
      controller.stop();
    }
  });
});
