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

function fixture(
  mode: "bilingual" | "english" = "english",
  capture: CaptionBridge["capture"] = vi.fn(async (request) =>
    request.target === "source" ? source : translated,
  ),
  initiallyPaused = false,
  waitForTranslatedRetry: () => Promise<void> = async () => undefined,
) {
  const player = document.createElement("div");
  player.className = "html5-video-player";
  const video = document.createElement("video");
  let paused = initiallyPaused;
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
  const bridge: CaptionBridge = {
    capture,
    destroy: vi.fn(),
  };
  const overlay = { close: vi.fn(), show: vi.fn() };
  const controller = new YouTubeCaptionController({
    acceptsUserGesture: () => true,
    bridge,
    document,
    getVideoId: () => "video-1",
    isWatchPage: () => true,
    mode,
    overlay,
    waitForTranslatedRetry,
  });
  controller.start();
  return {
    bridge,
    controller,
    overlay,
    player,
    setPaused(value: boolean) {
      paused = value;
    },
    video,
  };
}

async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function selectCaption(
  harness: ReturnType<typeof fixture>,
  selectedText = "investigation",
): () => void {
  const english = harness.player.querySelector<HTMLElement>("[data-huayi-store-youtube-english]");
  const text = english?.firstChild;
  if (!(english instanceof HTMLElement) || !(text instanceof Text)) {
    throw new Error("Expected stable English subtitle text.");
  }
  const start = text.data.indexOf(selectedText);
  const range = document.createRange();
  range.setStart(text, start);
  range.setEnd(text, start + selectedText.length);
  Object.defineProperty(range, "getBoundingClientRect", {
    value: () => ({ bottom: 40, left: 20, top: 20 }),
  });
  window.getSelection()?.removeAllRanges();
  window.getSelection()?.addRange(range);
  english.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  const dismiss = harness.overlay.show.mock.lastCall?.[2];
  if (typeof dismiss !== "function") throw new Error("Missing overlay dismissal callback.");
  return dismiss;
}

afterEach(() => {
  document.body.textContent = "";
  window.getSelection()?.removeAllRanges();
  vi.restoreAllMocks();
});

