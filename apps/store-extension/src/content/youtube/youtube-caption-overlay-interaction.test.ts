import { afterEach, describe, expect, it, vi } from "vitest";

import { STORE_MESSAGE_VERSION } from "@huayi/store-domain";

import {
  StoreOverlayController,
  type StoreOverlayRuntime,
} from "../overlay/store-overlay-controller.js";
import type { CaptionBridge, CapturedCaptionTrack } from "./youtube-bridge-client.js";
import { YouTubeCaptionController } from "./youtube-caption-controller.js";

const source: CapturedCaptionTrack = {
  cues: [{ endMs: 4_000, startMs: 0, text: "The investigation was still in progress." }],
  track: { kind: "asr", languageCode: "en" },
};
const activeControllers: YouTubeCaptionController[] = [];

function runtime(): StoreOverlayRuntime {
  return {
    connectAnalysis: () => {
      throw new Error("Analysis is outside this interaction test.");
    },
    openOptions: vi.fn(async () => undefined),
    openWebWorkspace: vi.fn(async () => undefined),
    overlayStylesheetUrl: () => "chrome-extension://test/overlay.css",
    queryWordPresence: vi.fn(async () => undefined),
    saveWord: vi.fn(async () => ({
      messageVersion: STORE_MESSAGE_VERSION,
      status: "saved",
      type: "store/lexicon-save-result",
    })),
    studyCapture: vi.fn(async () => ({
      messageVersion: STORE_MESSAGE_VERSION,
      outcome: "skipped",
      type: "store/study-capture-result",
    })),
  };
}

function fixture(
  initiallyPaused = false,
  sourceTrack: CapturedCaptionTrack = source,
  beforeController: (() => void) | undefined = undefined,
) {
  const player = document.createElement("div");
  player.className = "html5-video-player";
  const video = document.createElement("video");
  let currentTime = 1;
  let paused = initiallyPaused;
  const pause = vi.fn(() => {
    paused = true;
  });
  const play = vi.fn(async () => {
    paused = false;
  });
  Object.defineProperties(video, {
    currentTime: { configurable: true, get: () => currentTime },
    duration: { configurable: true, get: () => 120 },
    paused: { configurable: true, get: () => paused },
    pause: { configurable: true, value: pause },
    play: { configurable: true, value: play },
  });
  const nativeCaption = document.createElement("span");
  nativeCaption.className = "ytp-caption-segment";
  nativeCaption.textContent = sourceTrack.cues[0]?.text ?? "";
  const cc = document.createElement("button");
  cc.className = "ytp-subtitles-button";
  cc.setAttribute("aria-pressed", "true");
  const videoSurface = document.createElement("div");
  videoSurface.className = "html5-video-container";
  player.append(video, videoSurface, nativeCaption, cc);
  document.body.append(player);

  const bridge: CaptionBridge = {
    capture: vi.fn(async (request) => (request.target === "source" ? sourceTrack : null)),
    destroy: vi.fn(),
  };
  const overlay = new StoreOverlayController(document, runtime(), () => true);
  beforeController?.();
  const controller = new YouTubeCaptionController({
    acceptsUserGesture: () => true,
    bridge,
    document,
    getVideoId: () => "video-1",
    isWatchPage: () => true,
    mode: "english",
    overlay,
  });
  controller.start();
  activeControllers.push(controller);

  return {
    cc,
    controller,
    get paused() {
      return paused;
    },
    overlay,
    pause,
    play,
    player,
    setCurrentTime(value: number) {
      currentTime = value;
    },
    video,
    videoSurface,
  };
}

async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function selectCaption(harness: ReturnType<typeof fixture>): void {
  const english = harness.player.querySelector<HTMLElement>("[data-huayi-store-youtube-english]");
  const text = english?.firstChild;
  if (!(english instanceof HTMLElement) || !(text instanceof Text)) {
    throw new Error("Expected a selectable Store subtitle.");
  }
  const selectedText = "investigation";
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
}

function beginCaptionDrag(harness: ReturnType<typeof fixture>, pointerId = 7): HTMLElement {
  const english = harness.player.querySelector<HTMLElement>("[data-huayi-store-youtube-english]");
  const text = english?.firstChild;
  if (!(english instanceof HTMLElement) || !(text instanceof Text)) {
    throw new Error("Expected a selectable Store subtitle.");
  }
  const selectedText = "investigation";
  const start = text.data.indexOf(selectedText);
  const range = document.createRange();
  range.setStart(text, start);
  range.setEnd(text, start + selectedText.length);
  Object.defineProperty(range, "getBoundingClientRect", {
    value: () => ({ bottom: 40, left: 20, top: 20 }),
  });
  const pointerDown = new MouseEvent("pointerdown", { bubbles: true, composed: true });
  Object.defineProperty(pointerDown, "pointerId", { value: pointerId });
  english.dispatchEvent(pointerDown);
  window.getSelection()?.removeAllRanges();
  window.getSelection()?.addRange(range);
  document.dispatchEvent(new Event("selectionchange"));
  return english;
}

