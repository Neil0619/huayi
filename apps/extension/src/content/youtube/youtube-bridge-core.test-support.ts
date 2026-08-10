import { vi } from "vitest";

import {
  createYouTubeBridge,
  type YouTubeBridgeEnvironment,
  type YouTubePlayer,
} from "./youtube-bridge-core.js";
import {
  YOUTUBE_BRIDGE_REQUEST,
  YOUTUBE_BRIDGE_RESPONSE,
  YOUTUBE_SOURCE_PROBE_REQUEST,
  YOUTUBE_SOURCE_PROBE_RESPONSE,
  type YouTubeBridgeResponse,
  type YouTubeSourceProbeResponse,
} from "./youtube-bridge-contract.js";

export const sourceBody = JSON.stringify({
  events: [{ tStartMs: 0, dDurationMs: 1_000, segs: [{ utf8: "Hello." }] }],
});
export const translatedBody = JSON.stringify({
  events: [{ tStartMs: 0, dDurationMs: 1_000, segs: [{ utf8: "你好。" }] }],
});

export function request(target: "source" | "translated", generation = 1) {
  return {
    type: YOUTUBE_BRIDGE_REQUEST,
    requestId: `${target}-${generation}`,
    generation,
    expectedVideoId: "video-1",
    target,
  } as const;
}

export function sourceProbe(requestId: string, generation = 1) {
  return {
    type: YOUTUBE_SOURCE_PROBE_REQUEST,
    requestId,
    generation,
    expectedVideoId: "video-1",
  } as const;
}

export function createBridgeCoreFixture(
  options: {
    cc?: boolean;
    languageCode?: string;
    omitActiveKind?: boolean;
    realPlayerTrackShape?: boolean;
    poToken?: false | string;
    mutateTrackInPlace?: boolean;
    suppressRepeatedSourceRequests?: boolean;
    transport?: "fetch" | "xhr" | "none";
  } = {},
) {
  const windowTarget = new EventTarget();
  const responses: YouTubeBridgeResponse[] = [];
  const probeResponses: YouTubeSourceProbeResponse[] = [];
  const responseTracks: unknown[] = [];
  const languageCode = options.languageCode ?? "en";
  const originalTrack = options.realPlayerTrackShape
    ? { kind: "", languageCode, vss_id: `.${languageCode}` }
    : {
        languageCode,
        vssId: `.${languageCode}`,
        ...(options.omitActiveKind === true ? {} : { kind: "asr" }),
      };
  const responseTrack = options.realPlayerTrackShape
    ? { languageCode, vssId: `.${languageCode}` }
    : { ...originalTrack, kind: "asr" };
  let activeTrack: unknown = originalTrack;
  let moduleLoaded = true;
  let sourceRequestCount = 0;

  class FakeXMLHttpRequest extends EventTarget {
    responseText = "";
    responseType: XMLHttpRequestResponseType = "";
    status = 0;
    private url = "";

    open(_method: string, url: string | URL): void {
      this.url = url.toString();
    }

    send(): void {
      queueMicrotask(() => {
        const url = new URL(this.url);
        this.responseText =
          url.searchParams.get("tlang") === "zh-Hans" ? translatedBody : sourceBody;
        this.status = 200;
        this.dispatchEvent(new Event("loadend"));
      });
    }
  }

  const env = {
    addEventListener: windowTarget.addEventListener.bind(windowTarget),
    removeEventListener: windowTarget.removeEventListener.bind(windowTarget),
    postMessage: vi.fn((message: unknown) => {
      if ((message as { type?: string }).type === YOUTUBE_BRIDGE_RESPONSE) {
        responses.push(message as YouTubeBridgeResponse);
        responseTracks.push(JSON.parse(JSON.stringify(activeTrack)) as unknown);
      } else if ((message as { type?: string }).type === YOUTUBE_SOURCE_PROBE_RESPONSE) {
        probeResponses.push(message as YouTubeSourceProbeResponse);
      }
    }),
    fetch: vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(input.toString());
      const body = url.searchParams.get("tlang") === "zh-Hans" ? translatedBody : sourceBody;
      return new Response(body, { headers: { "content-type": "application/json" } });
    }),
    XMLHttpRequest: FakeXMLHttpRequest as unknown as typeof XMLHttpRequest,
    setTimeout,
    clearTimeout,
    location: { hostname: "www.youtube.com", pathname: "/watch" },
  } satisfies YouTubeBridgeEnvironment;

  const player: YouTubePlayer = {
    getPlayerResponse: () => ({
      videoDetails: { videoId: "video-1", isLiveContent: false },
      captions: { playerCaptionsTracklistRenderer: { captionTracks: [responseTrack] } },
    }),
    getOption: (_module, option) => (option === "track" ? activeTrack : undefined),
    getOptions: () => (moduleLoaded ? ["captions"] : []),
    isSubtitlesOn: () => options.cc ?? true,
    unloadModule: vi.fn(() => {
      moduleLoaded = false;
    }),
    loadModule: vi.fn(() => {
      moduleLoaded = true;
    }),
    setOption: vi.fn((_module, _option, value) => {
      if (options.mutateTrackInPlace === true) {
        const target = activeTrack as Record<string, unknown>;
        for (const key of Object.keys(target)) Reflect.deleteProperty(target, key);
        Object.assign(target, value);
      } else {
        activeTrack = value;
      }
      const track = value as {
        languageCode: string;
        kind?: string;
        translationLanguage?: { languageCode: string };
      };
      const params = new URLSearchParams({ v: "video-1", lang: track.languageCode, fmt: "json3" });
      if (track.kind !== undefined) params.set("kind", track.kind);
      if (track.translationLanguage !== undefined) {
        params.set("tlang", track.translationLanguage.languageCode);
      } else {
        sourceRequestCount += 1;
        if (options.suppressRepeatedSourceRequests === true && sourceRequestCount > 1) return;
      }
      if (options.poToken !== false) params.set("pot", options.poToken ?? "sensitive");
      const url = `https://www.youtube.com/api/timedtext?${params.toString()}`;
      if ((options.transport ?? "fetch") === "fetch") {
        void env.fetch(url);
      } else if (options.transport === "xhr") {
        const xhr = new env.XMLHttpRequest();
        xhr.open("GET", url);
        xhr.send();
      }
    }),
  };

  const bridge = createYouTubeBridge(env, () => player, { timeoutMs: 100 });
  const dispatch = (message: unknown) => {
    const event = new MessageEvent("message", { data: message, source: window });
    Object.defineProperty(event, "source", { value: env });
    windowTarget.dispatchEvent(event);
  };
  return {
    bridge,
    dispatch,
    navigate: () => windowTarget.dispatchEvent(new Event("yt-navigate-start")),
    env,
    originalFetch: env.fetch,
    originalTrack,
    player,
    probeResponses,
    responses,
    responseTracks,
    setActiveTrack: (track: unknown) => {
      activeTrack = track;
    },
    state: () => ({ activeTrack, moduleLoaded }),
  };
}

export async function eventually(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}
