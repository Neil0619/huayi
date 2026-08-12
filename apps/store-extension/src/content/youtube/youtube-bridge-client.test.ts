import { afterEach, describe, expect, it, vi } from "vitest";

import { YouTubeBridgeClient } from "./youtube-bridge-client.js";

const body = JSON.stringify({
  events: [{ dDurationMs: 1_000, segs: [{ utf8: "Hello." }], tStartMs: 0 }],
});

function success(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    body,
    capability: "capability-1",
    channel: "channel-1",
    expectedVideoId: "video-1",
    fingerprint: {
      fmt: "json3",
      host: "www.youtube.com",
      lang: "en",
      path: "/api/timedtext",
      v: "video-1",
    },
    generation: 4,
    ok: true,
    requestId: "request-1",
    target: "source",
    track: { languageCode: "en" },
    type: "huayi:store-youtube-caption-response",
    ...overrides,
  };
}

afterEach(() => vi.restoreAllMocks());

describe("Store YouTube bridge client", () => {
  it("sets up one per-document correlation and accepts only the exact pending response", async () => {
    const post = vi.spyOn(window, "postMessage");
    const client = new YouTubeBridgeClient({
      capability: "capability-1",
      channel: "channel-1",
      createRequestId: () => "request-1",
      document,
      getCurrentVideoId: () => "video-1",
    });

    const pending = client.capture({
      expectedVideoId: "video-1",
      generation: 4,
      target: "source",
    });
    window.dispatchEvent(
      new MessageEvent("message", {
        data: success({ capability: "page-forged" }),
        origin: window.location.origin,
        source: window,
      }),
    );
    window.dispatchEvent(
      new MessageEvent("message", {
        data: success(),
        origin: window.location.origin,
        source: window,
      }),
    );

    await expect(pending).resolves.toMatchObject({
      cues: [{ endMs: 1_000, startMs: 0, text: "Hello." }],
    });
    expect(post).toHaveBeenNthCalledWith(
      1,
      {
        capability: "capability-1",
        channel: "channel-1",
        type: "huayi:store-youtube-bridge-setup",
      },
      window.location.origin,
    );
    client.destroy();
  });

  it("rejects foreign source/origin and stale page generation", async () => {
    vi.useFakeTimers();
    const client = new YouTubeBridgeClient({
      capability: "capability-1",
      channel: "channel-1",
      createRequestId: () => "request-1",
      document,
      getCurrentVideoId: () => "video-1",
      timeoutMs: 10,
    });
    const pending = client.capture({
      expectedVideoId: "video-1",
      generation: 4,
      target: "source",
    });
    window.dispatchEvent(
      new MessageEvent("message", {
        data: success(),
        origin: window.location.origin,
        source: null,
      }),
    );
    window.dispatchEvent(
      new MessageEvent("message", {
        data: success(),
        origin: "https://attacker.invalid",
        source: window,
      }),
    );
    window.dispatchEvent(
      new MessageEvent("message", {
        data: success({ generation: 3 }),
        origin: window.location.origin,
        source: window,
      }),
    );
    await vi.advanceTimersByTimeAsync(10);

    await expect(pending).resolves.toBeNull();
    client.destroy();
    vi.useRealTimers();
  });
});
