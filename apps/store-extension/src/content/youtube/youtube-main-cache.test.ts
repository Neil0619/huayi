import { afterEach, describe, expect, it, vi } from "vitest";

import { createYouTubeMainBridge, type YouTubeMainPlayer } from "./youtube-main-bridge.js";
import {
  YOUTUBE_BRIDGE_REQUEST,
  YOUTUBE_BRIDGE_SETUP,
  parseBridgeResponse,
  type YouTubeBridgeRequest,
} from "./youtube-bridge-contract.js";

const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()));

function fixture(translationStatus: () => number | Promise<number> = () => 200) {
  const target = new EventTarget();
  let videoId = "video-1";
  let cc = true;
  let track = { languageCode: "en", kind: "asr", vssId: "a.en" };
  const originalTrack = track;
  const environment = {
    XMLHttpRequest,
    addEventListener: target.addEventListener.bind(target),
    clearTimeout,
    fetch: vi.fn<typeof fetch>(
      async (input) =>
        new Response(
          JSON.stringify({
            events: [
              { id: 1, tStartMs: 0, wpWinPosId: 1 },
              { dDurationMs: 4_000, segs: [{ utf8: "Synthetic caption." }], tStartMs: 0 },
            ],
          }),
          {
            status: new URL(String(input)).searchParams.has("tlang")
              ? await translationStatus()
              : 200,
          },
        ),
    ),
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
  let player: YouTubeMainPlayer = {
    getOption: () => track,
    getOptions: () => ["captions"],
    getPlayerResponse: () => ({
      captions: { playerCaptionsTracklistRenderer: { captionTracks: [track] } },
      videoDetails: { videoId },
    }),
    isSubtitlesOn: () => cc,
    loadModule: vi.fn(),
    setOption: vi.fn((_module, _option, value) => {
      track = value as typeof track;
      const translation = (value as { translationLanguage?: { languageCode: string } })
        .translationLanguage?.languageCode;
      void environment.fetch(
        `https://www.youtube.com/api/timedtext?v=${videoId}&lang=${track.languageCode}&kind=asr&fmt=json3${translation === undefined ? "" : `&tlang=${translation}`}`,
      );
    }),
    unloadModule: vi.fn(),
  };
  const bridge = createYouTubeMainBridge(environment, () => player, { timeoutMs: 30 });
  cleanups.push(() => bridge.destroy());
  const dispatch = (data: unknown) => {
    const event = new MessageEvent("message", { data, origin: environment.location.origin });
    Object.defineProperty(event, "source", { value: environment });
    target.dispatchEvent(event);
  };
  const setup = (channel = "channel-1") =>
    dispatch({
      capability: "capability-1",
      channel,
      type: YOUTUBE_BRIDGE_SETUP,
    });
  setup();
  let sequence = 0;
  const request = async (
    captionTarget: YouTubeBridgeRequest["target"],
    overrides: Partial<YouTubeBridgeRequest> = {},
    expectReply = true,
  ) => {
    const message: YouTubeBridgeRequest = {
      capability: "capability-1",
      channel: "channel-1",
      expectedVideoId: videoId,
      generation: 1,
      requestId: `request-${++sequence}`,
      target: captionTarget,
      type: YOUTUBE_BRIDGE_REQUEST,
      ...overrides,
    };
    dispatch(message);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    const readResponse = (): unknown =>
      environment.postMessage.mock.calls.find(
        ([value]) => (value as { requestId: string }).requestId === message.requestId,
      )?.[0];
    if (expectReply) {
      await vi.waitFor(() => expect(readResponse()).toBeDefined(), { interval: 1, timeout: 500 });
    }
    return parseBridgeResponse(readResponse(), message);
  };
  return {
    environment,
    originalTrack,
    player,
    request,
    setup,
    target,
    setCc: (value: boolean) => {
      cc = value;
    },
    setTrack: (value: typeof track) => {
      track = value;
    },
    setVideoId: (value: string) => {
      videoId = value;
    },
    replacePlayer: () => {
      player = { ...player };
    },
  };
}

describe("Store YouTube capture reuse", () => {
  it.each(["HTTP 429", "timeout"])(
    "does not renew %s translation attempts when rolling captions recheck the cached source",
    async (failure) => {
      const h = fixture(() => (failure === "timeout" ? new Promise<number>(() => undefined) : 429));
      for (let index = 0; index < 10; index += 1) {
        expect(await h.request("source")).toMatchObject({ ok: true });
        expect(await h.request("translated")).toMatchObject({ ok: false });
        expect(await h.request("translated")).toMatchObject({ ok: false });
      }
      const translations = h.environment.fetch.mock.calls.filter(([url]) =>
        new URL(String(url)).searchParams.has("tlang"),
      );
      expect(translations).toHaveLength(2);
      expect(h.environment.fetch).toHaveBeenCalledTimes(6);
      expect(h.player.getOption("captions", "track")).toEqual(h.originalTrack);
    },
  );

  it("allows the second translation attempt to recover and reuses that successful result", async () => {
    let attempts = 0;
    const h = fixture(() => (++attempts === 1 ? 429 : 200));
    await h.request("source");
    expect(await h.request("translated")).toMatchObject({ ok: false });
    await h.request("source");
    expect(await h.request("translated")).toMatchObject({ ok: true });
    for (let index = 0; index < 10; index += 1) {
      expect(await h.request("source")).toMatchObject({ ok: true });
      expect(await h.request("translated")).toMatchObject({ ok: true });
    }
    expect(attempts).toBe(2);
  });

  it.each(["generation", "track"])(
    "permits fresh translation attempts after %s changes",
    async (change) => {
      let status = 429;
      const h = fixture(() => status);
      await h.request("source");
      for (let index = 0; index < 3; index += 1) {
        expect(await h.request("translated")).toMatchObject({ ok: false });
      }
      status = 200;
      // Service recovery alone cannot replenish the exhausted current-source budget.
      expect(await h.request("translated")).toMatchObject({ ok: false });
      const overrides = change === "generation" ? { generation: 2 } : {};
      if (change === "track") h.setTrack({ ...h.originalTrack, vssId: "b.en" });
      expect(await h.request("source", overrides)).toMatchObject({ ok: true });
      expect(await h.request("translated", overrides)).toMatchObject({ ok: true });
    },
  );

  it("revalidates rolling-caption checks without fetching or driving the same source/translation again", async () => {
    const h = fixture();
    const source = await h.request("source");
    const translated = await h.request("translated");
    expect(source?.ok).toBe(true);
    expect(translated?.ok).toBe(true);
    const fetches = h.environment.fetch.mock.calls.length;
    const drives = vi.mocked(h.player.setOption).mock.calls.length;
    for (let index = 0; index < 10; index += 1) {
      expect(await h.request("source")).toMatchObject({ ok: true, target: "source" });
      expect(await h.request("translated")).toMatchObject({ ok: true, target: "translated" });
    }
    expect(h.environment.fetch).toHaveBeenCalledTimes(fetches);
    expect(h.player.setOption).toHaveBeenCalledTimes(drives);
    expect(h.player.getOption("captions", "track")).toEqual(h.originalTrack);
  });

  it.each(["video", "player", "track", "navigation", "pagehide"])(
    "does not reuse a capture after %s changes",
    async (change) => {
      const h = fixture();
      expect((await h.request("source"))?.ok).toBe(true);
      expect((await h.request("translated"))?.ok).toBe(true);
      const fetches = h.environment.fetch.mock.calls.length;
      if (change === "video") h.setVideoId("video-2");
      else if (change === "player") h.replacePlayer();
      else if (change === "track") h.setTrack({ ...h.originalTrack, vssId: "b.en" });
      else
        h.target.dispatchEvent(new Event(change === "navigation" ? "yt-navigate-start" : change));
      expect(await h.request("translated")).toMatchObject({ ok: false });
      expect(h.environment.fetch).toHaveBeenCalledTimes(fetches);
      expect((await h.request("source"))?.ok).toBe(true);
      expect(h.environment.fetch.mock.calls.length).toBeGreaterThan(fetches);
    },
  );

  it.each(["CC off", "non-English", "outside watch"])(
    "fails closed and clears captures when %s is observed",
    async (change) => {
      const h = fixture();
      await h.request("source");
      const fetches = h.environment.fetch.mock.calls.length;
      if (change === "CC off") h.setCc(false);
      else if (change === "non-English") h.setTrack({ ...h.originalTrack, languageCode: "de" });
      else h.environment.location.pathname = "/";
      expect(await h.request("source")).toMatchObject({ ok: false });
      expect(h.environment.fetch).toHaveBeenCalledTimes(fetches);
      h.setCc(true);
      h.setTrack(h.originalTrack);
      h.environment.location.pathname = "/watch";
      expect((await h.request("source"))?.ok).toBe(true);
      expect(h.environment.fetch.mock.calls.length).toBeGreaterThan(fetches);
    },
  );

  it("isolates generations and sessions, and rejects stale generation and unknown capability", async () => {
    const h = fixture();
    await h.request("source");
    const initialFetches = h.environment.fetch.mock.calls.length;
    expect((await h.request("source", { generation: 2 }))?.ok).toBe(true);
    expect(h.environment.fetch.mock.calls.length).toBeGreaterThan(initialFetches);
    const secondFetches = h.environment.fetch.mock.calls.length;
    expect(await h.request("source")).toMatchObject({ ok: false, error: "stale" });
    expect(await h.request("source", { capability: "unknown" }, false)).toBeNull();
    expect(h.environment.fetch).toHaveBeenCalledTimes(secondFetches);
    h.setup("channel-2");
    expect(await h.request("translated", { channel: "channel-2" })).toMatchObject({ ok: false });
    expect((await h.request("source", { channel: "channel-2" }))?.ok).toBe(true);
    expect(h.environment.fetch.mock.calls.length).toBeGreaterThan(secondFetches);
  });

  it.each(["CC off", "player replacement"])(
    "does not publish or restore a capture invalidated by %s during the request",
    async (change) => {
      const h = fixture();
      const originalSetOption = h.player.setOption;
      h.player.setOption = vi.fn<YouTubeMainPlayer["setOption"]>((...args) => {
        originalSetOption(...args);
        if (change === "CC off") h.setCc(false);
        else h.replacePlayer();
      });
      expect(await h.request("source")).toMatchObject({ ok: false, error: "stale" });
      expect(h.environment.fetch).toHaveBeenCalledTimes(1);
      expect(h.player.setOption).toHaveBeenCalledTimes(1);
    },
  );
});
