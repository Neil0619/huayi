import { afterEach, describe, expect, it, vi } from "vitest";

import { mountAsbplayerProbe } from "./asbplayer-probe.js";
import { parseAsbplayerPlaybackContext } from "./asbplayer-location.js";
import { adapterHarness, cue, TEST_MEDIA, TEST_URL } from "./asbplayer.test-support.js";

afterEach(() => {
  document.body.replaceChildren();
  document.querySelector("[data-seen-said-asbplayer-probe]")?.remove();
  vi.useRealTimers();
});

describe("standalone M0 probe", () => {
  it("displays only sanitized availability/counts and waits for an upstream full snapshot", () => {
    vi.useFakeTimers();
    const { adapter, port } = adapterHarness();
    const dispose = mountAsbplayerProbe({
      document,
      adapter,
      readContext: () => parseAsbplayerPlaybackContext(TEST_URL, "top-level"),
    });
    const host = document.querySelector<HTMLElement>("[data-seen-said-asbplayer-probe]");
    expect(host?.dataset.status).toBe("waiting");
    port.send({
      command: "subtitles",
      value: [cue({ text: "private subtitle" })],
      names: ["private filename"],
    });
    port.send({ command: "offset", value: 250 });
    vi.advanceTimersByTime(250);
    expect(host?.dataset.status).toBe("ready");
    expect(host?.dataset.cues).toBe("1");
    expect(host?.dataset.offsetMs).toBe("250");
    expect(host?.shadowRoot?.textContent).not.toContain("private");
    expect(host?.shadowRoot?.textContent).not.toContain("blob:");
    dispose();
    expect(document.querySelector("[data-seen-said-asbplayer-probe]")).toBeNull();
    expect(adapter.getSnapshot().reason).toBe("closed");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("enables explicit pause/play only for a ready snapshot and current unique media", async () => {
    vi.useFakeTimers();
    const { adapter, port } = adapterHarness();
    const container = document.createElement("div");
    container.className = "asbplayer-token-container";
    const video = document.createElement("video");
    video.src = TEST_MEDIA;
    video.preload = "auto";
    vi.spyOn(video, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 640,
      bottom: 360,
      width: 640,
      height: 360,
      toJSON: () => ({}),
    });
    const pause = vi.spyOn(video, "pause").mockImplementation(() => undefined);
    const play = vi.spyOn(video, "play").mockResolvedValue();
    container.append(video);
    document.body.append(container);
    const dispose = mountAsbplayerProbe({
      document,
      adapter,
      readContext: () => parseAsbplayerPlaybackContext(TEST_URL, "top-level"),
    });
    const shadow = document.querySelector("[data-seen-said-asbplayer-probe]")?.shadowRoot;
    const pauseButton = shadow?.querySelector<HTMLButtonElement>("[data-action=pause]");
    const playButton = shadow?.querySelector<HTMLButtonElement>("[data-action=play]");
    expect(pauseButton?.disabled).toBe(true);
    port.send({ command: "subtitles", value: [cue()] });
    vi.advanceTimersByTime(250);
    expect(pauseButton?.disabled).toBe(false);
    pauseButton?.click();
    playButton?.click();
    await Promise.resolve();
    expect(pause).toHaveBeenCalledOnce();
    expect(play).toHaveBeenCalledOnce();
    video.remove();
    pauseButton?.click();
    expect(pause).toHaveBeenCalledOnce();
    dispose();
  });
});
