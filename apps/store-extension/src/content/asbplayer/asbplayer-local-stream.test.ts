import { afterEach, describe, expect, it, vi } from "vitest";
import {
  acceptLocalStream,
  installStreamMediaCors,
  mapStreamFile,
} from "./asbplayer-local-stream.js";
import { parseLocalStreamUrl } from "../../asbplayer-stream-url.js";

const origin = "http://127.0.0.1:23456";
const url = `${origin}/stream/${"a".repeat(64)}`;
const nonce = "b".repeat(32);
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("explicit local streaming import", () => {
  it("keeps selected streaming video and previews readable for learning capture without changing other media", async () => {
    document.body.innerHTML = `<video id="selected" src="${url}"></video><video id="other" src="https://example.test/other.mp4"></video>`;
    const stop = installStreamMediaCors(document, url);
    expect(document.querySelector<HTMLVideoElement>("#selected")?.crossOrigin).toBe("anonymous");
    expect(document.querySelector<HTMLVideoElement>("#other")?.crossOrigin).toBeNull();
    const preview = document.createElement("video");
    document.body.append(preview);
    preview.src = url;
    await vi.waitFor(() => expect(preview.crossOrigin).toBe("anonymous"));
    stop();
    document.body.replaceChildren();
  });
  it("shows recoverable local-playback guidance after an error and clears it on playback readiness", () => {
    document.body.innerHTML = `<video preload="auto" src="${url}"></video>`;
    const stop = installStreamMediaCors(document, url);
    const video = document.querySelector("video");
    if (!video) throw new Error("missing fixture video");
    video.dispatchEvent(new Event("error"));
    const panel = document.querySelector<HTMLElement>("[data-huayi-local-stream-error]");
    expect(panel?.textContent).toContain("本机服务");
    expect(panel?.hidden).toBe(false);
    video.dispatchEvent(new Event("loadeddata"));
    expect(panel?.hidden).toBe(true);
    stop();
    document.body.replaceChildren();
  });
  it("accepts only one pinned source/nonce and validated subtitles and stream address", () => {
    const source = {};
    const files = [new File(["subtitle"], "en.srt", { type: "text/plain" })];
    const data = {
      type: "seen-said/local-stream",
      nonce,
      files,
      video: { url, name: "episode.mp4", size: 900_000_000 },
    };
    const accept = acceptLocalStream({ origin, nonce }, source);
    expect(accept({ origin, source: {}, data })).toBeNull();
    expect(accept({ origin: "https://evil.test", source, data })).toBeNull();
    expect(accept({ origin, source, data: { ...data, nonce: "wrong" } })).toBeNull();
    for (const address of [
      "http://127.0.0.1:9999/stream/" + "a".repeat(64),
      url + "?path=private",
      url + "#x",
      url.replace("127.0.0.1", "evil.test"),
      url.replace("/stream/", "/file/"),
      url.replace("127.0.0.1", "user@127.0.0.1"),
    ])
      expect(
        accept({ origin, source, data: { ...data, video: { ...data.video, url: address } } }),
      ).toBeNull();
    expect(accept({ origin, source, data: { ...data, files: [{ name: "fake.srt" }] } })).toBeNull();
    expect(accept({ origin, source, data })).toEqual({ video: data.video, files });
    expect(accept({ origin, source, data })).toBeNull();
    expect(parseLocalStreamUrl(url)).toBe(url);
    expect(parseLocalStreamUrl(url.replace(":23456", ":80"))).toBeNull();
  });

  it("maps only the exact selected File once and restores the normal Blob API", () => {
    const original = () => "blob:ordinary";
    vi.stubGlobal("URL", { createObjectURL: original });
    const selected = new File(["x"], "episode.mp4");
    const sameName = new File(["x"], "episode.mp4");
    const dispose = mapStreamFile(selected, url);
    expect(URL.createObjectURL(sameName)).toBe("blob:ordinary");
    expect(URL.createObjectURL(new Blob(["ordinary"]))).toBe("blob:ordinary");
    expect(URL.createObjectURL(selected)).toBe(url);
    expect(URL.createObjectURL).toBe(original);
    expect(URL.createObjectURL(selected)).toBe("blob:ordinary");
    dispose();
  });

  it("restores an unconsumed adapter on expiry and does not undo another owner's replacement", () => {
    vi.useFakeTimers();
    const original = () => "blob:ordinary";
    vi.stubGlobal("URL", { createObjectURL: original });
    const file = new File(["x"], "episode.mp4");
    mapStreamFile(file, url);
    vi.advanceTimersByTime(10_000);
    expect(URL.createObjectURL).toBe(original);
    const dispose = mapStreamFile(file, url);
    const other = () => "blob:other";
    URL.createObjectURL = other;
    dispose();
    expect(URL.createObjectURL(file)).toBe("blob:other");
  });
});
