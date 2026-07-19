import { afterEach, describe, expect, it, vi } from "vitest";

import type { AnalysisResult } from "@huayi/protocol";

import type { ContentCommand } from "../shared/extension-messages.js";
import {
  initializeContentScript,
  type ContentRuntime,
  type ContentScriptInstance,
} from "./content-script.js";

class FakeRuntime implements ContentRuntime {
  readonly sent: ContentCommand[] = [];
  private readonly listeners = new Set<(message: unknown) => void>();

  readonly onMessage = {
    addListener: (listener: (message: unknown) => void) => this.listeners.add(listener),
    removeListener: (listener: (message: unknown) => void) => this.listeners.delete(listener),
  };

  sendMessage(message: ContentCommand): undefined {
    this.sent.push(message);
    return undefined;
  }
}

let instance: ContentScriptInstance | null = null;

afterEach(() => {
  instance?.destroy();
  instance = null;
  document.body.textContent = "";
  vi.restoreAllMocks();
});

describe("YouTube content script integration", () => {
  it("routes a frozen caption selection through the existing analysis lane", () => {
    const runtime = new FakeRuntime();
    const player = document.createElement("div");
    player.className = "html5-video-player";
    const video = document.createElement("video");
    let paused = false;
    Object.defineProperty(video, "paused", {
      configurable: true,
      get: () => paused,
    });
    Object.defineProperty(video, "duration", {
      configurable: true,
      get: () => 120,
    });
    Object.defineProperty(video, "pause", {
      configurable: true,
      value: vi.fn(() => {
        paused = true;
      }),
    });
    Object.defineProperty(video, "play", {
      configurable: true,
      value: vi.fn(() => {
        paused = false;
        return Promise.resolve();
      }),
    });
    const caption = document.createElement("span");
    caption.className = "ytp-caption-segment";
    caption.textContent = "The investigation was still in its early stages.";
    const captionRect = {
      bottom: 620,
      height: 30,
      left: 160,
      right: 660,
      top: 590,
      width: 500,
      x: 160,
      y: 590,
      toJSON: () => ({}),
    };
    Object.defineProperty(caption, "getBoundingClientRect", {
      configurable: true,
      value: () => captionRect,
    });
    Object.defineProperty(caption, "getClientRects", {
      configurable: true,
      value: () => [captionRect],
    });
    const controls = document.createElement("div");
    controls.className = "ytp-right-controls";
    const subtitles = document.createElement("button");
    subtitles.className = "ytp-subtitles-button";
    controls.append(subtitles);
    player.append(video, caption, controls);
    document.body.append(player);

    let nextId = 0;
    instance = initializeContentScript({
      createRequestId: () => `youtube-${(nextId += 1)}`,
      document,
      isYouTubeWatchPage: () => true,
      runtime,
    });

    player
      .querySelector<HTMLElement>("[data-huayi-youtube-control-host]")
      ?.shadowRoot?.querySelector<HTMLButtonElement>("button")
      ?.click();
    expect(runtime.sent).toEqual([{ type: "WARMUP_HOST" }]);

    const picker = player.querySelector<HTMLElement>("[data-huayi-youtube-picker-host]");
    const word = [
      ...(picker?.shadowRoot?.querySelectorAll<HTMLElement>("[data-caption-word]") ?? []),
    ].find((candidate) => candidate.textContent === "investigation");
    const wordRect = {
      ...captionRect,
      bottom: 580,
      left: 220,
      right: 320,
      top: 550,
      width: 100,
    };
    Object.defineProperty(word, "getBoundingClientRect", {
      configurable: true,
      value: () => wordRect,
    });
    word?.click();
    instance.controller.shadowRoot
      .querySelector<HTMLButtonElement>("[data-action='translate']")
      ?.click();

    expect(runtime.sent[1]).toMatchObject({
      request: {
        context: "The investigation was still in its early stages.",
        requestId: "youtube-1",
        selection: "investigation",
        sentenceContext: "The investigation was still in its early stages.",
      },
      type: "ANALYZE_SELECTION",
    });
    expect(
      Number.parseFloat(
        instance.controller.shadowRoot.querySelector<HTMLElement>(".huayi-root")?.style.top ?? "",
      ),
    ).toBeLessThan(wordRect.top);
  });

  it("keeps the Eudic action for an ordinary word selected in the video title", () => {
    const runtime = new FakeRuntime();
    const heading = document.createElement("h1");
    const formattedTitle = document.createElement("yt-formatted-string");
    formattedTitle.textContent = "Why American Houses Are So Flimsy";
    heading.append(formattedTitle);
    document.body.append(heading);
    const text = formattedTitle.firstChild;
    if (!(text instanceof Text)) {
      throw new Error("Expected YouTube title text fixture.");
    }
    const range = document.createRange();
    const start = text.data.indexOf("Flimsy");
    range.setStart(text, start);
    range.setEnd(text, start + "Flimsy".length);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    instance = initializeContentScript({
      createRequestId: () => "youtube-title-1",
      document,
      getAnchorRect: () => ({
        bottom: 190,
        height: 20,
        left: 300,
        right: 340,
        top: 170,
        width: 40,
      }),
      isYouTubeWatchPage: () => true,
      runtime,
    });
    document.dispatchEvent(new MouseEvent("mouseup", { clientX: 320, clientY: 180 }));

    expect(instance.controller.state).toMatchObject({
      selection: {
        context: "Why American Houses Are So Flimsy",
        sentenceContext: "Why American Houses Are So Flimsy",
        wordbookContext: "Why American Houses Are So Flimsy",
      },
      status: "actions",
    });

    instance.controller.shadowRoot
      .querySelector<HTMLButtonElement>("[data-action='translate']")
      ?.click();
    const result = {
      commonMeanings: [{ meaningsZh: ["不牢固的"], partOfSpeech: "adjective" }],
      commonPhrases: [],
      confusableWords: [],
      contextualSense: { meaningZh: "结构单薄的", partOfSpeech: "adjective" },
      dictionaryForm: "flimsy",
      selectionKind: "word",
      sourceText: "Flimsy",
      type: "translate-word",
    } as const satisfies AnalysisResult;
    instance.controller.resolve(result);

    const addButton = instance.controller.shadowRoot.querySelector<HTMLButtonElement>(
      "[data-action='add-word']",
    );
    expect(addButton).not.toBeNull();
    addButton?.click();
    expect(runtime.sent.at(-1)).toMatchObject({
      request: {
        context: "Why American Houses Are So Flimsy",
        word: "Flimsy",
      },
      type: "ADD_WORD_TO_EUDIC",
    });
  });
});
