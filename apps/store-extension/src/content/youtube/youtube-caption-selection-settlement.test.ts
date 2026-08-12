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
    overlayStylesheetUrl: () => "chrome-extension://test/overlay.css",
    queryWordPresence: vi.fn(async () => undefined),
    saveWord: vi.fn(async () => ({
      messageVersion: STORE_MESSAGE_VERSION,
      status: "saved",
      type: "store/lexicon-save-result",
    })),
  };
}

function fixture() {
  const player = document.createElement("div");
  player.className = "html5-video-player";
  const video = document.createElement("video");
  let paused = false;
  const pause = vi.fn(() => {
    paused = true;
  });
  Object.defineProperties(video, {
    currentTime: { configurable: true, get: () => 1 },
    duration: { configurable: true, get: () => 120 },
    paused: { configurable: true, get: () => paused },
    pause: { configurable: true, value: pause },
    play: {
      configurable: true,
      value: vi.fn(async () => {
        paused = false;
      }),
    },
  });
  const videoSurface = document.createElement("div");
  videoSurface.className = "html5-video-container";
  const nativeCaption = document.createElement("span");
  nativeCaption.className = "ytp-caption-segment";
  nativeCaption.textContent = source.cues[0]?.text ?? "";
  const cc = document.createElement("button");
  cc.className = "ytp-subtitles-button";
  cc.setAttribute("aria-pressed", "true");
  player.append(video, videoSurface, nativeCaption, cc);
  document.body.append(player);

  const bridge: CaptionBridge = {
    capture: vi.fn(async (request) => (request.target === "source" ? source : null)),
    destroy: vi.fn(),
  };
  const overlay = new StoreOverlayController(document, runtime(), () => true);
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
  return { controller, overlay, pause, player, videoSurface };
}

async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function captionParts(harness: ReturnType<typeof fixture>): {
  english: HTMLElement;
  start: number;
  text: Text;
} {
  const english = harness.player.querySelector<HTMLElement>("[data-huayi-store-youtube-english]");
  const text = english?.firstChild;
  if (!(english instanceof HTMLElement) || !(text instanceof Text)) {
    throw new Error("Expected a selectable Store subtitle.");
  }
  return { english, start: text.data.indexOf("investigation"), text };
}

function pointer(type: "pointercancel" | "pointerdown" | "pointerup", pointerId = 7): MouseEvent {
  const event = new MouseEvent(type, { bubbles: true, composed: true });
  Object.defineProperty(event, "pointerId", { value: pointerId });
  return event;
}

function select(text: Text, start: number, dispatchChange = true): void {
  const range = document.createRange();
  range.setStart(text, start);
  range.setEnd(text, start + "investigation".length);
  Object.defineProperty(range, "getBoundingClientRect", {
    value: () => ({ bottom: 40, left: 20, top: 20 }),
  });
  window.getSelection()?.removeAllRanges();
  window.getSelection()?.addRange(range);
  if (dispatchChange) document.dispatchEvent(new Event("selectionchange"));
}

function beginValidDrag(harness: ReturnType<typeof fixture>): HTMLElement {
  const { english, start, text } = captionParts(harness);
  english.dispatchEvent(pointer("pointerdown"));
  select(text, start);
  return english;
}

afterEach(() => {
  for (const controller of activeControllers.splice(0)) controller.stop();
  document.body.textContent = "";
  window.getSelection()?.removeAllRanges();
  vi.restoreAllMocks();
});

describe("Store YouTube caption selection settlement", () => {
  it("settles an outside-release selection after the pointerup default action", async () => {
    const harness = fixture();
    await settle();
    const show = vi.spyOn(harness.overlay, "show");
    const { english, start, text } = captionParts(harness);
    english.dispatchEvent(pointer("pointerdown"));
    harness.videoSurface.addEventListener("pointerup", () => select(text, start, false), {
      once: true,
    });

    harness.videoSurface.dispatchEvent(pointer("pointerup"));

    expect(document.querySelector("[data-huayi-store-overlay]")).toBeNull();
    expect(harness.pause).not.toHaveBeenCalled();
    await Promise.resolve();

    expect(document.querySelector("[data-huayi-store-overlay]")).not.toBeNull();
    expect(show).toHaveBeenCalledOnce();
    expect(harness.pause).toHaveBeenCalledOnce();
  });

  it("lets a compatible mouseup settle once before the deferred pointerup finish", async () => {
    const harness = fixture();
    await settle();
    const show = vi.spyOn(harness.overlay, "show");
    const english = beginValidDrag(harness);
    document.body.dispatchEvent(pointer("pointerup"));
    english.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, composed: true }));

    expect(show).toHaveBeenCalledOnce();
    expect(harness.pause).toHaveBeenCalledOnce();
    await Promise.resolve();

    expect(show).toHaveBeenCalledOnce();
    expect(harness.pause).toHaveBeenCalledOnce();
  });

  it.each(["pointercancel", "window blur", "session clear"])(
    "invalidates a pending pointerup finish on %s",
    async (cause) => {
      const harness = fixture();
      await settle();
      const english = beginValidDrag(harness);
      document.body.dispatchEvent(pointer("pointerup"));

      if (cause === "pointercancel") english.dispatchEvent(pointer("pointercancel"));
      else if (cause === "window blur") window.dispatchEvent(new Event("blur"));
      else harness.controller.stop();
      await Promise.resolve();

      expect(document.querySelector("[data-huayi-store-overlay]")).toBeNull();
      expect(harness.pause).not.toHaveBeenCalled();
    },
  );
});