describe("Store YouTube caption controller", () => {
  it("keeps one caption generation while source capture briefly removes the native cue", async () => {
    let resolveSource: (result: CapturedCaptionTrack | null) => void = () => undefined;
    const pendingSource = new Promise<CapturedCaptionTrack | null>((resolve) => {
      resolveSource = resolve;
    });
    const capture = vi.fn((request: Parameters<CaptionBridge["capture"]>[0]) =>
      request.target === "source" ? pendingSource : Promise.resolve(translated),
    );
    const harness = fixture("english", capture);
    await settle();
    const sourceRequest = capture.mock.calls[0]?.[0];
    const closeCount = harness.overlay.close.mock.calls.length;

    harness.player.querySelector(".ytp-caption-segment")?.remove();
    await settle();
    const restoredCaption = document.createElement("span");
    restoredCaption.className = "ytp-caption-segment";
    restoredCaption.textContent = "The investigation was";
    harness.player.append(restoredCaption);
    await settle();

    expect(capture).toHaveBeenCalledTimes(1);
    expect(harness.overlay.close).toHaveBeenCalledTimes(closeCount);

    resolveSource(source);
    await settle();

    expect(capture).toHaveBeenCalledTimes(2);
    expect(capture.mock.calls.map(([request]) => request.target)).toEqual(["source", "translated"]);
    expect(capture.mock.calls[1]?.[0].generation).toBe(sourceRequest?.generation);
    harness.controller.stop();
  });

  it("does not alternate back to native captions while captured track restoration is pending", async () => {
    let resolveTranslated: (result: CapturedCaptionTrack | null) => void = () => undefined;
    const pendingTranslated = new Promise<CapturedCaptionTrack | null>((resolve) => {
      resolveTranslated = resolve;
    });
    const capture = vi.fn((request: Parameters<CaptionBridge["capture"]>[0]) =>
      request.target === "source" ? Promise.resolve(source) : pendingTranslated,
    );
    const harness = fixture("english", capture);
    await settle();
    const surface = harness.player.querySelector("[data-huayi-store-youtube-subtitles]");
    expect(surface).not.toBeNull();

    harness.player.querySelector(".ytp-caption-segment")?.remove();
    await settle();
    expect(harness.player.querySelector("[data-huayi-store-youtube-subtitles]")).toBe(surface);

    resolveTranslated(translated);
    await settle();

    expect(harness.player.querySelector("[data-huayi-store-youtube-subtitles]")).toBe(surface);
    expect(capture.mock.calls.map(([request]) => request.target)).toEqual(["source", "translated"]);
    harness.controller.stop();
  });

  it("still clears a pending capture immediately when the user closes CC", async () => {
    let resolveSource: (result: CapturedCaptionTrack | null) => void = () => undefined;
    const capture = vi.fn(
      () =>
        new Promise<CapturedCaptionTrack | null>((resolve) => {
          resolveSource = resolve;
        }),
    );
    const harness = fixture("english", capture);
    await settle();
    const closeCount = harness.overlay.close.mock.calls.length;

    harness.player.querySelector(".ytp-subtitles-button")?.setAttribute("aria-pressed", "false");
    await settle();

    expect(harness.overlay.close.mock.calls.length).toBeGreaterThan(closeCount);
    resolveSource(source);
    await settle();
    expect(capture).toHaveBeenCalledTimes(1);
    harness.controller.stop();
  });

  it("clears an established Store subtitle session when the user closes CC", async () => {
    const harness = fixture();
    await settle();
    expect(harness.player.querySelector("[data-huayi-store-youtube-subtitles]")).not.toBeNull();

    harness.player.querySelector(".ytp-subtitles-button")?.setAttribute("aria-pressed", "false");
    await settle();

    expect(harness.player.querySelector("[data-huayi-store-youtube-subtitles]")).toBeNull();
    expect(harness.bridge.capture).toHaveBeenCalledTimes(2);
    harness.controller.stop();
  });

  it("fails closed when capture settles while the native cue remains absent", async () => {
    let resolveSource: (result: CapturedCaptionTrack | null) => void = () => undefined;
    const capture = vi.fn(
      () =>
        new Promise<CapturedCaptionTrack | null>((resolve) => {
          resolveSource = resolve;
        }),
    );
    const harness = fixture("english", capture);
    await settle();
    const closeCount = harness.overlay.close.mock.calls.length;

    harness.player.querySelector(".ytp-caption-segment")?.remove();
    await settle();
    expect(harness.overlay.close).toHaveBeenCalledTimes(closeCount);

    resolveSource(null);
    await settle();

    expect(harness.overlay.close).toHaveBeenCalledTimes(closeCount + 1);
    expect(capture).toHaveBeenCalledTimes(1);
    harness.controller.stop();
  });

  it("renders selectable bilingual subtitles with the configured default", async () => {
    const harness = fixture("bilingual");
    await settle();

    expect(harness.player.querySelector("[data-huayi-store-youtube-english]")?.textContent).toBe(
      "The investigation was still in its early stages.",
    );
    const chinese = harness.player.querySelector<HTMLElement>(
      "[data-huayi-store-youtube-translated]",
    );
    expect(chinese?.textContent).toBe("调查仍处于早期阶段。");
    expect(chinese?.hidden).toBe(false);
    expect(harness.bridge.capture).toHaveBeenCalledTimes(2);
    harness.controller.stop();
  });

  it("feeds an exact real-gesture caption selection into the normal Store overlay", async () => {
    const harness = fixture();
    await settle();
    selectCaption(harness);

    expect(harness.overlay.show).toHaveBeenCalledWith(
      expect.objectContaining({
        context: "The investigation was still in its early stages.",
        selection: "investigation",
        sentenceContext: "The investigation was still in its early stages.",
      }),
      expect.any(Object),
      expect.any(Function),
    );
    expect(harness.video.pause).toHaveBeenCalledOnce();
    harness.controller.stop();
  });

  it("resumes only the same active caption generation after the user dismisses its overlay", async () => {
    const harness = fixture();
    await settle();
    const dismiss = selectCaption(harness);

    dismiss();
    await settle();

    expect(harness.video.pause).toHaveBeenCalledOnce();
    expect(harness.video.play).toHaveBeenCalledOnce();
    harness.controller.stop();
  });

  it("never resumes a video that was already paused before caption selection", async () => {
    const harness = fixture("english", undefined, true);
    await settle();
    const dismiss = selectCaption(harness);

    dismiss();
    await settle();

    expect(harness.video.pause).not.toHaveBeenCalled();
    expect(harness.video.play).not.toHaveBeenCalled();
    harness.controller.stop();
  });

  it("does not resume from a stale dismissal after navigation clears the owner session", async () => {
    const harness = fixture();
    await settle();
    const dismiss = selectCaption(harness);

    document.dispatchEvent(new Event("yt-navigate-start"));
    dismiss();
    await settle();

    expect(harness.video.play).not.toHaveBeenCalled();
    harness.controller.stop();
  });

  it("does not resume from a stale dismissal after the user closes CC", async () => {
    const harness = fixture();
    await settle();
    const dismiss = selectCaption(harness);

    harness.player.querySelector(".ytp-subtitles-button")?.setAttribute("aria-pressed", "false");
    await settle();
    dismiss();
    await settle();

    expect(harness.video.play).not.toHaveBeenCalled();
    harness.controller.stop();
  });

  it("revokes pause ownership when the user resumes playback before dismissing", async () => {
    const harness = fixture();
    await settle();
    const dismiss = selectCaption(harness);
    harness.setPaused(false);
    harness.video.dispatchEvent(new Event("play"));
    harness.setPaused(true);

    dismiss();
    await settle();

    expect(harness.video.play).not.toHaveBeenCalled();
    harness.controller.stop();
  });

  it("preserves pause ownership when one caption overlay replaces another", async () => {
    const harness = fixture();
    await settle();
    selectCaption(harness);
    const dismissReplacement = selectCaption(harness, "early stages");

    expect(harness.video.pause).toHaveBeenCalledOnce();
    dismissReplacement();
    await settle();

    expect(harness.video.play).toHaveBeenCalledOnce();
    harness.controller.stop();
  });

  it("transfers a temporary hold pause to caption selection without an early resume", async () => {
    const harness = fixture();
    await settle();
    const temporary = harness.player.querySelector<HTMLButtonElement>(
      "[data-huayi-store-youtube-temporary-translation]",
    );
    temporary?.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true }));
    const dismiss = selectCaption(harness);

    expect(harness.video.pause).toHaveBeenCalledOnce();
    expect(harness.video.play).not.toHaveBeenCalled();
    temporary?.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, cancelable: true }));
    expect(harness.video.play).not.toHaveBeenCalled();

    dismiss();
    await settle();

    expect(harness.video.play).toHaveBeenCalledOnce();
    harness.controller.stop();
  });
});
