import { afterEach, describe, expect, it, vi } from "vitest";

import type { CaptionBridge, CapturedCaptionTrack } from "./youtube-bridge-client.js";
import { YouTubeCaptionController } from "./youtube-caption-controller.js";

const source: CapturedCaptionTrack = {
  cues: [{ endMs: 4_000, startMs: 0, text: "The investigation continues." }],
  track: { kind: "asr", languageCode: "en" },
};
const translated: CapturedCaptionTrack = {
  cues: [{ endMs: 4_000, startMs: 0, text: "调查仍在继续。" }],
  track: { kind: "asr", languageCode: "en" },
};
let controller: YouTubeCaptionController | null = null;

function fixture(initiallyPaused = false) {
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
  nativeCaption.textContent = source.cues[0]?.text ?? "";
  const controls = document.createElement("div");
  controls.className = "ytp-chrome-controls ytp-right-controls";
  const cc = document.createElement("button");
  cc.className = "ytp-subtitles-button";
  cc.setAttribute("aria-pressed", "true");
  controls.append(cc);
  player.append(video, nativeCaption, controls);
  document.body.append(player);
  let capturedSource = source;
  let videoId = "video-1";
  const bridge: CaptionBridge = {
    capture: vi.fn(async (request) => (request.target === "source" ? capturedSource : translated)),
    destroy: vi.fn(),
  };
  controller = new YouTubeCaptionController({
    acceptsUserGesture: () => true,
    bridge,
    document,
    getVideoId: () => videoId,
    isWatchPage: () => true,
    mode: "english",
    overlay: { close: vi.fn(), show: vi.fn() },
    shortcut: { alt: false, code: "KeyZ", ctrl: false, meta: false, shift: true },
  });
  controller.start();
  return {
    pause,
    play,
    player,
    setCapturedSource(value: CapturedCaptionTrack) {
      capturedSource = value;
    },
    setPaused(value: boolean) {
      paused = value;
    },
    setVideoId(value: string) {
      videoId = value;
    },
    nativeCaption,
    video,
  };
}

async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function pointer(button: HTMLButtonElement | null, type: string): void {
  button?.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, composed: true }));
}

afterEach(() => {
  controller?.stop();
  controller = null;
  document.body.textContent = "";
  vi.restoreAllMocks();
});

