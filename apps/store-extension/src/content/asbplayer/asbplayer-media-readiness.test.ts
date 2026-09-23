import { afterEach, expect, it, vi } from "vitest";
import { AsbplayerController } from "./asbplayer-controller.js";
import { AsbplayerMediaSession } from "./asbplayer-media-session.js";
import { parseAsbplayerPlaybackContext } from "./asbplayer-location.js";
import { adapterHarness, cue, TEST_URL } from "./asbplayer.test-support.js";
import type { AsbplayerSnapshot } from "./asbplayer-snapshot.js";

const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const stop of cleanup.splice(0)) stop();
  vi.restoreAllMocks();
  vi.useRealTimers();
  document.body.replaceChildren();
  Object.defineProperty(document, "fullscreenElement", { configurable: true, value: null });
});
function fixture(early = false) {
  vi.useFakeTimers();
  const h = adapterHarness();
  let url = TEST_URL;
  const player = document.createElement("div"),
    video = document.createElement("video");
  player.className = "asbplayer-token-container";
  video.preload = "auto";
  video.src = parseAsbplayerPlaybackContext(url, "top-level")?.mediaUrl ?? "";
  video.currentTime = 1.2;
  vi.spyOn(video, "getBoundingClientRect").mockReturnValue({
    width: 500,
    height: 300,
    top: 0,
    bottom: 300,
    left: 0,
    right: 500,
  } as DOMRect);
  player.append(video);
  if (!early) document.body.append(player);
  const media = new AsbplayerMediaSession(document, () =>
    parseAsbplayerPlaybackContext(url, "top-level"),
  );
  const listeners = new Set<(snapshot: AsbplayerSnapshot) => void>();
  const snapshot = () => {
    h.ports.at(-1)?.send({ command: "subtitles", value: [cue({ text: "Current sentence." })] });
    h.ports.at(-1)?.send({ command: "offset", value: 0 });
  };
  if (early) snapshot();
  const controller = new AsbplayerController({
    document,
    bridge: {
      subscribe: (listener) => {
        listeners.add(listener);
        listener(h.adapter.getSnapshot());
        const unsubscribe = h.adapter.subscribe(listener);
        return () => {
          listeners.delete(listener);
          unsubscribe();
        };
      },
      start: vi.fn(),
      destroy: h.adapter.dispose,
    },
    mode: "english",
    appearance: "silver",
    media,
    overlay: { close: vi.fn(), relocate: vi.fn() } as never,
  });
  cleanup.push(() => controller.stop());
  controller.start();
  function confirm() {
    document.querySelector<HTMLButtonElement>("[data-confirm-tracks]")?.click();
  }
  return {
    ...h,
    controller,
    video,
    player,
    media,
    snapshot,
    confirm,
    change: () => {
      url = TEST_URL.replace("7fe82f76", "8fe82f76").replace("test-channel", "new-channel");
      video.src = parseAsbplayerPlaybackContext(url, "top-level")?.mediaUrl ?? "";
      h.navigate(url);
    },
    deliver: (snapshot: AsbplayerSnapshot) => listeners.forEach((listener) => listener(snapshot)),
  };
}
it("retains a one-shot full replay through first visible main-video discovery", () => {
  const h = fixture(true);
  expect(document.querySelector("[data-state=invalidated]")).not.toBeNull();
  document.body.append(h.player);
  vi.advanceTimersByTime(100);
  h.confirm();
  expect(h.player.hasAttribute("data-huayi-asbplayer-active")).toBe(true);
  expect(document.querySelector("[data-huayi-asbplayer-english]")?.textContent).toBe(
    "Current sentence.",
  );
});
it("rejects old confirmation synchronously before polling and rejects queued callbacks until a new session", () => {
  const h = fixture();
  h.snapshot();
  h.confirm();
  const stale = h.adapter.getSnapshot();
  h.change();
  h.confirm();
  expect(h.player.hasAttribute("data-huayi-asbplayer-active")).toBe(false);
  expect(document.querySelector("[data-state=waiting-full-snapshot]")).not.toBeNull();
  h.deliver({ ...stale, revision: stale.revision + 20 });
  h.confirm();
  expect(h.player.hasAttribute("data-huayi-asbplayer-active")).toBe(false);
  h.adapter.refreshContext();
  h.ports.at(-1)?.send({ command: "subtitlesUpdated", subtitles: [cue({ index: 0 })] });
  h.confirm();
  expect(h.player.hasAttribute("data-huayi-asbplayer-active")).toBe(false);
  h.ports.at(-1)?.send({ command: "subtitles", value: [cue({ text: "New context sentence." })] });
  h.confirm();
  expect(h.player.hasAttribute("data-huayi-asbplayer-active")).toBe(false);
  h.ports.at(-1)?.send({ command: "offset", value: 0 });
  h.confirm();
  expect(h.player.hasAttribute("data-huayi-asbplayer-active")).toBe(true);
  expect(document.querySelector("[data-huayi-asbplayer-english]")?.textContent).toBe(
    "New context sentence.",
  );
});
it("retains tracks across same-media visibility and element-fullscreen layout changes", () => {
  const h = fixture();
  h.snapshot();
  h.confirm();
  const generation = h.media.snapshotGeneration;
  h.player.hidden = true;
  vi.advanceTimersByTime(100);
  expect(h.player.hasAttribute("data-huayi-asbplayer-active")).toBe(false);
  h.player.hidden = false;
  vi.advanceTimersByTime(100);
  expect(h.player.hasAttribute("data-huayi-asbplayer-active")).toBe(true);
  const fullscreen = document.createElement("div");
  document.body.append(fullscreen);
  fullscreen.append(h.player);
  Object.defineProperty(document, "fullscreenElement", { configurable: true, value: fullscreen });
  document.dispatchEvent(new Event("fullscreenchange"));
  expect(h.player.hasAttribute("data-huayi-asbplayer-active")).toBe(true);
  expect(h.media.snapshotGeneration).toBe(generation);
});
it("clears readiness when the bound video replaces its source before location catches up", () => {
  const h = fixture();
  h.snapshot();
  h.confirm();
  h.video.src = h.video.src.replace("7fe82f76", "8fe82f76");
  h.confirm();
  expect(h.player.hasAttribute("data-huayi-asbplayer-active")).toBe(false);
  expect(document.querySelector("[data-state=waiting-full-snapshot]")).not.toBeNull();
});
