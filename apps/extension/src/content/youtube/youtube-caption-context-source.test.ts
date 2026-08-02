import { afterEach, describe, expect, it, vi } from "vitest";

import type { TimedCaptionCue } from "./youtube-caption-transcript.js";
import { YouTubeCaptionContextSource } from "./youtube-caption-context-source.js";

function setVisibleRect(element: Element): void {
  const rect = {
    bottom: 640,
    height: 32,
    left: 180,
    right: 620,
    top: 608,
    width: 440,
    x: 180,
    y: 608,
    toJSON: () => ({}),
  };
  Object.defineProperty(element, "getBoundingClientRect", {
    configurable: true,
    value: () => rect,
  });
  Object.defineProperty(element, "getClientRects", {
    configurable: true,
    value: () => [rect],
  });
}

function createFixture(
  text: string,
  currentTime = 0,
): {
  caption: HTMLElement;
  player: HTMLElement;
  video: HTMLVideoElement;
} {
  const player = document.createElement("div");
  const video = document.createElement("video");
  Object.defineProperty(video, "currentTime", {
    configurable: true,
    writable: true,
    value: currentTime,
  });
  const caption = document.createElement("span");
  caption.className = "ytp-caption-segment";
  caption.textContent = text;
  setVisibleRect(caption);
  player.append(video, caption);
  document.body.append(player);
  return { caption, player, video };
}

