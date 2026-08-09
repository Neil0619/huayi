import { describe, expect, it } from "vitest";

import {
  parseBridgeRequest,
  parseBridgeResponse,
  parseSourceProbeRequest,
  parseSourceProbeResponse,
  parseTimedTextBody,
  YOUTUBE_BRIDGE_REQUEST,
  YOUTUBE_BRIDGE_RESPONSE,
  YOUTUBE_SOURCE_PROBE_REQUEST,
  YOUTUBE_SOURCE_PROBE_RESPONSE,
} from "./youtube-bridge-contract.js";

describe("YouTube bridge contract", () => {
  it("accepts only the narrow request shape", () => {
    const request = {
      type: YOUTUBE_BRIDGE_REQUEST,
      requestId: "request-1",
      generation: 4,
      expectedVideoId: "video_1-A",
      target: "source",
    };

    expect(parseBridgeRequest(request)).toEqual(request);
    expect(
      parseBridgeRequest({ ...request, url: "https://www.youtube.com/api/timedtext" }),
    ).toBeNull();
    expect(parseBridgeRequest({ ...request, generation: -1 })).toBeNull();
    expect(parseBridgeRequest({ ...request, target: "zh-Hans" })).toBeNull();
    expect(parseBridgeRequest({ ...request, expectedVideoId: "a".repeat(129) })).toBeNull();
  });

  it("accepts only metadata-free source identity probes", () => {
    const request = {
      type: YOUTUBE_SOURCE_PROBE_REQUEST,
      requestId: "probe-1",
      generation: 4,
      expectedVideoId: "video_1-A",
    } as const;
    const response = {
      type: YOUTUBE_SOURCE_PROBE_RESPONSE,
      requestId: "probe-1",
      generation: 4,
      expectedVideoId: "video_1-A",
      status: "same-source",
    } as const;

    expect(parseSourceProbeRequest(request)).toEqual(request);
    expect(parseSourceProbeRequest({ ...request, target: "source" })).toBeNull();
    expect(parseSourceProbeResponse(response)).toEqual(response);
    expect(parseSourceProbeResponse({ ...response, languageCode: "en" })).toBeNull();
    expect(parseSourceProbeResponse({ ...response, status: "same" })).toBeNull();
  });

  it("parses bounded JSON3 cues without exposing response metadata", () => {
    const body = JSON.stringify({
      events: [
        {
          tStartMs: 100,
          dDurationMs: 900,
          segs: [{ utf8: "Hello " }, { utf8: "world." }],
        },
      ],
    });

    expect(parseTimedTextBody(body)).toEqual([
      { startMs: 100, endMs: 1_000, text: "Hello world." },
    ]);
    expect(parseTimedTextBody("x".repeat(2 * 1_024 * 1_024 + 1))).toBeNull();
    expect(
      parseTimedTextBody(JSON.stringify({ events: Array.from({ length: 50_001 }, () => ({})) })),
    ).toBeNull();
  });

  it("accepts only bounded, metadata-only bridge responses", () => {
    const response = {
      type: YOUTUBE_BRIDGE_RESPONSE,
      requestId: "request-1",
      generation: 4,
      expectedVideoId: "video_1-A",
      target: "source",
      ok: true,
      videoId: "video_1-A",
      track: { languageCode: "en", kind: "asr" },
      fingerprint: {
        host: "www.youtube.com",
        path: "/api/timedtext",
        v: "video_1-A",
        lang: "en",
        kind: "asr",
        fmt: "json3",
      },
      body: JSON.stringify({
        events: [{ tStartMs: 0, dDurationMs: 1, segs: [{ utf8: "Hello." }] }],
      }),
    } as const;

    expect(parseBridgeResponse(response)).toEqual(response);
    expect(parseBridgeResponse({ ...response, poToken: "secret" })).toBeNull();
    expect(
      parseBridgeResponse({
        ...response,
        target: "translated",
        fingerprint: { ...response.fingerprint, tlang: "fr" },
      }),
    ).toBeNull();
  });
});
