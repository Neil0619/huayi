import { afterEach, describe, expect, it, vi } from "vitest";

import { YOUTUBE_SOURCE_PROBE_RESPONSE } from "./youtube-bridge-contract.js";
import { videoIdFromUrl, YouTubeCaptionBridgeClient } from "./youtube-caption-bridge-client.js";
import {
  dispatchBridgeResponse,
  failureResponse as failure,
  successResponse as success,
} from "./youtube-caption-bridge-client.test-support.js";

afterEach(() => {
  vi.useRealTimers();
  document.body.textContent = "";
  history.replaceState(null, "", "/");
});

describe("YouTubeCaptionBridgeClient", () => {
  it("posts only the bounded bridge request and accepts a correlated exact response", async () => {
    history.replaceState(null, "", "/watch?v=abc");
    const postMessage = vi.spyOn(window, "postMessage");
    const client = new YouTubeCaptionBridgeClient({
      createRequestId: () => "request-1",
      document,
      getCurrentVideoId: () => "abc",
      validatePlayerState: () => true,
    });

    const pending = client.capture({ expectedVideoId: "abc", generation: 1, target: "source" });
    dispatchBridgeResponse(success());

    await expect(pending).resolves.toMatchObject({
      cues: [{ endMs: 1_000, startMs: 0, text: "Hello." }],
    });
    expect(postMessage).toHaveBeenCalledWith(
      {
        expectedVideoId: "abc",
        generation: 1,
        requestId: "request-1",
        target: "source",
        type: "huayi:youtube-caption-request",
      },
      window.location.origin,
    );
    client.destroy();
  });

  it("verifies the live source identity through a bounded read-only probe", async () => {
    history.replaceState(null, "", "/watch?v=abc");
    const postMessage = vi.spyOn(window, "postMessage");
    const requestIds = ["request-1", "probe-1"];
    const client = new YouTubeCaptionBridgeClient({
      createRequestId: () => requestIds.shift() ?? "unexpected",
      document,
      getCurrentVideoId: () => "abc",
      validatePlayerState: () => true,
    });
    const source = client.capture({ expectedVideoId: "abc", generation: 1, target: "source" });
    dispatchBridgeResponse(success());
    await source;

    const probe = client.probeSource({ expectedVideoId: "abc", generation: 1 });
    dispatchBridgeResponse({
      type: YOUTUBE_SOURCE_PROBE_RESPONSE,
      requestId: "probe-1",
      generation: 1,
      expectedVideoId: "abc",
      status: "same-source",
    });

    await expect(probe).resolves.toBe("same-source");
    expect(postMessage).toHaveBeenLastCalledWith(
      {
        type: "huayi:youtube-source-probe-request",
        requestId: "probe-1",
        generation: 1,
        expectedVideoId: "abc",
      },
      window.location.origin,
    );
    client.destroy();
  });

  it.each([
    ["unknown field", { extra: true }],
    ["cross-video", { videoId: "other" }],
    ["stale generation", { generation: 2 }],
    ["wrong translation fingerprint", { target: "translated" }],
  ])("rejects %s responses", async (_label, overrides) => {
    history.replaceState(null, "", "/watch?v=abc");
    const client = new YouTubeCaptionBridgeClient({
      createRequestId: () => "request-1",
      document,
      getCurrentVideoId: () => "abc",
      validatePlayerState: () => true,
    });
    const pending = client.capture({ expectedVideoId: "abc", generation: 1, target: "source" });
    dispatchBridgeResponse(success(overrides));
    client.destroy();
    await expect(pending).resolves.toBeNull();
  });

  it("revalidates the exact watch URL and current player state after receiving data", async () => {
    history.replaceState(null, "", "/watch?v=abc");
    const validatePlayerState = vi.fn(() => false);
    const client = new YouTubeCaptionBridgeClient({
      createRequestId: () => "request-1",
      document,
      getCurrentVideoId: () => "abc",
      validatePlayerState,
    });
    const pending = client.capture({ expectedVideoId: "abc", generation: 1, target: "source" });
    window.dispatchEvent(
      new MessageEvent("message", {
        data: success(),
        origin: window.location.origin,
        source: window,
      }),
    );
    await expect(pending).resolves.toBeNull();
    expect(validatePlayerState).toHaveBeenCalledWith(
      expect.objectContaining({ languageCode: "en" }),
      "source",
    );
    client.destroy();
  });

  it("waits for a bridge-driven caption track to restore before accepting the response", async () => {
    history.replaceState(null, "", "/watch?v=abc");
    let validationAttempts = 0;
    const client = new YouTubeCaptionBridgeClient({
      createRequestId: () => "request-1",
      document,
      getCurrentVideoId: () => "abc",
      validatePlayerState: () => (validationAttempts++ === 0 ? "retry" : true),
    });
    const pending = client.capture({ expectedVideoId: "abc", generation: 1, target: "source" });
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
    expect(validationAttempts).toBe(2);
    client.destroy();
  });

  it("requires a stable restored source window before accepting a translated response", async () => {
    vi.useFakeTimers();
    history.replaceState(null, "", "/watch?v=abc");
    let request = "request-1";
    let translatedState: boolean | "retry" = true;
    const client = new YouTubeCaptionBridgeClient({
      createRequestId: () => request,
      document,
      getCurrentVideoId: () => "abc",
      validatePlayerState: (_track, target) => (target === "source" ? true : translatedState),
    });
    const source = client.capture({ expectedVideoId: "abc", generation: 1, target: "source" });
    window.dispatchEvent(
      new MessageEvent("message", {
        data: success(),
        origin: window.location.origin,
        source: window,
      }),
    );
    await expect(source).resolves.not.toBeNull();

    request = "request-2";
    const translated = client.capture({
      expectedVideoId: "abc",
      generation: 1,
      target: "translated",
    });
    dispatchBridgeResponse(
      success({
        fingerprint: {
          fmt: "json3",
          host: "www.youtube.com",
          lang: "en",
          path: "/api/timedtext",
          tlang: "zh-Hans",
          v: "abc",
        },
        requestId: "request-2",
        target: "translated",
      }),
    );
    let settled = false;
    void translated.then(() => {
      settled = true;
    });

    await vi.advanceTimersByTimeAsync(300);
    expect(settled).toBe(false);
    translatedState = "retry";
    await vi.advanceTimersByTimeAsync(100);
    expect(settled).toBe(false);
    translatedState = true;
    await vi.advanceTimersByTimeAsync(800);
    await expect(translated).resolves.not.toBeNull();
    client.destroy();
  });

  it.each(["timeout", "invalid-response"] as const)(
    "waits for the source cue to restore after a translated capture %s",
    async (error) => {
      vi.useFakeTimers();
      history.replaceState(null, "", "/watch?v=abc");
      let request = "request-1";
      let translatedValidationAttempts = 0;
      const validatePlayerState = vi.fn(
        (_track: { languageCode: string }, target: "source" | "translated") =>
          target === "source" || translatedValidationAttempts++ > 0 ? true : "retry",
      );
      const client = new YouTubeCaptionBridgeClient({
        createRequestId: () => request,
        document,
        getCurrentVideoId: () => "abc",
        validatePlayerState,
      });
      const source = client.capture({ expectedVideoId: "abc", generation: 1, target: "source" });
      window.dispatchEvent(
        new MessageEvent("message", {
          data: success(),
          origin: window.location.origin,
          source: window,
        }),
      );
      await expect(source).resolves.not.toBeNull();

      request = "request-2";
      const translated = client.capture({
        expectedVideoId: "abc",
        generation: 1,
        target: "translated",
      });
      window.dispatchEvent(
        new MessageEvent("message", {
          data: failure({ error }),
          origin: window.location.origin,
          source: window,
        }),
      );

      await vi.advanceTimersByTimeAsync(800);
      await expect(translated).resolves.toBeNull();
      expect(translatedValidationAttempts).toBeGreaterThanOrEqual(16);
      client.destroy();
    },
  );

  it("never extends the original request deadline while waiting for restoration", async () => {
    vi.useFakeTimers();
    history.replaceState(null, "", "/watch?v=abc");
    let request = "request-1";
    const client = new YouTubeCaptionBridgeClient({
      createRequestId: () => request,
      document,
      getCurrentVideoId: () => "abc",
      timeoutMs: 200,
      validatePlayerState: (_track, target) => (target === "source" ? true : "retry"),
    });
    const source = client.capture({ expectedVideoId: "abc", generation: 1, target: "source" });
    window.dispatchEvent(
      new MessageEvent("message", {
        data: success(),
        origin: window.location.origin,
        source: window,
      }),
    );
    await expect(source).resolves.not.toBeNull();

    request = "request-2";
    const translated = client.capture({
      expectedVideoId: "abc",
      generation: 1,
      target: "translated",
    });
    window.dispatchEvent(
      new MessageEvent("message", {
        data: failure(),
        origin: window.location.origin,
        source: window,
      }),
    );
    let settled = false;
    void translated.then(() => {
      settled = true;
    });

    await vi.advanceTimersByTimeAsync(199);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(translated).resolves.toBeNull();
    expect(settled).toBe(true);
    client.destroy();
  });

  it("does not wait through an unavailable failure that can represent a user track change", async () => {
    history.replaceState(null, "", "/watch?v=abc");
    let request = "request-1";
    let translatedValidationAttempts = 0;
    const client = new YouTubeCaptionBridgeClient({
      createRequestId: () => request,
      document,
      getCurrentVideoId: () => "abc",
      validatePlayerState: (_track, target) => {
        if (target === "source") return true;
        translatedValidationAttempts += 1;
        return "retry";
      },
    });
    const source = client.capture({ expectedVideoId: "abc", generation: 1, target: "source" });
    window.dispatchEvent(
      new MessageEvent("message", {
        data: success(),
        origin: window.location.origin,
        source: window,
      }),
    );
    await expect(source).resolves.not.toBeNull();

    request = "request-2";
    const translated = client.capture({
      expectedVideoId: "abc",
      generation: 1,
      target: "translated",
    });
    window.dispatchEvent(
      new MessageEvent("message", {
        data: failure({ error: "unavailable" }),
        origin: window.location.origin,
        source: window,
      }),
    );

    await expect(translated).resolves.toBeNull();
    expect(translatedValidationAttempts).toBe(0);
    client.destroy();
  });

  it("requires translated results to use the captured source track", async () => {
    history.replaceState(null, "", "/watch?v=abc");
    let request = "request-1";
    const client = new YouTubeCaptionBridgeClient({
      createRequestId: () => request,
      document,
      getCurrentVideoId: () => "abc",
      validatePlayerState: () => true,
    });
    const source = client.capture({ expectedVideoId: "abc", generation: 1, target: "source" });
    window.dispatchEvent(
      new MessageEvent("message", {
        data: success(),
        origin: window.location.origin,
        source: window,
      }),
    );
    await expect(source).resolves.not.toBeNull();

    request = "request-2";
    const translated = client.capture({
      expectedVideoId: "abc",
      generation: 1,
      target: "translated",
    });
    window.dispatchEvent(
      new MessageEvent("message", {
        data: success({
          fingerprint: {
            fmt: "json3",
            host: "www.youtube.com",
            kind: "asr",
            lang: "en",
            path: "/api/timedtext",
            tlang: "zh-Hans",
            v: "abc",
          },
          requestId: "request-2",
          target: "translated",
          track: { kind: "asr", languageCode: "en" },
        }),
        origin: window.location.origin,
        source: window,
      }),
    );
    await expect(translated).resolves.toBeNull();
    client.destroy();
  });

  it("accepts only an exact HTTPS YouTube watch URL", () => {
    expect(videoIdFromUrl("https://www.youtube.com/watch?v=abc")).toBe("abc");
    expect(videoIdFromUrl("https://m.youtube.com/watch?v=abc")).toBe("abc");
    expect(videoIdFromUrl("http://www.youtube.com/watch?v=abc")).toBeNull();
    expect(videoIdFromUrl("https://www.youtube.com/shorts/abc")).toBeNull();
    expect(videoIdFromUrl("https://example.com/watch?v=abc")).toBeNull();
  });

  it("does not post an outbound request with an overlong video identifier", async () => {
    const videoId = "v".repeat(129);
    history.replaceState(null, "", `/watch?v=${videoId}`);
    const postMessage = vi.spyOn(window, "postMessage");
    const client = new YouTubeCaptionBridgeClient({
      createRequestId: () => "request-1",
      document,
      getCurrentVideoId: () => videoId,
      validatePlayerState: () => true,
    });

    await expect(
      client.capture({ expectedVideoId: videoId, generation: 1, target: "source" }),
    ).resolves.toBeNull();
    expect(postMessage).not.toHaveBeenCalled();
    client.destroy();
  });
});
