import { YOUTUBE_BRIDGE_RESPONSE } from "./youtube-bridge-contract.js";

export function successResponse(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    body: JSON.stringify({
      events: [{ dDurationMs: 1_000, segs: [{ utf8: "Hello." }], tStartMs: 0 }],
    }),
    expectedVideoId: "abc",
    fingerprint: {
      fmt: "json3",
      host: "www.youtube.com",
      lang: "en",
      path: "/api/timedtext",
      v: "abc",
    },
    generation: 1,
    ok: true,
    requestId: "request-1",
    target: "source",
    track: { languageCode: "en" },
    type: YOUTUBE_BRIDGE_RESPONSE,
    videoId: "abc",
    ...overrides,
  };
}

export function failureResponse(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    error: "timeout",
    expectedVideoId: "abc",
    generation: 1,
    ok: false,
    requestId: "request-2",
    target: "translated",
    type: YOUTUBE_BRIDGE_RESPONSE,
    ...overrides,
  };
}

export function dispatchBridgeResponse(data: Record<string, unknown>): void {
  window.dispatchEvent(
    new MessageEvent("message", {
      data,
      origin: window.location.origin,
      source: window,
    }),
  );
}
