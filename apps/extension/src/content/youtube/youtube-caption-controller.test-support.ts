import { vi } from "vitest";

import type { OverlayState } from "../overlay/overlay-state.js";
import type {
  CapturedCaptionTrack,
  YouTubeCaptionBridge,
} from "./youtube-caption-bridge-client.js";
import type { YouTubeSourceStatus } from "./youtube-bridge-contract.js";
import type { YouTubeCaptionSelectionEvent } from "./youtube-caption-controller-contract.js";
import { YouTubeCaptionController } from "./youtube-caption-controller.js";
import type { KeyboardShortcut } from "../../settings/settings-domain.js";

const SOURCE: CapturedCaptionTrack = {
  cues: [
    { endMs: 4_000, startMs: 0, text: "The investigation was" },
    { endMs: 8_000, startMs: 4_000, text: "still in its early stages." },
  ],
  track: { languageCode: "en", kind: "asr" },
};

const TRANSLATED: CapturedCaptionTrack = {
  cues: [{ endMs: 8_000, startMs: 0, text: "调查仍处于早期阶段。" }],
  track: { languageCode: "en", kind: "asr" },
};

interface Fixture {
  bridge: YouTubeCaptionBridge;
  onSelection: ReturnType<typeof vi.fn<(event: YouTubeCaptionSelectionEvent) => void>>;
  onSessionClose: ReturnType<typeof vi.fn<() => void>>;
  player: HTMLElement;
  setSourceStatus(status: YouTubeSourceStatus): void;
  setOverlayState(state: OverlayState): void;
  setPaused(paused: boolean): void;
  video: HTMLVideoElement;
}

const controllers: YouTubeCaptionController[] = [];

function setRect(element: Element): void {
  const rect = {
    bottom: 620,
    height: 32,
    left: 180,
    right: 620,
    top: 588,
    width: 440,
    x: 180,
    y: 588,
    toJSON: () => ({}),
  };
  Object.defineProperty(element, "getBoundingClientRect", { value: () => rect });
  Object.defineProperty(element, "getClientRects", { value: () => [rect] });
}

export function createCaptionControllerFixture(
  options: {
    canDismissSelection?: () => boolean;
    defaultBilingual?: boolean;
    initiallyPaused?: boolean;
    source?: CapturedCaptionTrack | null;
    getSource?: () => CapturedCaptionTrack | null;
    sourceStatus?: YouTubeSourceStatus;
    shortcut?: KeyboardShortcut | null;
    translated?: CapturedCaptionTrack | null;
  } = {},
): Fixture {
  document.body.textContent = "";
  const player = document.createElement("div");
  player.className = "html5-video-player";
  const video = document.createElement("video");
  let paused = options.initiallyPaused ?? false;
  let currentTime = 1;
  Object.defineProperties(video, {
    currentTime: {
      configurable: true,
      get: () => currentTime,
      set: (value: number) => {
        currentTime = value;
      },
    },
    duration: { configurable: true, get: () => 120 },
    paused: { configurable: true, get: () => paused },
    pause: {
      configurable: true,
      value: vi.fn(() => {
        paused = true;
      }),
    },
    play: {
      configurable: true,
      value: vi.fn(() => {
        paused = false;
        return Promise.resolve();
      }),
    },
  });
  const nativeCaption = document.createElement("span");
  nativeCaption.className = "ytp-caption-segment";
  nativeCaption.textContent = "The investigation was";
  setRect(nativeCaption);
  const videoSurface = document.createElement("div");
  videoSurface.className = "html5-video-container";
  const controls = document.createElement("div");
  controls.className = "ytp-chrome-controls ytp-right-controls";
  const cc = document.createElement("button");
  cc.className = "ytp-subtitles-button";
  cc.setAttribute("aria-pressed", "true");
  controls.append(cc);
  player.append(video, videoSurface, nativeCaption, controls);
  document.body.append(player);

  const capture = vi.fn(async ({ target }: { target: "source" | "translated" }) => {
    if (target === "translated") {
      return options.translated === undefined ? TRANSLATED : options.translated;
    }
    if (options.getSource !== undefined) return options.getSource();
    return options.source === undefined ? SOURCE : options.source;
  });
  let sourceStatus = options.sourceStatus ?? "same-source";
  const bridge: YouTubeCaptionBridge = {
    capture,
    destroy: vi.fn(),
    probeSource: vi.fn(async () => sourceStatus),
  };
  const onSelection = vi.fn<(event: YouTubeCaptionSelectionEvent) => void>();
  const onSessionClose = vi.fn<() => void>();
  let overlayState: OverlayState = { status: "closed" };
  const controller = new YouTubeCaptionController({
    bridge,
    ...(options.canDismissSelection === undefined
      ? {}
      : { canDismissSelection: options.canDismissSelection }),
    document,
    ...(options.defaultBilingual === undefined
      ? {}
      : { defaultBilingual: options.defaultBilingual }),
    getVideoId: () => "video-1",
    isOverlayVisible: () => overlayState.status !== "closed" && overlayState.status !== "idle",
    isWatchPage: () => true,
    onPresentationChange: vi.fn(),
    onSelection,
    onSessionClose,
    onWarmup: vi.fn(),
    ...(options.shortcut === undefined ? {} : { shortcut: options.shortcut }),
  });
  controllers.push(controller);
  return {
    bridge,
    onSelection,
    onSessionClose,
    player,
    setSourceStatus: (status) => {
      sourceStatus = status;
    },
    setOverlayState: (state) => {
      overlayState = state;
    },
    setPaused: (value) => {
      paused = value;
    },
    video,
  };
}

export async function settleCaptionController(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

export function captionEnglishNode(player: Element): HTMLElement {
  const node = player.querySelector<HTMLElement>("[data-huayi-youtube-english]");
  if (node === null) throw new Error("Expected selectable English subtitles.");
  return node;
}

export function selectCaptionText(
  node: HTMLElement,
  start: number,
  end: number,
  releaseTarget: HTMLElement = node,
): void {
  const text = node.firstChild;
  if (!(text instanceof Text)) throw new Error("Expected one stable subtitle text node.");
  const range = document.createRange();
  range.setStart(text, start);
  range.setEnd(text, end);
  Object.defineProperty(range, "getBoundingClientRect", {
    value: () => ({ bottom: 600, height: 20, left: 260, right: 340, top: 580, width: 80 }),
  });
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  document.dispatchEvent(new Event("selectionchange"));
  releaseTarget.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
}

export function cleanupCaptionControllers(): void {
  vi.useRealTimers();
  for (const controller of controllers.splice(0)) controller.destroy();
  window.getSelection()?.removeAllRanges();
  document.body.textContent = "";
  vi.restoreAllMocks();
}
