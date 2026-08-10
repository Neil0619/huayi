import { describe, expect, it, vi } from "vitest";

import { createYouTubeBridge } from "./youtube-bridge-core.js";
import {
  YOUTUBE_BRIDGE_RESPONSE,
  YOUTUBE_SOURCE_PROBE_RESPONSE,
} from "./youtube-bridge-contract.js";
import {
  createBridgeCoreFixture as createFixture,
  eventually,
  request,
  sourceBody,
  sourceProbe,
  translatedBody,
} from "./youtube-bridge-core.test-support.js";

function requiredUrl(values: string[], index: number): URL {
  const value = values[index];
  expect(value).toBeDefined();
  return new URL(value ?? "https://invalid.test");
}

describe("YouTube MAIN-world bridge", () => {
  it("captures only the current active English source track and restores exact state", async () => {
    const fixture = createFixture();
    fixture.dispatch(request("source"));
    await eventually();

    expect(fixture.responses).toEqual([
      {
        type: YOUTUBE_BRIDGE_RESPONSE,
        requestId: "source-1",
        generation: 1,
        expectedVideoId: "video-1",
        target: "source",
        ok: true,
        track: { languageCode: "en", kind: "asr" },
        videoId: "video-1",
        fingerprint: {
          host: "www.youtube.com",
          path: "/api/timedtext",
          v: "video-1",
          lang: "en",
          kind: "asr",
          fmt: "json3",
        },
        body: sourceBody,
      },
    ]);
    expect(fixture.state()).toEqual({ activeTrack: fixture.originalTrack, moduleLoaded: true });
    expect(fixture.env.fetch).toBe(fixture.originalFetch);
    fixture.bridge.destroy();
  });

  it("resolves omitted active-track kind only from the matching live player response", async () => {
    const fixture = createFixture({ omitActiveKind: true });
    fixture.dispatch(request("source"));
    await eventually();

    expect(fixture.responses[0]).toMatchObject({
      ok: true,
      track: { languageCode: "en", kind: "asr" },
      fingerprint: { lang: "en", kind: "asr" },
    });
    expect(fixture.state().activeTrack).toStrictEqual(fixture.originalTrack);
    fixture.bridge.destroy();
  });

  it("normalizes the empty kind and snake-case vss identity used by the live player", async () => {
    const fixture = createFixture({ realPlayerTrackShape: true });
    fixture.dispatch(request("source"));
    await eventually();

    expect(fixture.responses[0]).toMatchObject({
      ok: true,
      track: { languageCode: "en" },
      fingerprint: { lang: "en", fmt: "json3" },
    });
    expect(fixture.responses[0]).not.toHaveProperty("track.kind");
    expect(fixture.responses[0]).not.toHaveProperty("fingerprint.kind");
    expect(fixture.state()).toEqual({ activeTrack: fixture.originalTrack, moduleLoaded: true });
    fixture.bridge.destroy();
  });

  it("uses a verified prior source capture before requesting fixed zh-Hans", async () => {
    const fixture = createFixture({ suppressRepeatedSourceRequests: true });
    fixture.dispatch(request("source"));
    await eventually();
    fixture.dispatch(request("translated"));
    await eventually();

    const urls = vi.mocked(fixture.originalFetch).mock.calls.map(([input]) => input.toString());
    expect(urls).toHaveLength(2);
    expect(requiredUrl(urls, 0).searchParams.get("tlang")).toBeNull();
    expect(requiredUrl(urls, 1).searchParams.get("tlang")).toBe("zh-Hans");
    expect(fixture.responses[1]).toMatchObject({
      ok: true,
      target: "translated",
      fingerprint: { tlang: "zh-Hans", fmt: "json3" },
      body: translatedBody,
    });
    expect(fixture.responseTracks[1]).toStrictEqual(fixture.originalTrack);
    expect(fixture.state().activeTrack).toStrictEqual(fixture.originalTrack);
    fixture.bridge.destroy();
  });

  it("probes the live active track against the verified source without another request", async () => {
    const fixture = createFixture();
    fixture.dispatch(request("source"));
    await eventually();
    const requestsAfterCapture = fixture.originalFetch.mock.calls.length;
    const unloadsAfterCapture = vi.mocked(fixture.player.unloadModule).mock.calls.length;
    const loadsAfterCapture = vi.mocked(fixture.player.loadModule).mock.calls.length;
    const optionsAfterCapture = vi.mocked(fixture.player.setOption).mock.calls.length;

    fixture.dispatch(sourceProbe("probe-same"));
    await eventually();
    fixture.setActiveTrack({ kind: "asr", languageCode: "en", vssId: ".en.other" });
    fixture.dispatch(sourceProbe("probe-other-english"));
    await eventually();
    fixture.setActiveTrack({ languageCode: "fr", vssId: ".fr" });
    fixture.dispatch(sourceProbe("probe-changed"));
    await eventually();

    expect(fixture.probeResponses).toEqual([
      {
        type: YOUTUBE_SOURCE_PROBE_RESPONSE,
        requestId: "probe-same",
        generation: 1,
        expectedVideoId: "video-1",
        status: "same-source",
      },
      {
        type: YOUTUBE_SOURCE_PROBE_RESPONSE,
        requestId: "probe-other-english",
        generation: 1,
        expectedVideoId: "video-1",
        status: "different-english",
      },
      {
        type: YOUTUBE_SOURCE_PROBE_RESPONSE,
        requestId: "probe-changed",
        generation: 1,
        expectedVideoId: "video-1",
        status: "non-english",
      },
    ]);
    expect(fixture.originalFetch).toHaveBeenCalledTimes(requestsAfterCapture);
    expect(fixture.player.unloadModule).toHaveBeenCalledTimes(unloadsAfterCapture);
    expect(fixture.player.loadModule).toHaveBeenCalledTimes(loadsAfterCapture);
    expect(fixture.player.setOption).toHaveBeenCalledTimes(optionsAfterCapture);
    fixture.bridge.destroy();
  });

  it("restores and verifies against value snapshots when the player mutates its track object", async () => {
    const fixture = createFixture({ mutateTrackInPlace: true });
    fixture.dispatch(request("source"));
    await eventually();
    fixture.dispatch(request("translated"));
    await eventually();

    expect(fixture.responses).toHaveLength(2);
    expect(fixture.responses[1]).toMatchObject({ ok: true, target: "translated" });
    expect(fixture.state()).toEqual({
      activeTrack: { kind: "asr", languageCode: "en", vssId: ".en" },
      moduleLoaded: true,
    });
    fixture.bridge.destroy();
  });

  it("rejects a translated capture without a verified source capture in the same generation", async () => {
    const fixture = createFixture();

    fixture.dispatch(request("translated"));
    await eventually();

    expect(fixture.responses[0]).toMatchObject({
      error: "unavailable",
      ok: false,
      target: "translated",
    });
    expect(fixture.originalFetch).not.toHaveBeenCalled();
    fixture.bridge.destroy();
  });

  it("rejects disabled captions, non-English tracks, foreign sources, and extra fields", async () => {
    const disabled = createFixture({ cc: false });
    disabled.dispatch(request("source"));
    const nonEnglish = createFixture({ languageCode: "fr" });
    nonEnglish.dispatch(request("source"));
    nonEnglish.dispatch({ ...request("source"), url: "https://example.test" });
    const foreign = createFixture();
    const event = new MessageEvent("message", { data: request("source") });
    // The bridge itself verifies that source is its own window object.
    (foreign.bridge as { handleMessage(event: MessageEvent): void }).handleMessage(event);
    await eventually();

    expect(disabled.responses[0]).toMatchObject({ ok: false, error: "unavailable" });
    expect(nonEnglish.responses).toHaveLength(1);
    expect(nonEnglish.responses[0]).toMatchObject({ ok: false, error: "unavailable" });
    expect(foreign.responses).toHaveLength(0);
    disabled.bridge.destroy();
    nonEnglish.bridge.destroy();
    foreign.bridge.destroy();
  });

  it("serializes requests and drops stale generations", async () => {
    const fixture = createFixture();
    fixture.dispatch(request("source", 2));
    fixture.dispatch(request("source", 1));
    await eventually();

    expect(fixture.responses).toHaveLength(2);
    expect(fixture.responses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ generation: 2, ok: true }),
        expect.objectContaining({ generation: 1, ok: false, error: "stale" }),
      ]),
    );
    fixture.bridge.destroy();
  });

  it("does not clobber a newer fetch wrapper during restoration", async () => {
    const fixture = createFixture();
    const newerFetch = vi.fn(fixture.originalFetch);
    const setOption = fixture.player.setOption;
    fixture.player.setOption = (...args) => {
      setOption(...args);
      fixture.env.fetch = newerFetch;
    };
    fixture.dispatch(request("source"));
    await eventually();

    expect(fixture.env.fetch).toBe(newerFetch);
    fixture.bridge.destroy();
  });

  it("makes a chained Huayi fetch wrapper inert after capture", async () => {
    const fixture = createFixture();
    const setOption = fixture.player.setOption;
    fixture.player.setOption = (...args) => {
      const huayiFetch = fixture.env.fetch as typeof fetch;
      setOption(...args);
      const chainedFetch: typeof fetch = (input, init) => huayiFetch(input, init);
      fixture.env.fetch = vi.fn(chainedFetch);
    };
    fixture.dispatch(request("source"));
    await eventually();

    const clone = vi.spyOn(Response.prototype, "clone");
    await fixture.env.fetch("https://www.youtube.com/not-timedtext");
    expect(clone).not.toHaveBeenCalled();
    fixture.bridge.destroy();
  });

  it.each([
    { name: "omitted", value: false as const },
    { name: "maximum-length", value: "x".repeat(4_096) },
  ])("accepts a matching player request with a $name PoToken", async ({ value: poToken }) => {
    const fixture = createFixture({ poToken });
    fixture.dispatch(request("source"));
    await eventually();

    expect(fixture.responses[0]).toMatchObject({ ok: true, body: sourceBody });
    fixture.bridge.destroy();
  });

  it.each([
    { name: "empty", value: "" },
    { name: "oversized", value: "x".repeat(4_097) },
  ])("rejects a present $name PoToken", async ({ value: poToken }) => {
    const fixture = createFixture({ poToken });
    fixture.bridge.destroy();
    const bridge = createYouTubeBridge(fixture.env, () => fixture.player, { timeoutMs: 5 });
    fixture.dispatch(request("source"));
    await new Promise((resolve) => setTimeout(resolve, 10));
    await eventually();

    expect(fixture.responses[0]).toMatchObject({ ok: false, error: "timeout" });
    bridge.destroy();
  });

  it("does not restore over a newer user-selected track", async () => {
    const fixture = createFixture({ transport: "none" });
    fixture.bridge.destroy();
    const bridge = createYouTubeBridge(fixture.env, () => fixture.player, { timeoutMs: 5 });
    const userTrack = { kind: "asr", languageCode: "en", vssId: ".en-user" };
    fixture.dispatch(request("source"));
    await Promise.resolve();
    fixture.setActiveTrack(userTrack);
    await new Promise((resolve) => setTimeout(resolve, 10));
    await eventually();

    expect(fixture.state().activeTrack).toBe(userTrack);
    bridge.destroy();
  });

  it("fails closed when the user changes the active track during capture", async () => {
    const fixture = createFixture();
    const userTrack = { kind: "asr", languageCode: "en", vssId: ".en-user" };
    const setOption = fixture.player.setOption;
    fixture.player.setOption = (...args) => {
      setOption(...args);
      fixture.setActiveTrack(userTrack);
    };

    fixture.dispatch(request("source"));
    await eventually();

    expect(fixture.responses[0]).toMatchObject({ ok: false, error: "unavailable" });
    expect(fixture.state().activeTrack).toBe(userTrack);
    fixture.bridge.destroy();
  });

  it("captures XMLHttpRequest responses and restores its prototype wrappers", async () => {
    const fixture = createFixture({ transport: "xhr" });
    const originalOpen = fixture.env.XMLHttpRequest.prototype.open;
    const originalSend = fixture.env.XMLHttpRequest.prototype.send;
    fixture.dispatch(request("source"));
    await eventually();

    expect(fixture.responses[0]).toMatchObject({ ok: true, body: sourceBody });
    expect(fixture.env.XMLHttpRequest.prototype.open).toBe(originalOpen);
    expect(fixture.env.XMLHttpRequest.prototype.send).toBe(originalSend);
    fixture.bridge.destroy();
  });

  it("times out a missing matching request and restores the player", async () => {
    const fixture = createFixture({ transport: "none" });
    fixture.bridge.destroy();
    const bridge = createYouTubeBridge(fixture.env, () => fixture.player, { timeoutMs: 5 });
    fixture.dispatch(request("source"));
    await new Promise((resolve) => setTimeout(resolve, 10));
    await eventually();

    expect(fixture.responses[0]).toMatchObject({ ok: false, error: "timeout" });
    expect(fixture.state()).toEqual({ activeTrack: fixture.originalTrack, moduleLoaded: true });
    bridge.destroy();
  });

  it("cancels immediately on navigation and restores wrappers and player state", async () => {
    const fixture = createFixture({ transport: "none" });
    fixture.dispatch(request("source"));
    await Promise.resolve();
    fixture.navigate();
    await eventually();

    expect(fixture.responses[0]).toMatchObject({ ok: false, error: "stale" });
    expect(fixture.env.fetch).toBe(fixture.originalFetch);
    expect(fixture.state()).toEqual({ activeTrack: fixture.originalTrack, moduleLoaded: true });
    fixture.bridge.destroy();
  });
});
