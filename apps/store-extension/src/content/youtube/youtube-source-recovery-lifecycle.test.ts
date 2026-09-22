import { afterEach, describe, expect, it, vi } from "vitest";

import type { CaptionBridge, CapturedCaptionTrack } from "./youtube-bridge-client.js";
import { YouTubeCaptionController } from "./youtube-caption-controller.js";

const source: CapturedCaptionTrack = {
  cues: [{ endMs: 4_000, startMs: 0, text: "Hello." }],
  track: { languageCode: "en" },
};
const controllers: YouTubeCaptionController[] = [];

function fixture(capture: CaptionBridge["capture"]) {
  document.body.innerHTML = `<div class="html5-video-player"><video></video>
    <span class="ytp-caption-segment">Hello.</span>
    <button class="ytp-subtitles-button" aria-pressed="true"></button></div>`;
  const player = document.querySelector<HTMLElement>(".html5-video-player");
  const cc = document.querySelector<HTMLElement>(".ytp-subtitles-button");
  const cue = document.querySelector<HTMLElement>(".ytp-caption-segment");
  if (player === null || cc === null || cue === null) throw new Error("Missing test player.");
  const controller = new YouTubeCaptionController({
    bridge: { capture, destroy: vi.fn() },
    document,
    getVideoId: () => "video-1",
    isWatchPage: () => true,
    mode: "english",
    overlay: { close: vi.fn(), show: vi.fn() },
  });
  controllers.push(controller);
  controller.start();
  return { cc, controller, cue, player };
}