async function flushMutations(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

afterEach(() => {
  document.body.textContent = "";
  vi.useRealTimers();
});

describe("YouTubeCaptionContextSource", () => {
  it("reconstructs an earlier half-sentence from the rolling memory buffer", async () => {
    const fixture = createFixture("The investigation was", 1);
    const source = new YouTubeCaptionContextSource({
      loadTranscript: async () => null,
    });
    source.attach(fixture.player, fixture.video, vi.fn());

    fixture.video.currentTime = 5;
    fixture.caption.textContent = "still in its early stages.";
    await flushMutations();

    expect(source.freeze()).toEqual({
      text: "The investigation was still in its early stages.",
    });
    source.clear();
  });

  it("does not merge a complete short word into the start of the next word", async () => {
    const fixture = createFixture("We can", 1);
    const source = new YouTubeCaptionContextSource({ loadTranscript: async () => null });
    source.attach(fixture.player, fixture.video, vi.fn());

    fixture.video.currentTime = 3;
    fixture.caption.textContent = "candy grows.";
    await flushMutations();

    expect(source.freeze()?.text).toBe("We can candy grows.");
    source.clear();
  });

  it("uses a ready transcript to include the future end of the current sentence", async () => {
    const fixture = createFixture("still in its", 4.5);
    const cues: TimedCaptionCue[] = [
      { endMs: 2_000, startMs: 0, text: "A previous sentence." },
      { endMs: 4_000, startMs: 2_000, text: "The investigation was" },
      { endMs: 6_000, startMs: 4_000, text: "still in its" },
      { endMs: 8_000, startMs: 6_000, text: "early stages." },
      { endMs: 10_000, startMs: 8_000, text: "The next sentence." },
    ];
    const source = new YouTubeCaptionContextSource({
      loadTranscript: async () => cues,
    });
    source.attach(fixture.player, fixture.video, vi.fn());
    await flushMutations();

    expect(source.freeze()).toEqual({
      text: "The investigation was still in its early stages.",
    });
    source.clear();
  });

  it("does not wait for a pending transcript before returning the rolling context", () => {
    const fixture = createFixture("The investigation was still in its early stages.", 5);
    const source = new YouTubeCaptionContextSource({
      loadTranscript: () => new Promise(() => undefined),
    });
    source.attach(fixture.player, fixture.video, vi.fn());

    expect(source.freeze()).toEqual({
      text: "The investigation was still in its early stages.",
    });
    source.clear();
  });

  it("rejects a mismatched transcript and falls back to observed captions", async () => {
    const fixture = createFixture("The investigation was", 1);
    const source = new YouTubeCaptionContextSource({
      loadTranscript: async () => [
        { endMs: 10_000, startMs: 0, text: "Completely unrelated transcript text." },
      ],
    });
    source.attach(fixture.player, fixture.video, vi.fn());
    fixture.video.currentTime = 5;
    fixture.caption.textContent = "still in its early stages.";
    await flushMutations();

    expect(source.freeze()?.text).toBe("The investigation was still in its early stages.");
    source.clear();
  });

  it("does not validate an unrelated active cue from repeated text elsewhere in the track", async () => {
    const fixture = createFixture("still in its", 4.5);
    const source = new YouTubeCaptionContextSource({
      loadTranscript: async () => [
        {
          endMs: 2_000,
          startMs: 0,
          text: "The investigation was still in its early stages.",
        },
        { endMs: 6_000, startMs: 4_000, text: "An unrelated active cue." },
      ],
    });
    source.attach(fixture.player, fixture.video, vi.fn());
    await flushMutations();

    expect(source.freeze()?.text).toBe("still in its");
    source.clear();
  });

  it("clears only rolling history when the viewer seeks", async () => {
    const fixture = createFixture("The investigation was", 1);
    const source = new YouTubeCaptionContextSource({ loadTranscript: async () => null });
    source.attach(fixture.player, fixture.video, vi.fn());
    fixture.video.currentTime = 70;
    fixture.video.dispatchEvent(new Event("seeking"));
    fixture.caption.textContent = "still in its early stages.";
    await flushMutations();

    expect(source.freeze()?.text).toBe("still in its early stages.");
    source.clear();
  });

  it("clears transcript and rolling history when the visible caption language changes", async () => {
    const fixture = createFixture("The investigation was", 1);
    const source = new YouTubeCaptionContextSource({ loadTranscript: async () => null });
    source.attach(fixture.player, fixture.video, vi.fn());

    fixture.caption.textContent = "调查仍处于早期阶段";
    await flushMutations();
    fixture.video.currentTime = 5;
    fixture.caption.textContent = "still in its early stages.";
    await flushMutations();

    expect(source.freeze()?.text).toBe("still in its early stages.");
    source.clear();
  });

  it("clears state when an English caption track fingerprint changes", async () => {
    const fixture = createFixture("The investigation was", 1);
    fixture.caption.dataset.trackId = "manual-en";
    const source = new YouTubeCaptionContextSource({ loadTranscript: async () => null });
    source.attach(fixture.player, fixture.video, vi.fn());

    fixture.caption.dataset.trackId = "automatic-en";
    fixture.video.currentTime = 5;
    fixture.caption.textContent = "still in its early stages.";
    await flushMutations();

    expect(source.freeze()?.text).toBe("still in its early stages.");
    source.clear();
  });

  it("clears state on the standard media text-track change event", async () => {
    const fixture = createFixture("The investigation was", 1);
    const textTracks = new EventTarget();
    Object.defineProperty(fixture.video, "textTracks", {
      configurable: true,
      value: textTracks,
    });
    const source = new YouTubeCaptionContextSource({ loadTranscript: async () => null });
    source.attach(fixture.player, fixture.video, vi.fn());

    textTracks.dispatchEvent(new Event("change"));
    fixture.video.currentTime = 5;
    fixture.caption.textContent = "still in its early stages.";
    await flushMutations();

    expect(source.freeze()?.text).toBe("still in its early stages.");
    source.clear();
  });

  it("clears rolling history when the player or video is replaced", async () => {
    const first = createFixture("The investigation was", 1);
    const source = new YouTubeCaptionContextSource({ loadTranscript: async () => null });
    source.attach(first.player, first.video, vi.fn());
    const second = createFixture("still in its early stages.", 5);

    source.attach(second.player, second.video, vi.fn());
    await flushMutations();

    expect(source.freeze()?.text).toBe("still in its early stages.");
    source.clear();
  });

  it("aborts a pending transcript after three seconds without delaying freeze", async () => {
    vi.useFakeTimers();
    const fixture = createFixture("The investigation was still in its early stages.", 5);
    const captured: { signal?: AbortSignal } = {};
    const source = new YouTubeCaptionContextSource({
      loadTranscript: (_document, signal) => {
        captured.signal = signal;
        return new Promise(() => undefined);
      },
    });
    source.attach(fixture.player, fixture.video, vi.fn());

    expect(source.freeze()?.text).toBe("The investigation was still in its early stages.");
    expect(captured.signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(captured.signal?.aborted).toBe(true);
    source.clear();
  });

  it("keeps rolling context within the protocol's 2,000-character limit", async () => {
    const fixture = createFixture("opening words", 0);
    const source = new YouTubeCaptionContextSource({ loadTranscript: async () => null });
    source.attach(fixture.player, fixture.video, vi.fn());

    for (let index = 1; index <= 30; index += 1) {
      fixture.video.currentTime = index;
      fixture.caption.textContent = `${String(index).padStart(2, "0")} ${"context ".repeat(12)}`;
      await flushMutations();
    }

    expect(source.freeze()?.text.length).toBeLessThanOrEqual(2_000);
    source.clear();
  });
});
