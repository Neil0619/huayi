import { afterEach, describe, expect, it, vi } from "vitest";

import type { SelectionRequestInput } from "../selection/read-selection.js";
import type { FrameScheduler } from "../overlay/frame-scheduler.js";
import {
  YouTubeCaptionController,
  type YouTubeCaptionSelectionEvent,
} from "./youtube-caption-controller.js";
import type { YouTubeCaptionContext } from "./youtube-caption-context-source.js";

interface Fixture {
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

const immediateFrameScheduler: FrameScheduler = {
  cancel: vi.fn(),
  request: (callback) => {
    callback();
    return 1;
  },
};

function createFixture(
  initiallyPaused = false,
  frameScheduler = immediateFrameScheduler,
  captionContextSource?: YouTubeCaptionContext,
): Fixture {
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
  caption.textContent = "The investigation was still in its early stages.";
  setRect(caption);

  player.append(video, caption, controls);
  document.body.append(player);

  const onSelection = vi.fn<(event: YouTubeCaptionSelectionEvent) => void>();
  const onWarmup = vi.fn<() => void>();
  const controller = new YouTubeCaptionController({
    ...(captionContextSource === undefined ? {} : { captionContextSource }),
    document,
    frameScheduler,
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

function controlButton(player: Element): HTMLButtonElement {
  const host = player.querySelector<HTMLElement>("[data-huayi-youtube-control-host]");
  const button = host?.shadowRoot?.querySelector<HTMLButtonElement>("button");
  if (button === null || button === undefined) {
    throw new Error("Expected a Huayi YouTube control.");
  }
  return button;
}

function pickerHost(player: Element): HTMLElement {
  const host = player.querySelector<HTMLElement>("[data-huayi-youtube-picker-host]");
  if (host === null) {
    throw new Error("Expected a Huayi caption picker.");
  }
  return host;
}

afterEach(() => {
  for (const controller of controllers.splice(0)) {
    controller.destroy();
  }
  document.body.textContent = "";
});

describe("YouTubeCaptionController", () => {
  it("pauses synchronously and waits no more than one animation frame before freezing", () => {
    const callbacks: (() => void)[] = [];
    const frameScheduler: FrameScheduler = {
      cancel: vi.fn(),
      request: vi.fn((next) => {
        callbacks.push(next);
        return 7;
      }),
    };
    const fixture = createFixture(false, frameScheduler);

    controlButton(fixture.player).click();

    expect(fixture.video.pause).toHaveBeenCalledOnce();
    expect(fixture.play).not.toHaveBeenCalled();
    expect(fixture.player.querySelector("[data-huayi-youtube-picker-host]")).toBeNull();
    expect(frameScheduler.request).toHaveBeenCalledOnce();

    callbacks[0]?.();

    expect(pickerHost(fixture.player)).toBeTruthy();
    expect(fixture.onWarmup).toHaveBeenCalledOnce();
    expect(fixture.play).not.toHaveBeenCalled();
  });

  it("pauses before scanning the caption to freeze", () => {
    const order: string[] = [];
    const callbacks: (() => void)[] = [];
    const captionContextSource: YouTubeCaptionContext = {
      attach: vi.fn(),
      clear: vi.fn(),
      freeze: vi.fn(() => {
        order.push("freeze");
        return { text: "The investigation was still in its early stages." };
      }),
    };
    const frameScheduler: FrameScheduler = {
      cancel: vi.fn(),
      request: vi.fn((callback) => {
        callbacks.push(callback);
        return 1;
      }),
    };
    const fixture = createFixture(false, frameScheduler, captionContextSource);
    vi.mocked(captionContextSource.freeze).mockClear();
    order.length = 0;
    vi.mocked(fixture.video.pause).mockImplementation(() => {
      fixture.setPaused(true);
      order.push("pause");
    });

    controlButton(fixture.player).click();
    expect(order).toEqual(["pause"]);
    callbacks[0]?.();

    expect(order).toEqual(["pause", "freeze"]);
  });

  it("pauses, freezes the current caption, and emits an exact word selection", () => {
    const fixture = createFixture();
    const button = controlButton(fixture.player);

    expect(button.disabled).toBe(false);
    button.click();

    expect(fixture.video.pause).toHaveBeenCalledOnce();
    expect(fixture.onWarmup).toHaveBeenCalledOnce();
    const picker = pickerHost(fixture.player);
    const word = [
      ...(picker.shadowRoot?.querySelectorAll<HTMLElement>("[data-caption-word]") ?? []),
    ].find((candidate) => candidate.textContent === "investigation");
    word?.click();

    expect(fixture.onSelection).toHaveBeenCalledOnce();
    const event = fixture.onSelection.mock.calls[0]?.[0];
    expect(event?.input).toEqual<SelectionRequestInput>({
      context: "The investigation was still in its early stages.",
      selection: "investigation",
      selectionKind: "word",
      sentenceContext: "The investigation was still in its early stages.",
      wordbookContext: "The investigation was still in its early stages.",
    });
    expect(event?.presentation.preferredSide).toBe("above");
  });

  it("selects the entire visible caption and keeps originally paused video paused", () => {
    const fixture = createFixture(true);
    controlButton(fixture.player).click();
    const picker = pickerHost(fixture.player);

    picker.shadowRoot?.querySelector<HTMLButtonElement>("[data-action='select-caption']")?.click();
    expect(fixture.onSelection.mock.calls[0]?.[0].input.selection).toBe(
      "The investigation was still in its early stages.",
    );

    picker.shadowRoot?.querySelector<HTMLButtonElement>("[data-action='continue']")?.click();
    expect(fixture.play).not.toHaveBeenCalled();
  });

  it("anchors word and whole-caption actions at the pointer position", () => {
    const fixture = createFixture();
    controlButton(fixture.player).click();
    const picker = pickerHost(fixture.player);
    const investigation = [
      ...(picker.shadowRoot?.querySelectorAll<HTMLButtonElement>("[data-caption-word]") ?? []),
    ].find((word) => word.textContent === "investigation");

    investigation?.dispatchEvent(
      new MouseEvent("click", {
        bubbles: true,
        clientX: 412,
        clientY: 566,
        detail: 1,
      }),
    );
    expect(fixture.onSelection.mock.calls[0]?.[0].presentation.resolveAnchorRect?.()).toEqual({
      bottom: 566,
      height: 0,
      left: 412,
      right: 412,
      top: 566,
      width: 0,
    });

    picker.shadowRoot
      ?.querySelector<HTMLButtonElement>("[data-action='select-caption']")
      ?.dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          clientX: 704,
          clientY: 622,
          detail: 1,
        }),
      );
    expect(fixture.onSelection.mock.calls[1]?.[0].presentation.resolveAnchorRect?.()).toEqual({
      bottom: 622,
      height: 0,
      left: 704,
      right: 704,
      top: 622,
      width: 0,
    });
  });

  it("turns a pointer drag across word tokens into one exact phrase", async () => {
    const fixture = createFixture();
    controlButton(fixture.player).click();
    const words = [
      ...(pickerHost(fixture.player).shadowRoot?.querySelectorAll<HTMLButtonElement>(
        "[data-caption-word]",
      ) ?? []),
    ];
    const early = words.find((word) => word.textContent === "early");
    const stages = words.find((word) => word.textContent === "stages");

    early?.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }));
    stages?.dispatchEvent(new MouseEvent("pointerenter", { button: 0 }));
    document.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, button: 0 }));

    expect(fixture.onSelection).toHaveBeenCalledOnce();
    expect(fixture.onSelection.mock.calls[0]?.[0].input).toMatchObject({
      context: "The investigation was still in its early stages.",
      selection: "early stages",
      selectionKind: "phrase",
      sentenceContext: "The investigation was still in its early stages.",
      wordbookContext: null,
    });

    const investigation = words.find((word) => word.textContent === "investigation");
    await Promise.resolve();
    investigation?.click();
    expect(fixture.onSelection).toHaveBeenCalledTimes(2);
    expect(fixture.onSelection.mock.calls[1]?.[0].input.selection).toBe("investigation");
  });

  it("resumes only a video that Huayi paused", () => {
    const fixture = createFixture();
    controlButton(fixture.player).click();

    pickerHost(fixture.player)
      .shadowRoot?.querySelector<HTMLButtonElement>("[data-action='continue']")
      ?.click();

    expect(fixture.play).toHaveBeenCalledOnce();
    expect(fixture.player.querySelector("[data-huayi-youtube-picker-host]")).toBeNull();
  });

  it("uses a second control click to close the picker and resume Huayi-paused playback", () => {
    const fixture = createFixture();
    const button = controlButton(fixture.player);
    button.click();

    button.click();

    expect(fixture.play).toHaveBeenCalledOnce();
    expect(fixture.player.querySelector("[data-huayi-youtube-picker-host]")).toBeNull();
  });

  it("closes a stale picker when the viewer resumes playback", () => {
    const fixture = createFixture();
    controlButton(fixture.player).click();

    fixture.setPaused(false);
    fixture.video.dispatchEvent(new Event("play"));

    expect(fixture.player.querySelector("[data-huayi-youtube-picker-host]")).toBeNull();
    expect(fixture.play).not.toHaveBeenCalled();
  });

  it("updates the control when YouTube changes only the caption text node", async () => {
    const fixture = createFixture();
    const captionText = fixture.player.querySelector(".ytp-caption-segment")?.firstChild;
    if (!(captionText instanceof Text)) {
      throw new Error("Expected a caption text node.");
    }

    captionText.data = "这是中文字幕";
    await Promise.resolve();
    await Promise.resolve();

    expect(controlButton(fixture.player).disabled).toBe(true);
  });

  it("clears caption memory on YouTube SPA navigation", async () => {
    const captionContextSource: YouTubeCaptionContext = {
      attach: vi.fn(),
      clear: vi.fn(),
      freeze: vi.fn(() => ({ text: "The investigation was still in its early stages." })),
    };
    createFixture(false, immediateFrameScheduler, captionContextSource);

    document.dispatchEvent(new Event("yt-navigate-finish"));
    await Promise.resolve();

    expect(captionContextSource.clear).toHaveBeenCalledOnce();
  });

  it("clears caption memory when the controller is destroyed", () => {
    const captionContextSource: YouTubeCaptionContext = {
      attach: vi.fn(),
      clear: vi.fn(),
      freeze: vi.fn(() => ({ text: "The investigation was still in its early stages." })),
    };
    const fixture = createFixture(false, immediateFrameScheduler, captionContextSource);
    vi.mocked(captionContextSource.clear).mockClear();

    fixture.controller.destroy();

    expect(captionContextSource.clear).toHaveBeenCalledOnce();
    expect(fixture.player.querySelector("[data-huayi-youtube-control-host]")).toBeNull();
  });

  it.each(["ad-showing", "ytp-live"])(
    "clears caption memory when the player enters %s state",
    async (playerClass) => {
      const captionContextSource: YouTubeCaptionContext = {
        attach: vi.fn(),
        clear: vi.fn(),
        freeze: vi.fn(() => ({ text: "The investigation was still in its early stages." })),
      };
      const fixture = createFixture(false, immediateFrameScheduler, captionContextSource);

      fixture.player.classList.add(playerClass);
      await Promise.resolve();
      await Promise.resolve();

      expect(captionContextSource.clear).toHaveBeenCalled();
      expect(controlButton(fixture.player).disabled).toBe(true);
    },
  );
});