afterEach(() => {
  for (const controller of controllers.splice(0)) controller.stop();
  document.body.textContent = "";
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("Store initial source recovery lifetime", () => {
  it("makes exactly three attempts and remains closed for the same cue after exhaustion", async () => {
    vi.useFakeTimers();
    const capture = vi.fn<CaptionBridge["capture"]>().mockResolvedValue(null);
    const { player } = fixture(capture);
    await vi.advanceTimersByTimeAsync(199);
    expect(capture).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(capture).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(200);
    expect(capture).toHaveBeenCalledTimes(3);
    player.classList.add("unrelated-state");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(capture).toHaveBeenCalledTimes(3);
    expect(document.querySelector("[data-huayi-store-youtube-subtitles]")).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("accepts readiness on the last bounded attempt", async () => {
    vi.useFakeTimers();
    const capture = vi
      .fn<CaptionBridge["capture"]>()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValue(source);
    fixture(capture);
    await vi.advanceTimersByTimeAsync(400);
    expect(document.querySelector("[data-huayi-store-youtube-english]")?.textContent).toBe(
      "Hello.",
    );
    expect(capture.mock.calls.map(([request]) => request.target)).toEqual([
      "source",
      "source",
      "source",
      "translated",
    ]);
  });

  it("bounds capture-driven removal and restoration of the same native cue", async () => {
    vi.useFakeTimers();
    const capture = vi.fn<CaptionBridge["capture"]>(async () => {
      const cue = document.querySelector(".ytp-caption-segment");
      const player = cue?.parentElement;
      cue?.remove();
      setTimeout(() => {
        if (cue && player) player.append(cue);
      }, 50);
      return null;
    });
    fixture(capture);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(capture).toHaveBeenCalledTimes(3);
    expect(new Set(capture.mock.calls.map(([request]) => request.generation)).size).toBe(1);
    expect(document.querySelector(".ytp-caption-segment")?.textContent).toBe("Hello.");
    expect(document.querySelector("[data-huayi-store-youtube-subtitles]")).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cannot replenish an exhausted initial capture budget by changing native cues", async () => {
    vi.useFakeTimers();
    const capture = vi.fn<CaptionBridge["capture"]>().mockResolvedValue(null);
    const { cue } = fixture(capture);
    await vi.advanceTimersByTimeAsync(1_000);
    for (let index = 0; index < 10; index += 1) {
      cue.textContent = `Synthetic cue ${index}.`;
      await vi.advanceTimersByTimeAsync(1_000);
    }
    expect(capture).toHaveBeenCalledTimes(3);
    expect(document.querySelector("[data-huayi-store-youtube-subtitles]")).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["CC off", "navigation", "player replacement", "video replacement", "stop"])(
    "allows a new bounded initial capture budget after %s",
    async (reason) => {
      vi.useFakeTimers();
      const capture = vi.fn<CaptionBridge["capture"]>().mockResolvedValue(null);
      const { cc, controller, player } = fixture(capture);
      await vi.advanceTimersByTimeAsync(1_000);
      expect(capture).toHaveBeenCalledTimes(3);
      const generation = capture.mock.calls[0]?.[0].generation;
      if (reason === "CC off") {
        cc.setAttribute("aria-pressed", "false");
        await vi.advanceTimersByTimeAsync(0);
        cc.setAttribute("aria-pressed", "true");
      }
      if (reason === "navigation") {
        document.dispatchEvent(new Event("yt-navigate-start"));
        document.dispatchEvent(new Event("yt-navigate-finish"));
      }
      if (reason === "player replacement") player.replaceWith(player.cloneNode(true));
      if (reason === "video replacement")
        player.querySelector("video")?.replaceWith(document.createElement("video"));
      if (reason === "stop") {
        controller.stop();
        controller.start();
      }
      await vi.advanceTimersByTimeAsync(1_000);
      expect(capture).toHaveBeenCalledTimes(6);
      expect(capture.mock.calls[3]?.[0].generation).not.toBe(generation);
      expect(document.querySelector("[data-huayi-store-youtube-subtitles]")).toBeNull();
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it("never retries a returned non-English source", async () => {
    vi.useFakeTimers();
    const capture = vi.fn<CaptionBridge["capture"]>().mockResolvedValue({
      ...source,
      track: { languageCode: "de" },
    });
    fixture(capture);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(capture).toHaveBeenCalledTimes(1);
    expect(document.querySelector("[data-huayi-store-youtube-subtitles]")).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["CC off", "navigation", "player replacement", "video replacement", "stop"])(
    "cancels the pending initial source retry on %s",
    async (reason) => {
      vi.useFakeTimers();
      const capture = vi.fn<CaptionBridge["capture"]>().mockResolvedValue(null);
      const { cc, controller, player } = fixture(capture);
      await vi.advanceTimersByTimeAsync(0);
      expect(vi.getTimerCount()).toBe(1);
      const generation = capture.mock.calls[0]?.[0].generation;
      if (reason === "CC off") cc.setAttribute("aria-pressed", "false");
      if (reason === "navigation") document.dispatchEvent(new Event("yt-navigate-start"));
      if (reason === "player replacement") player.replaceWith(player.cloneNode(true));
      if (reason === "video replacement")
        player.querySelector("video")?.replaceWith(document.createElement("video"));
      if (reason === "stop") controller.stop();
      await vi.advanceTimersByTimeAsync(0);
      if (reason === "CC off" || reason === "navigation" || reason === "stop") {
        expect(vi.getTimerCount()).toBe(0);
      }
      await vi.advanceTimersByTimeAsync(1_000);
      expect(
        capture.mock.calls.filter(([request]) => request.generation === generation),
      ).toHaveLength(1);
      expect(document.querySelector("[data-huayi-store-youtube-subtitles]")).toBeNull();
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it("requires a visible candidate cue again before retrying", async () => {
    vi.useFakeTimers();
    const capture = vi.fn<CaptionBridge["capture"]>().mockResolvedValue(null);
    const { cue } = fixture(capture);
    await vi.advanceTimersByTimeAsync(0);
    cue.textContent = "";
    await vi.advanceTimersByTimeAsync(1_000);
    expect(capture).toHaveBeenCalledTimes(1);
    expect(document.querySelector("[data-huayi-store-youtube-subtitles]")).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not retry an established session's unavailable mismatching cue", async () => {
    vi.useFakeTimers();
    const capture = vi
      .fn<CaptionBridge["capture"]>()
      .mockResolvedValueOnce(source)
      .mockResolvedValueOnce(source)
      .mockResolvedValue(null);
    const { cue, player } = fixture(capture);
    await vi.advanceTimersByTimeAsync(0);
    expect(document.querySelector("[data-huayi-store-youtube-subtitles]")).not.toBeNull();
    cue.textContent = "A different caption.";
    await vi.advanceTimersByTimeAsync(1_000);
    player.classList.add("unrelated-state");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(capture.mock.calls.map(([request]) => request.target)).toEqual([
      "source",
      "translated",
      "source",
    ]);
    expect(document.querySelector("[data-huayi-store-youtube-subtitles]")).toBeNull();
  });

  it("does not replenish the initial budget after rejecting an established source check", async () => {
    vi.useFakeTimers();
    const capture = vi
      .fn<CaptionBridge["capture"]>()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(source)
      .mockResolvedValueOnce(source)
      .mockResolvedValue(null);
    const { cue } = fixture(capture);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(document.querySelector("[data-huayi-store-youtube-subtitles]")).not.toBeNull();
    cue.textContent = "A different caption.";
    await vi.advanceTimersByTimeAsync(1_000);
    expect(document.querySelector("[data-huayi-store-youtube-subtitles]")).toBeNull();
    cue.textContent = "Another caption.";
    await vi.advanceTimersByTimeAsync(1_000);
    expect(capture.mock.calls.map(([request]) => request.target)).toEqual([
      "source",
      "source",
      "source",
      "translated",
      "source",
    ]);
    expect(vi.getTimerCount()).toBe(0);
  });
});
