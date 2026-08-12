import { describe, expect, it } from "vitest";

import {
  MAX_TIMED_TEXT_BYTES,
  parseBridgeResponse,
  parseTimedTextBody,
  type YouTubeBridgeCorrelation,
} from "./youtube-bridge-contract.js";

const correlation: YouTubeBridgeCorrelation = {
  capability: "capability-1",
  channel: "channel-1",
  expectedVideoId: "video-1",
  generation: 3,
  requestId: "request-1",
  target: "source",
};

function response(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ...correlation,
    body: JSON.stringify({
      events: [{ dDurationMs: 1_000, segs: [{ utf8: "Hello." }], tStartMs: 0 }],
    }),
    fingerprint: {
      fmt: "json3",
      host: "www.youtube.com",
      lang: "en",
      path: "/api/timedtext",
      v: "video-1",
    },
    ok: true,
    track: { languageCode: "en" },
    type: "huayi:store-youtube-caption-response",
    ...overrides,
  };
}

describe("Store YouTube bridge contract", () => {
  it("accepts only the exact pending capability, channel, generation, video and fingerprint", () => {
    expect(parseBridgeResponse(response(), correlation)).not.toBeNull();
    for (const forged of [
      { capability: "forged" },
      { channel: "forged" },
      { requestId: "forged" },
      { generation: 2 },
      {
        expectedVideoId: "other",
        fingerprint: {
          fmt: "json3",
          host: "www.youtube.com",
          lang: "en",
          path: "/api/timedtext",
          v: "other",
        },
      },
      { extra: true },
    ]) {
      expect(parseBridgeResponse(response(forged), correlation)).toBeNull();
    }
  });

  it("parses only bounded JSON3 bodies and bounded cue segments", () => {
    expect(parseTimedTextBody(response().body as string)).toEqual([
      { endMs: 1_000, startMs: 0, text: "Hello." },
    ]);
    expect(parseTimedTextBody("x".repeat(MAX_TIMED_TEXT_BYTES + 1))).toBeNull();
    expect(
      parseTimedTextBody(
        JSON.stringify({
          events: [{ segs: Array.from({ length: 1_001 }, () => ({ utf8: "x" })), tStartMs: 0 }],
        }),
      ),
    ).toBeNull();
  });
});