function escapeFromOverlay(): void {
  const host = document.querySelector<HTMLElement>("[data-huayi-store-overlay]");
  const target = host?.shadowRoot?.activeElement;
  if (!(target instanceof HTMLElement)) throw new Error("Expected a focused overlay action.");
  target.dispatchEvent(
    new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      composed: true,
      key: "Escape",
    }),
  );
}

afterEach(() => {
  for (const controller of activeControllers.splice(0)) controller.stop();
  document.body.textContent = "";
  window.getSelection()?.removeAllRanges();
  vi.restoreAllMocks();
});

describe("Store YouTube caption and overlay interaction", () => {
  it("commits an outside-release drag without taking pointer capture", async () => {
    const stopDocumentPointerUp = (event: Event) => event.stopImmediatePropagation();
    const harness = fixture(false, source, () => {
      document.addEventListener("pointerup", stopDocumentPointerUp, true);
    });
    await settle();
    const show = vi.spyOn(harness.overlay, "show");
    const english = harness.player.querySelector<HTMLElement>("[data-huayi-store-youtube-english]");
    const text = english?.firstChild;
    if (!(english instanceof HTMLElement) || !(text instanceof Text)) {
      throw new Error("Expected a selectable Store subtitle.");
    }
    const capture = vi.fn();
    Object.defineProperty(english, "setPointerCapture", { configurable: true, value: capture });
    const selectedText = "investigation";
    const start = text.data.indexOf(selectedText);
    const range = document.createRange();
    range.setStart(text, start);
    range.setEnd(text, start + selectedText.length);
    Object.defineProperty(range, "getBoundingClientRect", {
      value: () => ({ bottom: 40, left: 20, top: 20 }),
    });

    const pointerDown = new MouseEvent("pointerdown", { bubbles: true, composed: true });
    Object.defineProperty(pointerDown, "pointerId", { value: 7 });
    english.dispatchEvent(pointerDown);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));

    expect(document.querySelector("[data-huayi-store-overlay]")).toBeNull();
    expect(harness.pause).not.toHaveBeenCalled();

    const pointerUp = new MouseEvent("pointerup", { bubbles: true, composed: true });
    Object.defineProperty(pointerUp, "pointerId", { value: 7 });
    document.body.dispatchEvent(pointerUp);
    await Promise.resolve();

    expect(capture).not.toHaveBeenCalled();
    expect(document.querySelector("[data-huayi-store-overlay]")).not.toBeNull();
    expect(show).toHaveBeenCalledOnce();
    expect(harness.pause).toHaveBeenCalledOnce();

    english.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, composed: true }));
    document.removeEventListener("pointerup", stopDocumentPointerUp, true);

    expect(show).toHaveBeenCalledOnce();
    expect(harness.pause).toHaveBeenCalledOnce();
  });

  it("cancels a valid caption drag on pointercancel without opening or pausing", async () => {
    const harness = fixture();
    await settle();
    const english = beginCaptionDrag(harness);
    const cancel = new MouseEvent("pointercancel", { bubbles: true, composed: true });
    Object.defineProperty(cancel, "pointerId", { value: 7 });
    english.dispatchEvent(cancel);
    document.body.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, composed: true }));

    expect(document.querySelector("[data-huayi-store-overlay]")).toBeNull();
    expect(harness.pause).not.toHaveBeenCalled();
  });

  it("keeps the text-internal mouseup compatibility path for non-Pointer Events", async () => {
    const harness = fixture();
    await settle();

    selectCaption(harness);

    expect(document.querySelector("[data-huayi-store-overlay]")).not.toBeNull();
    expect(harness.pause).toHaveBeenCalledOnce();
  });

  it("keeps a real drag selection stable when the video advances before mouseup", async () => {
    const changingSource: CapturedCaptionTrack = {
      cues: [
        { endMs: 2_000, startMs: 0, text: "First subtitle sentence." },
        { endMs: 4_000, startMs: 2_000, text: "Second subtitle sentence." },
      ],
      track: { kind: "asr", languageCode: "en" },
    };
    const harness = fixture(false, changingSource);
    await settle();
    const english = harness.player.querySelector<HTMLElement>("[data-huayi-store-youtube-english]");
    const text = english?.firstChild;
    if (!(english instanceof HTMLElement) || !(text instanceof Text)) {
      throw new Error("Expected the first selectable subtitle sentence.");
    }
    const selectedText = "subtitle";
    const start = text.data.indexOf(selectedText);
    const range = document.createRange();
    range.setStart(text, start);
    range.setEnd(text, start + selectedText.length);
    Object.defineProperty(range, "getBoundingClientRect", {
      value: () => ({ bottom: 40, left: 20, top: 20 }),
    });
    english.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, composed: true }));
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));

    harness.setCurrentTime(3);
    harness.video.dispatchEvent(new Event("timeupdate"));
    harness.videoSurface.dispatchEvent(
      new MouseEvent("mouseup", { bubbles: true, composed: true }),
    );

    expect(document.querySelector("[data-huayi-store-overlay]")).not.toBeNull();
    expect(harness.pause).toHaveBeenCalledOnce();
    expect(harness.player.querySelector("[data-huayi-store-youtube-english]")?.textContent).toBe(
      "First subtitle sentence.",
    );

    escapeFromOverlay();
    harness.video.dispatchEvent(new Event("timeupdate"));

    expect(harness.player.querySelector("[data-huayi-store-youtube-english]")?.textContent).toBe(
      "Second subtitle sentence.",
    );
  });

  it("requests playback through the real Escape dismissal path", async () => {
    const harness = fixture();
    await settle();
    selectCaption(harness);
    expect(harness.paused).toBe(true);

    escapeFromOverlay();

    expect(document.querySelector("[data-huayi-store-overlay]")).toBeNull();
    expect(window.getSelection()?.rangeCount).toBe(0);
    expect(harness.play).toHaveBeenCalledOnce();
    expect(harness.paused).toBe(false);
  });

  it("omits the close button and requests playback after a trusted outside dismissal", async () => {
    const harness = fixture();
    await settle();
    selectCaption(harness);
    const overlay = document.querySelector<HTMLElement>("[data-huayi-store-overlay]");
    expect(overlay?.shadowRoot?.querySelector("[data-close]")).toBeNull();
    const outside = document.createElement("button");
    document.body.append(outside);

    outside.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, composed: true }));

    expect(document.querySelector("[data-huayi-store-overlay]")).toBeNull();
    expect(window.getSelection()?.rangeCount).toBe(0);
    expect(harness.play).toHaveBeenCalledOnce();
    expect(harness.paused).toBe(false);
  });

  it("consumes the complete blank-player activation that dismisses a caption overlay", async () => {
    const harness = fixture();
    await settle();
    selectCaption(harness);
    const nativePlayerClick = vi.fn(() => {
      if (harness.paused) void harness.video.play();
      else harness.video.pause();
    });
    harness.player.addEventListener("click", nativePlayerClick);

    const pointerdown = new MouseEvent("pointerdown", {
      bubbles: true,
      cancelable: true,
      composed: true,
    });
    const click = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      composed: true,
    });
    harness.videoSurface.dispatchEvent(pointerdown);
    harness.videoSurface.dispatchEvent(click);

    expect(pointerdown.defaultPrevented).toBe(true);
    expect(click.defaultPrevented).toBe(true);
    expect(document.querySelector("[data-huayi-store-overlay]")).toBeNull();
    expect(window.getSelection()?.rangeCount).toBe(0);
    expect(harness.play).toHaveBeenCalledOnce();
    expect(nativePlayerClick).not.toHaveBeenCalled();
    expect(harness.paused).toBe(false);
  });

  it("does not play a video that was paused before caption selection", async () => {
    const harness = fixture(true);
    await settle();
    selectCaption(harness);

    escapeFromOverlay();

    expect(document.querySelector("[data-huayi-store-overlay]")).toBeNull();
    expect(harness.pause).not.toHaveBeenCalled();
    expect(harness.play).not.toHaveBeenCalled();
    expect(harness.paused).toBe(true);
  });

  it.each(["navigation", "CC close"])(
    "does not resume stale pause ownership after %s",
    async (cause) => {
      const harness = fixture();
      await settle();
      selectCaption(harness);

      if (cause === "navigation") {
        document.dispatchEvent(new Event("yt-navigate-start"));
      } else {
        harness.cc.setAttribute("aria-pressed", "false");
        await settle();
      }
      document.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          composed: true,
          key: "Escape",
        }),
      );

      expect(document.querySelector("[data-huayi-store-overlay]")).toBeNull();
      expect(harness.play).not.toHaveBeenCalled();
      expect(harness.paused).toBe(true);
    },
  );
});
