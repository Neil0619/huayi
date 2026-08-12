import { describe, expect, it, vi } from "vitest";

import { createYouTubeMainBridge, type YouTubeMainPlayer } from "./youtube-main-bridge.js";
import {
  YOUTUBE_BRIDGE_REQUEST,
  YOUTUBE_BRIDGE_SETUP,
  type YouTubeBridgeRequest,
} from "./youtube-bridge-contract.js";

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("Store YouTube static MAIN bridge", () => {
  it("accepts one correlated setup on an exact recorded watch player and restores state", async () => {
    const target = new EventTarget();
    const body = JSON.stringify({
      events: [{ dDurationMs: 1_000, segs: [{ utf8: "Hello." }], tStartMs: 0 }],
    });
    let track: unknown = { kind: "asr", languageCode: "en", vssId: ".en" };
    let loaded = true;
    const environment = {
      XMLHttpRequest,
      addEventListener: target.addEventListener.bind(target),
      clearTimeout,
      fetch: vi.fn<typeof fetch>(async () => new Response(body)),
      location: {
        hostname: "www.youtube.com",
        origin: "https://www.youtube.com",
        pathname: "/watch",
        protocol: "https:",
      },
      postMessage: vi.fn(),
      removeEventListener: target.removeEventListener.bind(target),
      setTimeout,
    };
    const player: YouTubeMainPlayer = {
      getOption: () => track,
      getOptions: () => (loaded ? ["captions"] : []),
      getPlayerResponse: () => ({
        captions: {
          playerCaptionsTracklistRenderer: {
            captionTracks: [{ kind: "asr", languageCode: "en", vssId: ".en" }],
          },
        },
        videoDetails: { isLiveContent: false, videoId: "video-1" },
      }),
      isSubtitlesOn: () => true,
      loadModule: () => {
        loaded = true;
      },
      setOption: (_module, _option, value) => {
        track = value;
        void environment.fetch(
          "https://www.youtube.com/api/timedtext?v=video-1&lang=en&kind=asr&fmt=json3",
        );
      },
      unloadModule: () => {
        loaded = false;
      },
    };
    const originalFetch = environment.fetch;
    const bridge = createYouTubeMainBridge(environment, () => player, { timeoutMs: 100 });
    const dispatch = (data: unknown) => {
      const event = new MessageEvent("message", {
        data,
        origin: "https://www.youtube.com",
      });
      Object.defineProperty(event, "source", { value: environment });
      target.dispatchEvent(event);
    };
    dispatch({ capability: "capability-1", channel: "channel-1", type: YOUTUBE_BRIDGE_SETUP });
    const request: YouTubeBridgeRequest = {
      capability: "forged",
      channel: "channel-1",
      expectedVideoId: "video-1",
      generation: 1,
      requestId: "forged-1",
      target: "source",
      type: YOUTUBE_BRIDGE_REQUEST,
    };
    dispatch(request);
    await settle();
    expect(environment.fetch).not.toHaveBeenCalled();

    dispatch({ ...request, capability: "capability-1", requestId: "request-1" });
    await settle();

    expect(environment.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ ok: true, requestId: "request-1" }),
      "https://www.youtube.com",
    );
    expect(track).toEqual({ kind: "asr", languageCode: "en", vssId: ".en" });
    expect(environment.fetch).toBe(originalFetch);
    bridge.destroy();
  });

  it("remains inert for a forged request outside the exact watch path", async () => {
    const target = new EventTarget();
    const originalFetch = vi.fn<typeof fetch>(async () => new Response("page"));
    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;
    const environment = {
      XMLHttpRequest,
      addEventListener: target.addEventListener.bind(target),
      clearTimeout,
      fetch: originalFetch,
      location: {
        hostname: "www.youtube.com",
        origin: "https://www.youtube.com",
        pathname: "/feed/subscriptions",
        protocol: "https:",
      },
      postMessage: vi.fn(),
      removeEventListener: target.removeEventListener.bind(target),
      setTimeout,
    };
    const getPlayer = vi.fn<() => YouTubeMainPlayer | null>(() => null);
    const bridge = createYouTubeMainBridge(environment, getPlayer, { timeoutMs: 10 });
    const dispatch = (data: unknown) => {
      const event = new MessageEvent("message", {
        data,
        origin: "https://www.youtube.com",
      });
      Object.defineProperty(event, "source", { value: environment });
      target.dispatchEvent(event);
    };

    dispatch({ capability: "capability-1", channel: "channel-1", type: YOUTUBE_BRIDGE_SETUP });
    dispatch({
      capability: "capability-1",
      channel: "channel-1",
      expectedVideoId: "video-1",
      generation: 1,
      requestId: "request-1",
      target: "source",
      type: YOUTUBE_BRIDGE_REQUEST,
    });
    await settle();

    expect(getPlayer).not.toHaveBeenCalled();
    expect(environment.fetch).toBe(originalFetch);
    expect(XMLHttpRequest.prototype.open).toBe(originalOpen);
    expect(XMLHttpRequest.prototype.send).toBe(originalSend);
    expect(environment.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ error: "unavailable", ok: false }),
      "https://www.youtube.com",
    );
    bridge.destroy();
  });
});
