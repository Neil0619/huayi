import { afterEach, describe, expect, it, vi } from "vitest";

import { YouTubeBridgeClient } from "./youtube-bridge-client.js";
import { YouTubeCaptionController } from "./youtube-caption-controller.js";
import { createYouTubeMainBridge, type YouTubeMainPlayer } from "./youtube-main-bridge.js";
import { asrJson3Fixture } from "./youtube-json3.test-support.js";

const cleanups: (() => void)[] = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
  document.body.textContent = "";
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("Store initial source readiness across controller/client/MAIN", () => {
  it.each(["en", "de"])(
    "rechecks the ready %s track behind an unchanged visible cue",
    async (languageCode) => {
      vi.useFakeTimers();
      document.body.innerHTML = `<div class="html5-video-player"><video></video>
      <span class="ytp-caption-segment">Hello.</span>
      <button class="ytp-subtitles-button" aria-pressed="true"></button></div>`;
      const target = new EventTarget();
      const englishTrack = { kind: "asr", languageCode: "en", vssId: "a.en" };
      let activeTrack: unknown = englishTrack;
      let ready = false;
      const environment = {
        XMLHttpRequest,
        addEventListener: target.addEventListener.bind(target),
        clearTimeout,
        fetch: vi.fn<typeof fetch>(async () => new Response(JSON.stringify(asrJson3Fixture))),
        location: {
          hostname: "www.youtube.com",
          origin: window.location.origin,
          pathname: "/watch",
          protocol: "https:",
        },
        postMessage: vi.fn((data: unknown) =>
          window.dispatchEvent(
            new MessageEvent("message", {
              data,
              origin: window.location.origin,
              source: window,
            }),
          ),
        ),
        removeEventListener: target.removeEventListener.bind(target),
        setTimeout,
      };
      const setOption = vi.fn((_module: string, _option: string, value: unknown) => {
        activeTrack = value;
        const translated =
          typeof value === "object" && value !== null && "translationLanguage" in value;
        void environment.fetch(
          `https://www.youtube.com/api/timedtext?v=video-1&lang=en&kind=asr&fmt=json3${translated ? "&tlang=zh-Hans" : ""}`,
        );
      });
      const player: YouTubeMainPlayer = {
        getOption: () => activeTrack,
        getOptions: () => (ready ? ["captions"] : []),
        getPlayerResponse: () => ({
          captions: {
            playerCaptionsTracklistRenderer: { captionTracks: [{ ...englishTrack, languageCode }] },
          },
          videoDetails: { videoId: "video-1" },
        }),
        isSubtitlesOn: () => true,
        loadModule: vi.fn(),
        setOption,
        unloadModule: vi.fn(),
      };
      const main = createYouTubeMainBridge(environment, () => player);
      cleanups.push(() => main.destroy());
      vi.spyOn(window, "postMessage").mockImplementation((data: unknown) => {
        const event = new MessageEvent("message", { data, origin: window.location.origin });
        Object.defineProperty(event, "source", { value: environment });
        target.dispatchEvent(event);
      });
      const client = new YouTubeBridgeClient({
        capability: "capability-1",
        channel: "channel-1",
        document,
        getCurrentVideoId: () => "video-1",
      });
      const controller = new YouTubeCaptionController({
        bridge: client,
        document,
        getVideoId: () => "video-1",
        isWatchPage: () => true,
        mode: "english",
        overlay: { close: vi.fn(), show: vi.fn() },
      });
      cleanups.push(() => controller.stop());
      controller.start();
      await vi.advanceTimersByTimeAsync(0);
      expect(environment.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ error: "unavailable", ok: false, target: "source" }),
        window.location.origin,
      );
      expect(setOption).not.toHaveBeenCalled();
      expect(document.querySelector("[data-huayi-store-youtube-subtitles]")).toBeNull();

      ready = true;
      activeTrack = { ...englishTrack, languageCode };
      await vi.advanceTimersByTimeAsync(1_000);
      if (languageCode === "en") {
        expect(document.querySelector("[data-huayi-store-youtube-english]")?.textContent).toBe(
          "Hello.",
        );
      } else {
        expect(document.querySelector("[data-huayi-store-youtube-subtitles]")).toBeNull();
        expect(setOption).not.toHaveBeenCalled();
        expect(environment.postMessage).toHaveBeenCalledTimes(3);
      }
    },
  );
});
