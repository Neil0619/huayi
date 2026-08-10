import { afterEach, describe, expect, it, vi } from "vitest";

import {
  captionEnglishNode as englishNode,
  cleanupCaptionControllers,
  createCaptionControllerFixture as createFixture,
  selectCaptionText as selectText,
  settleCaptionController as settle,
} from "./youtube-caption-controller.test-support.js";

afterEach(() => {
  cleanupCaptionControllers();
});

describe("YouTubeCaptionController", () => {
  it("pins translated subtitles when configured to start bilingual", async () => {
    const fixture = createFixture({ defaultBilingual: true });
    await settle();
    const translated = fixture.player.querySelector<HTMLElement>("[data-huayi-youtube-translated]");
    const button = fixture.player.querySelector<HTMLElement>("[data-huayi-youtube-bilingual]");
    expect(translated?.hidden).toBe(false);
    expect(button?.getAttribute("aria-pressed")).toBe("true");
  });
  it("replaces native captions with a complete selectable English sentence and no legacy picker", async () => {
    const fixture = createFixture();
    await settle();

    expect(englishNode(fixture.player).textContent).toBe(
      "The investigation was still in its early stages.",
    );
    expect(fixture.player.dataset.huayiYoutubeSubtitlesActive).toBe("");
    expect(fixture.player.querySelector("[data-huayi-youtube-picker-host]")).toBeNull();
    expect(fixture.player.textContent).not.toContain("整条字幕");
    const stableTextNode = englishNode(fixture.player).firstChild;
    fixture.video.dispatchEvent(new Event("timeupdate"));
    expect(englishNode(fixture.player).firstChild).toBe(stableTextNode);
  });

  it("defaults to English, pins Chinese with 中, and supports non-sticky Shift+Z", async () => {
    const fixture = createFixture();
    await settle();
    const translated = fixture.player.querySelector<HTMLElement>("[data-huayi-youtube-translated]");
    const button = fixture.player.querySelector<HTMLButtonElement>(
      "[data-huayi-youtube-bilingual]",
    );

    expect(translated?.hidden).toBe(true);
    expect(button?.title).toContain("按住 Shift+Z");
    button?.click();
    expect(translated?.hidden).toBe(false);
    expect(translated?.textContent).toBe("调查仍处于早期阶段。");
    button?.click();
    const shortcutKeydown = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      code: "KeyZ",
      key: "Z",
      shiftKey: true,
    });
    document.dispatchEvent(shortcutKeydown);
    expect(translated?.hidden).toBe(false);
    expect(shortcutKeydown.defaultPrevented).toBe(true);
    window.dispatchEvent(new Event("blur"));
    expect(translated?.hidden).toBe(true);

    document.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyZ", key: "z", bubbles: true }));
    document.dispatchEvent(new KeyboardEvent("keyup", { code: "KeyZ", key: "z", bubbles: true }));
    expect(translated?.hidden).toBe(true);
    const input = document.createElement("input");
    fixture.player.append(input);
    input.focus();
    const editableKeydown = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      code: "KeyZ",
      key: "Z",
      shiftKey: true,
    });
    document.dispatchEvent(editableKeydown);
    expect(translated?.hidden).toBe(true);
    expect(editableKeydown.defaultPrevented).toBe(false);
  });

  it("holds Chinese from the subtitle corner button and waits for both pointer and Shift+Z releases", async () => {
    const fixture = createFixture();
    await settle();
    const translated = fixture.player.querySelector<HTMLElement>("[data-huayi-youtube-translated]");
    const temporary = fixture.player.querySelector<HTMLButtonElement>(
      "[data-huayi-youtube-temporary-translation]",
    );
    expect(temporary?.title).toBe("按住显示中文（Shift+Z）");
    temporary?.dispatchEvent(new Event("pointerdown", { bubbles: true, cancelable: true }));
    expect(translated?.hidden).toBe(false);
    document.dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        code: "KeyZ",
        key: "Z",
        shiftKey: true,
      }),
    );
    temporary?.dispatchEvent(new Event("pointercancel", { bubbles: true }));
    expect(translated?.hidden).toBe(false);
    document.dispatchEvent(
      new KeyboardEvent("keyup", { bubbles: true, code: "KeyZ", key: "Z", shiftKey: true }),
    );
    expect(translated?.hidden).toBe(true);
    temporary?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
    expect(translated?.hidden).toBe(false);
    temporary?.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: "Enter" }));
    expect(translated?.hidden).toBe(true);
  });

  it("disables 中 when the translated track fails while retaining custom English", async () => {
    const fixture = createFixture({ translated: null });
    await settle();

    expect(englishNode(fixture.player).textContent).toContain("investigation");
    expect(
      fixture.player.querySelector<HTMLButtonElement>("[data-huayi-youtube-bilingual]")?.disabled,
    ).toBe(true);
  });

  it("keeps native English captions when the source track fails", async () => {
    const fixture = createFixture({ source: null });
    await settle();

    expect(fixture.player.dataset.huayiYoutubeSubtitlesActive).toBeUndefined();
    expect(fixture.player.querySelector("[data-huayi-youtube-subtitle-surface]")).toBeNull();
    expect(fixture.player.querySelector(".ytp-caption-segment")?.textContent).toContain(
      "investigation",
    );

    fixture.player.append(document.createElement("div"));
    await settle();
    expect(fixture.bridge.capture).toHaveBeenCalledOnce();
  });

  it("accepts an exact native word range, freezes its sentence, and pauses only playing video", async () => {
    const fixture = createFixture();
    await settle();
    const english = englishNode(fixture.player);
    const sentence = english.textContent ?? "";
    const start = sentence.indexOf("investigation");

    selectText(english, start, start + "investigation".length);

    expect(fixture.video.pause).toHaveBeenCalledOnce();
    expect(fixture.onSelection).toHaveBeenCalledOnce();
    expect(fixture.onSelection.mock.calls[0]?.[0].input).toMatchObject({
      context: sentence,
      selection: "investigation",
      sentenceContext: sentence,
      wordbookContext: sentence,
    });
    expect(fixture.onSelection.mock.calls[0]?.[0].presentation.dismissOnOutsidePointer).toBe(false);
  });

  it("replaces an older word selection with an exact full-sentence drag", async () => {
    const fixture = createFixture();
    await settle();
    const english = englishNode(fixture.player);
    const sentence = english.textContent ?? "";
    const wordStart = sentence.indexOf("investigation");

    selectText(english, wordStart, wordStart + "investigation".length);

    const downstreamMouseup = vi.fn();
    document.addEventListener("mouseup", downstreamMouseup);
    selectText(english, 0, sentence.length, fixture.player);

    expect(fixture.onSelection).toHaveBeenCalledTimes(2);
    expect(fixture.onSelection.mock.calls[1]?.[0].input).toMatchObject({
      context: sentence,
      selection: sentence,
      selectionKind: "sentence",
      sentenceContext: null,
      wordbookContext: null,
    });
    expect(downstreamMouseup).not.toHaveBeenCalled();
    document.removeEventListener("mouseup", downstreamMouseup);
  });

  it("does not reset a ready pinned session for same-video page-data updates", async () => {
    const fixture = createFixture();
    await settle();
    const surface = fixture.player.querySelector("[data-huayi-youtube-subtitle-surface]");
    const button = fixture.player.querySelector<HTMLButtonElement>(
      "[data-huayi-youtube-bilingual]",
    );
    button?.click();

    document.dispatchEvent(new Event("yt-page-data-updated"));
    await settle();

    expect(fixture.player.querySelector("[data-huayi-youtube-subtitle-surface]")).toBe(surface);
    expect(button?.getAttribute("aria-pressed")).toBe("true");
    expect(fixture.bridge.capture).toHaveBeenCalledTimes(2);
  });

  it("does not treat a persistent English ASR correction as a track switch", async () => {
    vi.useFakeTimers();
    const fixture = createFixture();
    await settle();
    const surface = fixture.player.querySelector("[data-huayi-youtube-subtitle-surface]");
    const nativeCaption = fixture.player.querySelector<HTMLElement>(".ytp-caption-segment");

    if (nativeCaption === null) throw new Error("Expected native captions.");
    nativeCaption.textContent = "A completely different rolling English correction";
    await settle();
    await vi.advanceTimersByTimeAsync(2_100);
    await settle();

    expect(fixture.player.querySelector("[data-huayi-youtube-subtitle-surface]")).toBe(surface);
    expect(fixture.bridge.capture).toHaveBeenCalledTimes(2);
    expect(fixture.bridge.probeSource).toHaveBeenCalledOnce();
  });

  it("restores native captions after a persistent switch to a non-English track", async () => {
    vi.useFakeTimers();
    const fixture = createFixture({ sourceStatus: "non-english" });
    await settle();
    const nativeCaption = fixture.player.querySelector<HTMLElement>(".ytp-caption-segment");

    if (nativeCaption === null) throw new Error("Expected native captions.");
    nativeCaption.textContent = "这是一条中文字幕";
    await settle();
    await vi.advanceTimersByTimeAsync(2_100);
    await settle();

    expect(fixture.player.dataset.huayiYoutubeSubtitlesActive).toBeUndefined();
    expect(fixture.player.querySelector("[data-huayi-youtube-subtitle-surface]")).toBeNull();
    expect(fixture.bridge.capture).toHaveBeenCalledTimes(2);

    nativeCaption.textContent = "这是另一条中文字幕";
    await settle();
    await vi.advanceTimersByTimeAsync(10_000);
    await settle();
    expect(fixture.bridge.capture).toHaveBeenCalledTimes(2);
    expect(fixture.player.querySelector("[data-huayi-youtube-subtitle-surface]")).toBeNull();

    fixture.setSourceStatus("same-source");
    nativeCaption.textContent = "The investigation was";
    await settle();
    await vi.advanceTimersByTimeAsync(2_100);
    await settle();
    expect(fixture.bridge.capture).toHaveBeenCalledTimes(2);
    expect(fixture.player.querySelector("[data-huayi-youtube-subtitle-surface]")).not.toBeNull();
  });

  it("restores native captions after switching to a Latin-script non-English track", async () => {
    vi.useFakeTimers();
    const fixture = createFixture({ sourceStatus: "non-english" });
    await settle();
    const nativeCaption = fixture.player.querySelector<HTMLElement>(".ytp-caption-segment");

    if (nativeCaption === null) throw new Error("Expected native captions.");
    nativeCaption.textContent = "Esta es otra pista de subtitulos";
    await settle();
    await vi.advanceTimersByTimeAsync(2_100);
    await settle();

    expect(fixture.bridge.probeSource).toHaveBeenCalledOnce();
    expect(fixture.player.dataset.huayiYoutubeSubtitlesActive).toBeUndefined();
    expect(fixture.player.querySelector("[data-huayi-youtube-subtitle-surface]")).toBeNull();
  });

  it("keeps the bilingual control mounted while no sentence is scheduled", async () => {
    const fixture = createFixture();
    await settle();

    fixture.video.currentTime = 20;
    fixture.video.dispatchEvent(new Event("timeupdate"));

    expect(
      fixture.player.querySelector<HTMLElement>("[data-huayi-youtube-subtitle-surface]")?.hidden,
    ).toBe(true);
    expect(fixture.player.querySelector("[data-huayi-youtube-bilingual]")).not.toBeNull();
  });

  it("rejects a range crossing outside the stable English text node", async () => {
    const fixture = createFixture();
    await settle();
    const english = englishNode(fixture.player);
    const translation = fixture.player.querySelector<HTMLElement>(
      "[data-huayi-youtube-translated]",
    );
    const range = document.createRange();
    range.setStart(english.firstChild ?? english, 0);
    range.setEnd(translation?.firstChild ?? translation ?? english, 1);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
    english.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));

    expect(fixture.onSelection).not.toHaveBeenCalled();
    expect(fixture.video.pause).not.toHaveBeenCalled();
  });

  it("consumes the first player-surface click, closes the card, and resumes only its own pause", async () => {
    const fixture = createFixture();
    await settle();
    const english = englishNode(fixture.player);
    selectText(english, 4, 17);
    const selectionEvent = fixture.onSelection.mock.calls[0]?.[0];
    if (selectionEvent === undefined) throw new Error("Expected a subtitle selection event.");
    fixture.setOverlayState({
      status: "actions",
      anchorRect: { bottom: 0, height: 0, left: 0, right: 0, top: 0, width: 0 },
      selection: selectionEvent.input,
    });
    const surface = fixture.player.querySelector<HTMLElement>(".html5-video-container");
    const nativePlayerClick = vi.fn(() => {
      if (fixture.video.paused) {
        void fixture.video.play();
      } else {
        fixture.video.pause();
      }
    });
    fixture.player.addEventListener("click", nativePlayerClick);
    const pointerdown = new MouseEvent("pointerdown", { bubbles: true, cancelable: true });
    fixture.onSessionClose.mockImplementation(() => selectionEvent.presentation.onClose?.());
    surface?.dispatchEvent(pointerdown);
    surface?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

    expect(pointerdown.defaultPrevented).toBe(true);
    expect(fixture.onSessionClose).toHaveBeenCalledOnce();
    expect(fixture.video.play).toHaveBeenCalledOnce();
    expect(fixture.video.pause).toHaveBeenCalledOnce();
    expect(nativePlayerClick).not.toHaveBeenCalled();
    expect(window.getSelection()?.isCollapsed).toBe(true);
  });

  it("does not start an already-paused video while dismissing its subtitle card", async () => {
    const fixture = createFixture({ initiallyPaused: true });
    await settle();
    selectText(englishNode(fixture.player), 4, 17);
    const selectionEvent = fixture.onSelection.mock.calls[0]?.[0];
    if (selectionEvent === undefined) throw new Error("Expected a subtitle selection event.");
    fixture.setOverlayState({
      status: "actions",
      anchorRect: { bottom: 0, height: 0, left: 0, right: 0, top: 0, width: 0 },
      selection: selectionEvent.input,
    });
    const nativePlayerClick = vi.fn(() => {
      if (fixture.video.paused) {
        void fixture.video.play();
      } else {
        fixture.video.pause();
      }
    });
    fixture.player.addEventListener("click", nativePlayerClick);
    const surface = fixture.player.querySelector<HTMLElement>(".html5-video-container");
    fixture.onSessionClose.mockImplementation(() => selectionEvent.presentation.onClose?.());
    surface?.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, cancelable: true }));
    surface?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

    expect(fixture.onSessionClose).toHaveBeenCalledOnce();
    expect(fixture.video.play).not.toHaveBeenCalled();
    expect(nativePlayerClick).not.toHaveBeenCalled();
  });

  it("keeps a pending wordbook write open on a player-surface click", async () => {
    const fixture = createFixture({ canDismissSelection: () => false });
    await settle();
    selectText(englishNode(fixture.player), 4, 17);
    const surface = fixture.player.querySelector<HTMLElement>(".html5-video-container");
    const click = new MouseEvent("pointerdown", { bubbles: true, cancelable: true });
    surface?.dispatchEvent(click);

    expect(click.defaultPrevented).toBe(false);
    expect(fixture.onSessionClose).not.toHaveBeenCalled();
    expect(fixture.video.play).not.toHaveBeenCalled();
    expect(window.getSelection()?.isCollapsed).toBe(false);

    const selectionEvent = fixture.onSelection.mock.calls[0]?.[0];
    if (selectionEvent === undefined) throw new Error("Expected a subtitle selection event.");
    fixture.setOverlayState({
      status: "actions",
      anchorRect: { bottom: 0, height: 0, left: 0, right: 0, top: 0, width: 0 },
      selection: selectionEvent.input,
    });
    selectText(englishNode(fixture.player), 22, 27);
    expect(fixture.onSelection).toHaveBeenCalledOnce();
    expect(fixture.video.pause).toHaveBeenCalledOnce();
  });

  it("clears on navigation start without re-entering pause ownership or resuming", async () => {
    const fixture = createFixture();
    await settle();
    selectText(englishNode(fixture.player), 4, 17);
    const selectionEvent = fixture.onSelection.mock.calls[0]?.[0];
    if (selectionEvent === undefined) throw new Error("Expected a subtitle selection event.");
    fixture.onSessionClose.mockImplementation(() => selectionEvent.presentation.onClose?.());

    document.dispatchEvent(new Event("yt-navigate-start"));
    await settle();

    expect(fixture.onSessionClose).toHaveBeenCalledOnce();
    expect(fixture.video.play).not.toHaveBeenCalled();
    expect(fixture.player.querySelector("[data-huayi-youtube-subtitle-surface]")).toBeNull();
  });

  it("never resumes a video that was already paused and revokes ownership on play or seek", async () => {
    const paused = createFixture({ initiallyPaused: true });
    await settle();
    selectText(englishNode(paused.player), 4, 17);
    paused.onSelection.mock.calls[0]?.[0].presentation.onClose?.();
    expect(paused.video.play).not.toHaveBeenCalled();

    const playing = createFixture();
    await settle();
    selectText(englishNode(playing.player), 4, 17);
    playing.setPaused(false);
    playing.video.dispatchEvent(new Event("seeking"));
    playing.onSelection.mock.calls[0]?.[0].presentation.onClose?.();
    expect(playing.video.play).not.toHaveBeenCalled();
  });

  it("restores native captions on CC off, navigation, ads, and player destruction", async () => {
    const fixture = createFixture();
    await settle();
    const cc = fixture.player.querySelector(".ytp-subtitles-button");
    cc?.setAttribute("aria-pressed", "false");
    await settle();
    expect(fixture.player.dataset.huayiYoutubeSubtitlesActive).toBeUndefined();

    cc?.setAttribute("aria-pressed", "true");
    document.dispatchEvent(new Event("yt-navigate-finish"));
    fixture.player.classList.add("ad-showing");
    await settle();
    expect(fixture.player.querySelector("[data-huayi-youtube-subtitle-surface]")).toBeNull();
  });
});
