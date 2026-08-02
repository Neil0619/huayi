import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  loadYouTubeCaptionTranscript,
  type CaptionTranscriptFetch,
} from "./youtube-caption-transcript.js";

function appendPlayerResponse(baseUrl: string): void {
  const script = document.createElement("script");
  script.textContent = `var ytInitialPlayerResponse = ${JSON.stringify({
    captions: {
      playerCaptionsTracklistRenderer: {
        captionTracks: [
          { baseUrl, kind: "asr", languageCode: "en-US" },
          { baseUrl, languageCode: "en" },
        ],
      },
    },
  })};`;
  document.head.append(script);
}

describe("loadYouTubeCaptionTranscript", () => {
  beforeEach(() => {
    document.head.textContent = "";
    document.body.textContent = "";
  });

  it("prefers a manual English track and parses bounded json3 cues", async () => {
    appendPlayerResponse("https://www.youtube.com/api/timedtext?v=video&lang=en");
    const fetchImpl = vi.fn<CaptionTranscriptFetch>(
      async () =>
        new Response(
          JSON.stringify({
            events: [
              {
                dDurationMs: 2_000,
                segs: [{ utf8: "The investigation was " }, { utf8: "still ongoing." }],
                tStartMs: 1_000,
              },
            ],
          }),
          { headers: { "content-type": "application/json" }, status: 200 },
        ),
    );

    await expect(
      loadYouTubeCaptionTranscript(document, fetchImpl, new AbortController().signal),
    ).resolves.toEqual([
      { endMs: 3_000, startMs: 1_000, text: "The investigation was still ongoing." },
    ]);
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(fetchImpl.mock.calls[0]?.[0].toString()).toContain("fmt=json3");
    expect(fetchImpl.mock.calls[0]?.[1]).toMatchObject({ credentials: "omit" });
  });

  it("reloads the current watch document when a SPA page has no embedded player response", async () => {
    const bootstrap = document.createElement("script");
    bootstrap.type = "application/json";
    bootstrap.textContent = "usePlayer(a.ytInitialPlayerResponse);";
    document.head.append(bootstrap);
    const watchHtml = `<script>var ytInitialPlayerResponse = ${JSON.stringify({
      captions: {
        playerCaptionsTracklistRenderer: {
          captionTracks: [
            {
              baseUrl: "https://www.youtube.com/api/timedtext?v=video&lang=en",
              languageCode: "en",
            },
          ],
        },
      },
    })};</script>`;
    const fetchImpl = vi.fn<CaptionTranscriptFetch>(async (input) => {
      const url = new URL(input.toString());
      return url.pathname === "/watch"
        ? new Response(watchHtml, { status: 200 })
        : new Response(
            JSON.stringify({
              events: [
                {
                  dDurationMs: 2_000,
                  segs: [{ utf8: "The complete sentence." }],
                  tStartMs: 1_000,
                },
              ],
            }),
            { status: 200 },
          );
    });

    await expect(
      loadYouTubeCaptionTranscript(
        document,
        fetchImpl,
        new AbortController().signal,
        undefined,
        "https://www.youtube.com/watch?v=video",
      ),
    ).resolves.toEqual([{ endMs: 3_000, startMs: 1_000, text: "The complete sentence." }]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[0]?.[0].toString()).toBe("https://www.youtube.com/watch?v=video");
    expect(fetchImpl.mock.calls[0]?.[1]).toMatchObject({ credentials: "omit" });
  });

  it("ignores a stale SPA player response and reloads the current video document", async () => {
    appendPlayerResponse("https://www.youtube.com/api/timedtext?v=old-video&lang=en");
    const watchHtml = `<script>var ytInitialPlayerResponse = ${JSON.stringify({
      captions: {
        playerCaptionsTracklistRenderer: {
          captionTracks: [
            {
              baseUrl: "https://www.youtube.com/api/timedtext?v=current-video&lang=en",
              languageCode: "en",
            },
          ],
        },
      },
    })};</script>`;
    const fetchImpl = vi.fn<CaptionTranscriptFetch>(async (input) => {
      const url = new URL(input.toString());
      if (url.pathname === "/watch") {
        return new Response(watchHtml, { status: 200 });
      }
      const text =
        url.searchParams.get("v") === "current-video" ? "Current transcript." : "Stale transcript.";
      return new Response(
        JSON.stringify({
          events: [{ dDurationMs: 2_000, segs: [{ utf8: text }], tStartMs: 1_000 }],
        }),
        { status: 200 },
      );
    });

    await expect(
      loadYouTubeCaptionTranscript(
        document,
        fetchImpl,
        new AbortController().signal,
        (cues) => cues[0]?.text === "Current transcript.",
        "https://www.youtube.com/watch?v=current-video",
      ),
    ).resolves.toEqual([{ endMs: 3_000, startMs: 1_000, text: "Current transcript." }]);
    expect(fetchImpl.mock.calls.map(([input]) => new URL(input.toString()).pathname)).toEqual([
      "/watch",
      "/api/timedtext",
    ]);
  });

  it.each([
    "http://www.youtube.com/watch?v=video",
    "https://evil.example/watch?v=video",
    "https://www.youtube.com/shorts/video",
  ])("does not reload a non-allowlisted current page: %s", async (currentPageUrl) => {
    const fetchImpl = vi.fn();

    await expect(
      loadYouTubeCaptionTranscript(
        document,
        fetchImpl,
        new AbortController().signal,
        undefined,
        currentPageUrl,
      ),
    ).resolves.toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects an oversized reloaded watch document before parsing it", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response("", {
          headers: { "content-length": String(2 * 1_024 * 1_024 + 1) },
          status: 200,
        }),
    );

    await expect(
      loadYouTubeCaptionTranscript(
        document,
        fetchImpl,
        new AbortController().signal,
        undefined,
        "https://www.youtube.com/watch?v=video",
      ),
    ).resolves.toBeNull();
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("tries the automatic English track when the manual transcript fails visible-text validation", async () => {
    const script = document.createElement("script");
    script.type = "application/json";
    script.textContent = `var ytInitialPlayerResponse = ${JSON.stringify({
      captions: {
        playerCaptionsTracklistRenderer: {
          captionTracks: [
            {
              baseUrl: "https://www.youtube.com/api/timedtext?v=manual&lang=en",
              languageCode: "en",
            },
            {
              baseUrl: "https://www.youtube.com/api/timedtext?v=automatic&lang=en",
              kind: "asr",
              languageCode: "en",
            },
          ],
        },
      },
    })};`;
    document.head.append(script);
    const fetchImpl = vi.fn<CaptionTranscriptFetch>(async (input) => {
      const url = new URL(input.toString());
      const text = url.searchParams.get("v") === "manual" ? "Wrong track." : "Correct track.";
      return new Response(
        JSON.stringify({
          events: [{ dDurationMs: 2_000, segs: [{ utf8: text }], tStartMs: 1_000 }],
        }),
        { status: 200 },
      );
    });

    await expect(
      loadYouTubeCaptionTranscript(
        document,
        fetchImpl,
        new AbortController().signal,
        (cues) => cues[0]?.text === "Correct track.",
      ),
    ).resolves.toEqual([{ endMs: 3_000, startMs: 1_000, text: "Correct track." }]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it.each([
    "http://www.youtube.com/api/timedtext?v=video",
    "https://evil.example/api/timedtext?v=video",
    "https://www.youtube.com/watch?v=video",
  ])("rejects a non-allowlisted timed-text URL: %s", async (baseUrl) => {
    appendPlayerResponse(baseUrl);
    const fetchImpl = vi.fn();

    await expect(
      loadYouTubeCaptionTranscript(document, fetchImpl, new AbortController().signal),
    ).resolves.toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects an oversized response before parsing it", async () => {
    appendPlayerResponse("https://www.youtube.com/api/timedtext?v=video&lang=en");
    const fetchImpl = vi.fn(
      async () =>
        new Response("{}", {
          headers: { "content-length": String(2 * 1_024 * 1_024 + 1) },
          status: 200,
        }),
    );

    await expect(
      loadYouTubeCaptionTranscript(document, fetchImpl, new AbortController().signal),
    ).resolves.toBeNull();
  });

  it("rejects a transcript with more than 50,000 cue events", async () => {
    appendPlayerResponse("https://www.youtube.com/api/timedtext?v=video&lang=en");
    const body = JSON.stringify({ events: Array.from({ length: 50_001 }, () => null) });
    expect(new TextEncoder().encode(body).byteLength).toBeLessThan(2 * 1_024 * 1_024);
    const fetchImpl = vi.fn<CaptionTranscriptFetch>(
      async () => new Response(body, { status: 200 }),
    );

    await expect(
      loadYouTubeCaptionTranscript(document, fetchImpl, new AbortController().signal),
    ).resolves.toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("rejects string and non-finite cue times instead of coercing them", async () => {
    appendPlayerResponse("https://www.youtube.com/api/timedtext?v=video&lang=en");
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            events: [
              { dDurationMs: 2_000, segs: [{ utf8: "String time." }], tStartMs: "1000" },
              { dDurationMs: "2000", segs: [{ utf8: "String duration." }], tStartMs: 1_000 },
            ],
          }),
          { status: 200 },
        ),
    );

    await expect(
      loadYouTubeCaptionTranscript(document, fetchImpl, new AbortController().signal),
    ).resolves.toBeNull();
  });

  it("fails closed on malformed player-response and transcript data", async () => {
    const script = document.createElement("script");
    script.type = "application/json";
    script.textContent = "var ytInitialPlayerResponse = { definitely: notJson };";
    document.head.append(script);
    const fetchImpl = vi.fn();

    await expect(
      loadYouTubeCaptionTranscript(document, fetchImpl, new AbortController().signal),
    ).resolves.toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
