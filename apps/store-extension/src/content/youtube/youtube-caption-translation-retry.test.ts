import { afterEach, describe, expect, it, vi } from "vitest";

import type { CaptionBridge, CapturedCaptionTrack } from "./youtube-bridge-client.js";
import { YouTubeCaptionController } from "./youtube-caption-controller.js";

const source: CapturedCaptionTrack = {
  cues: [{ endMs: 4_000, startMs: 0, text: "The investigation was still in progress." }],
  track: { kind: "asr", languageCode: "en" },
};
const translated: CapturedCaptionTrack = {
  cues: [{ endMs: 4_000, startMs: 0, text: "调查仍在进行中。" }],
  track: { kind: "asr", languageCode: "en" },
};
const activeControllers: YouTubeCaptionController[] = [];

function fixture(
  capture: CaptionBridge["capture"],
  waitForTranslatedRetry: () => Promise<void> = async () => undefined,
) {
  const player = document.createElement("div");
  player.className = "html5-video-player";
  const video = document.createElement("video");
  Object.defineProperties(video, {
    currentTime: { configurable: true, get: () => 1 },
    duration: { configurable: true, get: () => 120 },
    paused: { configurable: true, get: () => false },
  });
  const nativeCaption = document.createElement("span");
  nativeCaption.className = "ytp-caption-segment";
  nativeCaption.textContent = source.cues[0]?.text ?? "";
  const cc = document.createElement("button");
  cc.className = "ytp-subtitles-button";
  cc.setAttribute("aria-pressed", "true");
  player.append(video, nativeCaption, cc);
  document.body.append(player);

  const bridge: CaptionBridge = { capture, destroy: vi.fn() };
  const controller = new YouTubeCaptionController({
    bridge,
    document,
    getVideoId: () => "video-1",
    isWatchPage: () => true,
    mode: "bilingual",
    overlay: { close: vi.fn(), show: vi.fn() },
    waitForTranslatedRetry,
  });
  activeControllers.push(controller);
  controller.start();
  return { controller, player };
}

afterEach(() => {
  for (const controller of activeControllers.splice(0)) controller.stop();
  document.body.textContent = "";
  vi.restoreAllMocks();
});

describe("Store YouTube translated-track recovery", () => {
  it("recovers when the first translated-track capture is transiently unavailable", async () => {
    const capture = vi
      .fn<CaptionBridge["capture"]>()
      .mockResolvedValueOnce(source)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(translated);
    const harness = fixture(capture);
    await vi.waitFor(() => expect(capture).toHaveBeenCalledTimes(3));

    expect(capture.mock.calls.map(([request]) => request.target)).toEqual([
      "source",
      "translated",
      "translated",
    ]);
    expect(
      harness.player.querySelector<HTMLElement>("[data-huayi-store-youtube-translated]")
        ?.textContent,
    ).toBe("调查仍在进行中。");
    expect(
      harness.player.querySelector<HTMLButtonElement>("[data-huayi-store-youtube-bilingual]")
        ?.disabled,
    ).toBe(false);
  });

  it("fails closed after exactly two unavailable translated-track captures", async () => {
    const capture = vi
      .fn<CaptionBridge["capture"]>()
      .mockResolvedValueOnce(source)
      .mockResolvedValue(null);
    const harness = fixture(capture);
    await vi.waitFor(() => expect(capture).toHaveBeenCalledTimes(3));

    expect(capture.mock.calls.map(([request]) => request.target)).toEqual([
      "source",
      "translated",
      "translated",
    ]);
    expect(
      harness.player.querySelector<HTMLButtonElement>("[data-huayi-store-youtube-bilingual]")
        ?.disabled,
    ).toBe(true);
  });

  it("does not retry an invalidated generation after navigation", async () => {
    let releaseRetry: () => void = () => undefined;
    const waitForTranslatedRetry = () =>
      new Promise<void>((resolve) => {
        releaseRetry = resolve;
      });
    let translatedAttempts = 0;
    const capture = vi.fn<CaptionBridge["capture"]>(async (request) => {
      if (request.target === "source") return source;
      translatedAttempts += 1;
      return translatedAttempts === 1 ? null : translated;
    });
    fixture(capture, waitForTranslatedRetry);
    await vi.waitFor(() => expect(capture).toHaveBeenCalledTimes(2));
    const invalidatedGeneration = capture.mock.calls[0]?.[0].generation;

    document.dispatchEvent(new Event("yt-navigate-start"));
    releaseRetry();
    await vi.waitFor(() => expect(capture).toHaveBeenCalledTimes(4));

    expect(
      capture.mock.calls.filter(
        ([request]) =>
          request.generation === invalidatedGeneration && request.target === "translated",
      ),
    ).toHaveLength(1);
    expect(capture.mock.calls.map(([request]) => request.target)).toEqual([
      "source",
      "translated",
      "source",
      "translated",
    ]);
  });
});
