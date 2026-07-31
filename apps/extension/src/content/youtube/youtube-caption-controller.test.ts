import { afterEach, describe, expect, it, vi } from "vitest";

import type { SelectionRequestInput } from "../selection/read-selection.js";
import {
  controlButton,
  createControllerFixture as createFixture,
  destroyControllerFixtures,
  pickerHost,
} from "../../../test-support/youtube-caption-controller.js";

afterEach(() => {
  destroyControllerFixtures();
  vi.useRealTimers();
  document.body.textContent = "";
});

describe("YouTubeCaptionController", () => {
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

  it("shows an incomplete sentence immediately and enables selection after a later cue", async () => {
    vi.useFakeTimers();
    const fixture = createFixture(false, "The investigation was still");
    controlButton(fixture.player).click();

    const picker = pickerHost(fixture.player);
    expect(fixture.video.pause).not.toHaveBeenCalled();
    expect(picker.shadowRoot?.querySelector("[role='dialog']")?.getAttribute("aria-busy")).toBe(
      "true",
    );
    expect(picker.shadowRoot?.textContent).toContain("正在补全当前句");
    expect(picker.shadowRoot?.querySelectorAll("[data-caption-word]")).toHaveLength(0);

    const caption = fixture.player.querySelector<HTMLElement>(".ytp-caption-segment");
    if (caption === null) {
      throw new Error("Expected a caption segment.");
    }
    caption.textContent = "was still in its early stages.";
    await Promise.resolve();
    await Promise.resolve();

    expect(fixture.video.pause).toHaveBeenCalledOnce();
    expect(picker.shadowRoot?.querySelector("[role='dialog']")?.getAttribute("aria-busy")).toBe(
      "false",
    );
    expect(picker.shadowRoot?.textContent).toContain(
      "The investigation was still in its early stages.",
    );
    expect(
      [...(picker.shadowRoot?.querySelectorAll("[data-caption-word]") ?? [])].some(
        (word) => word.textContent === "investigation",
      ),
    ).toBe(true);
    expect(fixture.onWarmup).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(2_500);
    expect(fixture.video.pause).toHaveBeenCalledOnce();
  });

  it("freezes a best-effort caption after the completion timeout", async () => {
    vi.useFakeTimers();
    const fixture = createFixture(false, "An automatic caption without punctuation");
    controlButton(fixture.player).click();

    await vi.advanceTimersByTimeAsync(2_500);

    const picker = pickerHost(fixture.player);
    expect(fixture.video.pause).toHaveBeenCalledOnce();
    expect(picker.shadowRoot?.textContent).toContain("未检测到完整句尾，已使用当前片段");
    expect(picker.shadowRoot?.textContent).toContain("当前字幕");
    expect(picker.shadowRoot?.querySelectorAll("[data-caption-word]").length).toBeGreaterThan(0);
  });

  it("does not auto-play an originally paused video to complete a sentence", () => {
    const fixture = createFixture(true, "An unfinished paused caption");
    controlButton(fixture.player).click();

    const picker = pickerHost(fixture.player);
    expect(fixture.video.pause).not.toHaveBeenCalled();
    expect(fixture.play).not.toHaveBeenCalled();
    expect(picker.shadowRoot?.querySelector("[role='dialog']")?.getAttribute("aria-busy")).toBe(
      "false",
    );
    expect(picker.shadowRoot?.textContent).toContain("当前字幕");
  });

  it("cancels completion without taking playback ownership", () => {
    vi.useFakeTimers();
    const fixture = createFixture(false, "An unfinished playing caption");
    const button = controlButton(fixture.player);
    button.click();

    button.click();

    expect(fixture.player.querySelector("[data-huayi-youtube-picker-host]")).toBeNull();
    expect(fixture.video.pause).not.toHaveBeenCalled();
    expect(fixture.play).not.toHaveBeenCalled();
  });

  it("finalizes without playback ownership when the viewer pauses during completion", () => {
    vi.useFakeTimers();
    const fixture = createFixture(false, "An unfinished playing caption");
    controlButton(fixture.player).click();

    const caption = fixture.player.querySelector<HTMLElement>(".ytp-caption-segment");
    if (caption === null) {
      throw new Error("Expected a caption segment.");
    }
    caption.textContent = "playing caption that now finishes.";
    fixture.setPaused(true);
    fixture.video.dispatchEvent(new Event("pause"));

    const picker = pickerHost(fixture.player);
    expect(picker.shadowRoot?.textContent).toContain(
      "An unfinished playing caption that now finishes.",
    );
    expect(picker.shadowRoot?.textContent).toContain("整句字幕");
    picker.shadowRoot?.querySelector<HTMLButtonElement>("[data-action='continue']")?.click();
    expect(fixture.play).not.toHaveBeenCalled();
  });

  it("cancels a pending completion on seeking and ignores the late timeout", async () => {
    vi.useFakeTimers();
    const fixture = createFixture(false, "An unfinished playing caption");
    controlButton(fixture.player).click();

    fixture.video.dispatchEvent(new Event("seeking"));
    await vi.advanceTimersByTimeAsync(2_500);

    expect(fixture.player.querySelector("[data-huayi-youtube-picker-host]")).toBeNull();
    expect(fixture.video.pause).not.toHaveBeenCalled();
    expect(fixture.play).not.toHaveBeenCalled();
  });

  it("clears a pending completion on same-page YouTube navigation", async () => {
    vi.useFakeTimers();
    const fixture = createFixture(false, "An unfinished playing caption");
    controlButton(fixture.player).click();

    document.dispatchEvent(new Event("yt-navigate-finish"));
    await vi.advanceTimersByTimeAsync(2_500);

    expect(fixture.player.querySelector("[data-huayi-youtube-picker-host]")).toBeNull();
    expect(fixture.video.pause).not.toHaveBeenCalled();
  });

  it("cancels completion when the player enters an advertisement", async () => {
    vi.useFakeTimers();
    const fixture = createFixture(false, "An unfinished playing caption");
    controlButton(fixture.player).click();

    fixture.player.classList.add("ad-showing");
    await Promise.resolve();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(2_500);

    expect(fixture.player.querySelector("[data-huayi-youtube-picker-host]")).toBeNull();
    expect(fixture.video.pause).not.toHaveBeenCalled();
  });

  it("lets Escape cancel completion without pausing the video", async () => {
    vi.useFakeTimers();
    const fixture = createFixture(false, "An unfinished playing caption");
    controlButton(fixture.player).click();

    document.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }));
    await vi.advanceTimersByTimeAsync(2_500);

    expect(fixture.player.querySelector("[data-huayi-youtube-picker-host]")).toBeNull();
    expect(fixture.video.pause).not.toHaveBeenCalled();
  });

  it("clears completion when YouTube replaces the player", async () => {
    vi.useFakeTimers();
    const fixture = createFixture(false, "An unfinished playing caption");
    controlButton(fixture.player).click();

    const replacement = fixture.player.cloneNode(true);
    fixture.player.replaceWith(replacement);
    await Promise.resolve();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(2_500);

    expect(fixture.player.querySelector("[data-huayi-youtube-picker-host]")).toBeNull();
    expect(fixture.video.pause).not.toHaveBeenCalled();
  });
});
