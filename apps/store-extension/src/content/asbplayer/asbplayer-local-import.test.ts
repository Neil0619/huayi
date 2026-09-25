import { describe, expect, it } from "vitest";
import { parseLocalImport, acceptLocalFiles } from "./asbplayer-local-import.js";
import { parseAsbplayerPlaybackContext } from "./asbplayer-location.js";

const origin = "http://127.0.0.1:23456";
const nonce = "0123456789abcdef0123456789abcdef";
const hash = `#seen-said-open=${encodeURIComponent(JSON.stringify({ origin, nonce }))}`;
describe("explicit local media import", () => {
  it("recognizes only the selected loopback streaming shape in an official player", () => {
    const mediaUrl = `${origin}/stream/${"c".repeat(64)}`;
    const href = `https://app.asbplayer.dev/?video=${encodeURIComponent(mediaUrl)}&channel=local`;
    expect(parseAsbplayerPlaybackContext(href, "official-frame")).toEqual({
      channel: "local",
      mediaUrl,
    });
    expect(parseAsbplayerPlaybackContext(href, "untrusted-frame")).toBeNull();
    expect(
      parseAsbplayerPlaybackContext(href.replace("127.0.0.1", "evil.test"), "top-level"),
    ).toBeNull();
  });
  it("accepts only an exact loopback origin and a bounded nonce", () => {
    expect(parseLocalImport(hash)).toEqual({ origin, nonce });
    for (const bad of [
      "https://example.test",
      "http://localhost:23456",
      `${origin}/path`,
      "http://127.0.0.1:23456@evil.test",
      "http://127.0.0.2:23456",
    ]) {
      expect(
        parseLocalImport(
          `#seen-said-open=${encodeURIComponent(JSON.stringify({ origin: bad, nonce }))}`,
        ),
      ).toBeNull();
    }
    expect(parseLocalImport("#seen-said-open=invalid")).toBeNull();
  });
  it("rejects wrong source/origin/nonce, fake files and replay while preserving real File payloads", () => {
    const source = {};
    const files = [
      new File(["video"], "episode.mp4", { type: "video/mp4" }),
      new File(["sub"], "en.srt", { type: "text/plain" }),
    ];
    const data = { type: "seen-said/local-files", nonce, files };
    const accept = acceptLocalFiles({ origin, nonce }, source);
    expect(accept({ origin, source: {}, data })).toBeNull();
    expect(accept({ origin: "https://evil.test", source, data })).toBeNull();
    expect(accept({ origin, source, data: { ...data, nonce: "bad" } })).toBeNull();
    expect(
      accept({ origin, source, data: { ...data, files: [{ name: "a.mp4", size: 1 }] } }),
    ).toBeNull();
    expect(accept({ origin, source, data })).toEqual(files);
    expect(accept({ origin, source, data })).toBeNull();
  });
  it("rejects unsupported subtitle extensions and multiple video payloads", () => {
    const source = {};
    for (const files of [
      [new File(["x"], "a.html")],
      [new File(["x"], "a.mp4"), new File(["x"], "b.mp4")],
    ]) {
      expect(
        acceptLocalFiles(
          { origin, nonce },
          source,
        )({ origin, source, data: { type: "seen-said/local-files", nonce, files } }),
      ).toBeNull();
    }
  });
});
