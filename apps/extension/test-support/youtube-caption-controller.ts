import { vi } from "vitest";

import {
  YouTubeCaptionController,
  type YouTubeCaptionSelectionEvent,
} from "../src/content/youtube/youtube-caption-controller.js";

export interface YouTubeCaptionControllerFixture {
  controller: YouTubeCaptionController;
  onSelection: ReturnType<typeof vi.fn<(event: YouTubeCaptionSelectionEvent) => void>>;
  onWarmup: ReturnType<typeof vi.fn<() => void>>;
  player: HTMLElement;
  play: ReturnType<typeof vi.fn<() => Promise<void>>>;
  setPaused(value: boolean): void;
  video: HTMLVideoElement;
}

const controllers: YouTubeCaptionController[] = [];

function setRect(element: Element, rect: Partial<DOMRect> = {}): void {
  const value = {
    bottom: 640,
    height: 32,
    left: 180,
    right: 620,
    top: 608,
    width: 440,
    x: 180,
    y: 608,
    toJSON: () => ({}),
    ...rect,
  };
  Object.defineProperty(element, "getBoundingClientRect", {
    configurable: true,
    value: () => value,
  });
  Object.defineProperty(element, "getClientRects", {
    configurable: true,
    value: () => [value],
  });
}

export function createControllerFixture(
  initiallyPaused = false,
  captionText = "The investigation was still in its early stages.",
): YouTubeCaptionControllerFixture {
  document.body.textContent = "";
  const player = document.createElement("div");
  player.className = "html5-video-player";
  setRect(player, { bottom: 720, height: 640, left: 80, right: 880, top: 80, width: 800 });

  const controls = document.createElement("div");
  controls.className = "ytp-right-controls";
  const captionsButton = document.createElement("button");
  captionsButton.className = "ytp-subtitles-button";
  controls.append(captionsButton);

  const video = document.createElement("video");
  let paused = initiallyPaused;
  Object.defineProperty(video, "paused", {
    configurable: true,
    get: () => paused,
  });
  Object.defineProperty(video, "duration", {
    configurable: true,
    get: () => 120,
  });
  const pause = vi.fn(() => {
    paused = true;
  });
  const play = vi.fn(() => {
    paused = false;
    return Promise.resolve();
  });
  Object.defineProperty(video, "pause", { configurable: true, value: pause });
  Object.defineProperty(video, "play", { configurable: true, value: play });

  const caption = document.createElement("span");
  caption.className = "ytp-caption-segment";
  caption.textContent = captionText;
  setRect(caption);

  player.append(video, caption, controls);
  document.body.append(player);

  const onSelection = vi.fn<(event: YouTubeCaptionSelectionEvent) => void>();
  const onWarmup = vi.fn<() => void>();
  const controller = new YouTubeCaptionController({
    document,
    isWatchPage: () => true,
    onPresentationChange: vi.fn(),
    onSelection,
    onSessionClose: vi.fn(),
    onWarmup,
  });
  controllers.push(controller);

  return {
    controller,
    onSelection,
    onWarmup,
    player,
    play,
    setPaused: (value) => {
      paused = value;
    },
    video,
  };
}

export function controlButton(player: Element): HTMLButtonElement {
  const host = player.querySelector<HTMLElement>("[data-huayi-youtube-control-host]");
  const button = host?.shadowRoot?.querySelector<HTMLButtonElement>("button");
  if (button === null || button === undefined) {
    throw new Error("Expected a Huayi YouTube control.");
  }
  return button;
}

export function pickerHost(player: Element): HTMLElement {
  const host = player.querySelector<HTMLElement>("[data-huayi-youtube-picker-host]");
  if (host === null) {
    throw new Error("Expected a Huayi caption picker.");
  }
  return host;
}

export function destroyControllerFixtures(): void {
  for (const controller of controllers.splice(0)) {
    controller.destroy();
  }
}
