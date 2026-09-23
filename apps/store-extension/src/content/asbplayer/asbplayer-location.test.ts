import { describe, expect, it } from "vitest";

import { parseAsbplayerPlaybackContext } from "./asbplayer-location.js";

import { TEST_MEDIA, TEST_URL } from "./asbplayer.test-support.js";

describe("official asbplayer playback context", () => {
  it("accepts a top-level official local-media player", () => {
    expect(parseAsbplayerPlaybackContext(TEST_URL, "top-level")).toEqual({
      channel: "test-channel",
      mediaUrl: TEST_MEDIA,
    });
  });

  it.each([
    TEST_URL.replace("https://app", "http://app"),
    TEST_URL.replace("app.asbplayer.dev/?", "app.asbplayer.dev:444/?"),
    TEST_URL.replace("app.asbplayer.dev/?", "app.asbplayer.dev.evil.test/?"),
    TEST_URL.replace("app.asbplayer.dev/?", "user@app.asbplayer.dev/?"),
    TEST_URL.replace("app.asbplayer.dev/?", "app.asbplayer.dev/player?"),
    `${TEST_URL}&channel=second`,
    `${TEST_URL}&video=${encodeURIComponent(TEST_MEDIA)}`,
    `${TEST_URL}&%63hannel=second`,
    `${TEST_URL}#player`,
    TEST_URL.replace("test-channel", ""),
    TEST_URL.replace("test-channel", "a".repeat(129)),
    TEST_URL.replace("test-channel", "credential%2Fpath"),
    TEST_URL.replace(
      encodeURIComponent(TEST_MEDIA),
      encodeURIComponent("blob:https://other.test/id"),
    ),
    TEST_URL.replace(
      encodeURIComponent(TEST_MEDIA),
      encodeURIComponent("https://app.asbplayer.dev/video.mp4"),
    ),
    TEST_URL.replace(
      encodeURIComponent(TEST_MEDIA),
      encodeURIComponent(`${TEST_MEDIA}?name=private`),
    ),
    "https://app.asbplayer.dev/",
    "invalid",
  ])("rejects invalid or ambiguous context %#", (url) => {
    expect(parseAsbplayerPlaybackContext(url, "top-level")).toBeNull();
  });

  it("accepts the official same-origin iframe used by the default player", () => {
    expect(parseAsbplayerPlaybackContext(TEST_URL, "official-frame")).toEqual({
      channel: "test-channel",
      mediaUrl: TEST_MEDIA,
    });
  });

  it("rejects cross-origin embedded frames", () => {
    expect(parseAsbplayerPlaybackContext(TEST_URL, "untrusted-frame")).toBeNull();
  });
});