describe("Store YouTube caption controls", () => {
  it("mounts one fixed bilingual control beside CC and remounts it after controls rebuild", async () => {
    const { player } = fixture();
    await settle();
    const firstHost = player.querySelector<HTMLElement>("[data-huayi-store-youtube-control-host]");
    const firstCc = player.querySelector<HTMLElement>(".ytp-subtitles-button");

    expect(firstHost?.nextElementSibling).toBe(firstCc);
    firstCc?.parentElement?.remove();
    await settle();
    expect(firstHost?.isConnected).toBe(false);
    const replacementControls = document.createElement("div");
    replacementControls.className = "ytp-chrome-controls ytp-right-controls";
    const replacementCc = document.createElement("button");
    replacementCc.className = "ytp-subtitles-button";
    replacementCc.setAttribute("aria-pressed", "true");
    replacementControls.append(replacementCc);
    player.append(replacementControls);
    await settle();

    const hosts = player.querySelectorAll("[data-huayi-store-youtube-control-host]");
    expect(hosts).toHaveLength(1);
    expect(hosts[0]).toBe(firstHost);
    expect(firstHost?.nextElementSibling).toBe(replacementCc);
    expect(player.querySelector("[data-huayi-store-youtube-subtitles]")).not.toBeNull();
  });

  it("keeps temporary pointer and keyboard holds independent", async () => {
    const { pause, play, player } = fixture();
    await settle();
    const translatedLine = player.querySelector<HTMLElement>(
      "[data-huayi-store-youtube-translated]",
    );
    const temporary = player.querySelector<HTMLButtonElement>(
      "[data-huayi-store-youtube-temporary-translation]",
    );
    pointer(temporary, "pointerdown");
    document.dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        code: "KeyZ",
        key: "Z",
        shiftKey: true,
      }),
    );
    pointer(temporary, "pointerup");

    expect(translatedLine?.hidden).toBe(false);
    expect(pause).toHaveBeenCalledOnce();
    expect(play).not.toHaveBeenCalled();
    document.dispatchEvent(
      new KeyboardEvent("keyup", {
        bubbles: true,
        cancelable: true,
        code: "KeyZ",
        key: "Z",
        shiftKey: true,
      }),
    );
    expect(translatedLine?.hidden).toBe(true);
    expect(play).toHaveBeenCalledOnce();
  });

  it("pauses only for the top temporary 中 and resumes its own pause on release", async () => {
    const { pause, play, player } = fixture();
    await settle();
    const temporary = player.querySelector<HTMLButtonElement>(
      "[data-huayi-store-youtube-temporary-translation]",
    );
    const fixed = player.querySelector<HTMLButtonElement>("[data-huayi-store-youtube-bilingual]");

    fixed?.click();
    fixed?.click();
    expect(pause).not.toHaveBeenCalled();
    expect(play).not.toHaveBeenCalled();

    pointer(temporary, "pointerdown");
    expect(pause).toHaveBeenCalledOnce();
    expect(play).not.toHaveBeenCalled();

    pointer(temporary, "pointerup");
    expect(play).toHaveBeenCalledOnce();
  });

  it("never plays a video that was already paused before a temporary hold", async () => {
    const { pause, play, player } = fixture(true);
    await settle();
    const temporary = player.querySelector<HTMLButtonElement>(
      "[data-huayi-store-youtube-temporary-translation]",
    );

    pointer(temporary, "pointerdown");
    pointer(temporary, "pointerup");

    expect(pause).not.toHaveBeenCalled();
    expect(play).not.toHaveBeenCalled();
  });

  it("revokes temporary pause ownership when media plays during the hold", async () => {
    const { pause, play, player, setPaused, video } = fixture();
    await settle();
    const temporary = player.querySelector<HTMLButtonElement>(
      "[data-huayi-store-youtube-temporary-translation]",
    );

    pointer(temporary, "pointerdown");
    setPaused(false);
    video.dispatchEvent(new Event("play"));
    setPaused(true);
    pointer(temporary, "pointerup");

    expect(pause).toHaveBeenCalledOnce();
    expect(play).not.toHaveBeenCalled();
  });

  it.each(["pointercancel", "lostpointercapture", "window blur", "document hidden"])(
    "resumes its temporary pause on %s",
    async (cause) => {
      const { pause, play, player } = fixture();
      await settle();
      const temporary = player.querySelector<HTMLButtonElement>(
        "[data-huayi-store-youtube-temporary-translation]",
      );
      pointer(temporary, "pointerdown");

      if (cause === "window blur") window.dispatchEvent(new Event("blur"));
      else if (cause === "document hidden") {
        const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
        document.dispatchEvent(new Event("visibilitychange"));
        visibility.mockRestore();
      } else pointer(temporary, cause);

      expect(pause).toHaveBeenCalledOnce();
      expect(play).toHaveBeenCalledOnce();
    },
  );

  it.each(["navigation", "CC off", "stop", "video replacement", "video ID change", "track switch"])(
    "does not resume a stale temporary pause after %s clears the session",
    async (cause) => {
      const harness = fixture();
      const { pause, play, player } = harness;
      await settle();
      const temporary = player.querySelector<HTMLButtonElement>(
        "[data-huayi-store-youtube-temporary-translation]",
      );
      pointer(temporary, "pointerdown");

      if (cause === "navigation") document.dispatchEvent(new Event("yt-navigate-start"));
      else if (cause === "CC off") {
        player.querySelector(".ytp-subtitles-button")?.setAttribute("aria-pressed", "false");
        await settle();
      } else if (cause === "stop") controller?.stop();
      else if (cause === "video replacement") {
        const replacement = document.createElement("video");
        Object.defineProperties(replacement, {
          currentTime: { configurable: true, get: () => 1 },
          duration: { configurable: true, get: () => 120 },
          paused: { configurable: true, get: () => false },
        });
        harness.video.replaceWith(replacement);
        await settle();
      } else if (cause === "video ID change") {
        harness.setVideoId("video-2");
        player.classList.add("video-id-changed");
        await settle();
      } else {
        harness.setCapturedSource({
          cues: [{ endMs: 4_000, startMs: 0, text: "Die Untersuchung geht weiter." }],
          track: { kind: "asr", languageCode: "de" },
        });
        harness.nativeCaption.textContent = "Die Untersuchung geht weiter.";
        await settle();
      }
      pointer(temporary, "pointerup");

      expect(pause).toHaveBeenCalledOnce();
      expect(play).not.toHaveBeenCalled();
    },
  );

  it("uses the subtitle-corner 中 only as a temporary translation hold", async () => {
    const { player } = fixture();
    await settle();
    const translatedLine = player.querySelector<HTMLElement>(
      "[data-huayi-store-youtube-translated]",
    );
    const temporary = player.querySelector<HTMLButtonElement>(
      "[data-huayi-store-youtube-temporary-translation]",
    );
    const fixed = player.querySelector<HTMLButtonElement>("[data-huayi-store-youtube-bilingual]");

    expect(temporary).not.toBe(fixed);
    pointer(temporary, "pointerdown");
    expect(translatedLine?.hidden).toBe(false);
    pointer(temporary, "pointerup");
    expect(translatedLine?.hidden).toBe(true);
    pointer(temporary, "pointerdown");
    pointer(temporary, "pointercancel");
    expect(translatedLine?.hidden).toBe(true);
    pointer(temporary, "pointerdown");
    pointer(temporary, "lostpointercapture");
    expect(translatedLine?.hidden).toBe(true);
    pointer(temporary, "pointerdown");
    window.dispatchEvent(new Event("blur"));
    expect(translatedLine?.hidden).toBe(true);
    pointer(temporary, "pointerdown");
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    expect(translatedLine?.hidden).toBe(true);
    visibility.mockRestore();

    fixed?.click();
    expect(fixed?.getAttribute("aria-pressed")).toBe("true");
    expect(translatedLine?.hidden).toBe(false);
    fixed?.click();
    expect(translatedLine?.hidden).toBe(true);
  });
});
