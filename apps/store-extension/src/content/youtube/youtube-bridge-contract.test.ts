import { describe, expect, it } from "vitest";

import {
  MAX_TIMED_TEXT_BYTES,
  MAX_TIMED_TEXT_CUES,
  parseBridgeResponse,
  parseTimedTextBody,
  type YouTubeBridgeCorrelation,
} from "./youtube-bridge-contract.js";
import { asrJson3Fixture } from "./youtube-json3.test-support.js";

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

  it("ignores legitimate ASR window events without segments and keeps the text cues", () => {
    const body = JSON.stringify(asrJson3Fixture);
    expect(parseTimedTextBody(body)).toEqual([
      { endMs: 1_000, startMs: 0, text: "Hello." },
      { endMs: 2_000, startMs: 1_000, text: "Test." },
    ]);
    expect(parseBridgeResponse(response({ body }), correlation)).not.toBeNull();
    expect(parseTimedTextBody(JSON.stringify({ events: [asrJson3Fixture.events[0]] }))).toBeNull();
  });

  it.each([null, false, 1, "", {}])("rejects malformed present segments: %j", (segs) => {
    expect(
      parseTimedTextBody(
        JSON.stringify({ events: [{ tStartMs: 0, segs }, ...asrJson3Fixture.events] }),
      ),
    ).toBeNull();
  });

  it("still counts no-text events toward the event limit and bounds every text segment", () => {
    expect(
      parseTimedTextBody(
        JSON.stringify({
          events: [
            ...Array.from({ length: MAX_TIMED_TEXT_CUES }, () => ({})),
            ...asrJson3Fixture.events,
          ],
        }),
      ),
    ).toBeNull();
    expect(
      parseTimedTextBody(
        JSON.stringify({
          events: [
            ...asrJson3Fixture.events,
            { tStartMs: 0, segs: [{ utf8: "x".repeat(16_385) }] },
          ],
        }),
      ),
    ).toBeNull();
  });
});
