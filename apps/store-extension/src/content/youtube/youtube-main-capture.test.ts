import { describe, expect, it, vi } from "vitest";

import { installTimedTextCapture } from "./youtube-main-capture.js";
import { YOUTUBE_BRIDGE_REQUEST, type YouTubeBridgeRequest } from "./youtube-bridge-contract.js";

const request: YouTubeBridgeRequest = {
  capability: "capability-1",
  channel: "channel-1",
  expectedVideoId: "video-1",
  generation: 1,
  requestId: "request-1",
  target: "source",
  type: YOUTUBE_BRIDGE_REQUEST,
};

describe("Store YouTube MAIN timedtext capture", () => {
  it("captures only the exact bounded timedtext fingerprint and promptly restores fetch", async () => {
    const body = JSON.stringify({
      events: [{ dDurationMs: 1_000, segs: [{ utf8: "Hello." }], tStartMs: 0 }],
    });
    const originalFetch = vi.fn(
      async (input: RequestInfo | URL) =>
        new Response(input.toString().includes("/api/timedtext") ? body : "page"),
    );
    const environment = {
      XMLHttpRequest,
      clearTimeout,
      fetch: originalFetch as typeof fetch,
      setTimeout,
    };
    const originalOpen = environment.XMLHttpRequest.prototype.open;
    const originalSend = environment.XMLHttpRequest.prototype.send;
    const capture = installTimedTextCapture(
      environment,
      request,
      { kind: "asr", languageCode: "en" },
      5_000,
    );

    await environment.fetch("https://example.test/api/timedtext?v=video-1&lang=en&fmt=json3");
    await environment.fetch(
      "https://www.youtube.com/api/timedtext?v=video-1&lang=en&kind=asr&fmt=json3",
    );
    await expect(capture.result).resolves.toMatchObject({
      fingerprint: { path: "/api/timedtext", v: "video-1" },
    });
    capture.restore();

    expect(environment.fetch).toBe(originalFetch);
    expect(environment.XMLHttpRequest.prototype.open).toBe(originalOpen);
    expect(environment.XMLHttpRequest.prototype.send).toBe(originalSend);
  });

  it("fails closed for an over-limit matching response without changing the page response", async () => {
    const oversized = "x".repeat(2 * 1_024 * 1_024 + 1);
    const response = new Response(oversized, {
      headers: { "content-length": String(oversized.length) },
    });
    const originalFetch = vi.fn(async () => response);
    const environment = {
      XMLHttpRequest,
      clearTimeout,
      fetch: originalFetch as typeof fetch,
      setTimeout,
    };
    const capture = installTimedTextCapture(environment, request, { languageCode: "en" }, 100);

    await expect(
      environment.fetch("https://www.youtube.com/api/timedtext?v=video-1&lang=en&fmt=json3"),
    ).resolves.toBe(response);
    await expect(capture.result).rejects.toBe("invalid-response");
    capture.restore();
  });
});
