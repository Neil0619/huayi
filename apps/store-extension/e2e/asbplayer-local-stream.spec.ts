import { expect, test } from "@playwright/test";
import { mkdtemp, copyFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startMediaOpener } from "../../../scripts/asbplayer-opener-server.mjs";
import { createAsbplayerPackageFixture } from "./support/asbplayer-package-fixture.js";

test.use({ screenshot: "off", trace: "off" });
test("denied local access is recoverable; granted streams remain playable and capture-safe", async () => {
  test.setTimeout(60000);
  const fixture = await createAsbplayerPackageFixture();
  const directory = await mkdtemp(join(tmpdir(), "seen-said-stream-permission-"));
  const video = join(directory, "video.mp4");
  // Synthetic three-second H.264/AAC color+sine fixture; no user media or external model.
  await copyFile(new URL("./fixtures/asbplayer-stream.mp4", import.meta.url), video);
  const opener = await startMediaOpener({
    pickFile: async () => video,
    prepare: async () => ({
      files: [{ path: video, name: "video.mp4", kind: "video", type: "video/mp4", size: 1 }],
      plan: { imageSubtitleCount: 0 },
    }),
    sidecars: async () => [],
  });
  try {
    await fixture.context.route(`${opener.origin}/**`, (route) => route.continue());
    const headers = {
      Authorization: `Bearer ${opener.token}`,
      Origin: opener.origin,
      "Content-Type": "application/json",
    };
    await fetch(`${opener.origin}/api/open`, { method: "POST", headers, body: "{}" });
    let streamUrl = "";
    await expect
      .poll(async () => {
        const state = await (await fetch(`${opener.origin}/api/state`, { headers })).json();
        streamUrl = state.files[0]?.streamUrl ?? "";
        return state.status;
      })
      .toBe("ready");
    // Explicitly deny site permissions, then exercise the same real browser after granting.
    await fixture.context.grantPermissions([], { origin: "https://app.asbplayer.dev" });
    const page = await fixture.context.newPage();
    await page.goto(
      `https://app.asbplayer.dev/?video=${encodeURIComponent(streamUrl)}&channel=stream-permission`,
    );
    const feedback = page.locator("[data-huayi-local-stream-error]");
    await expect(feedback).toBeVisible();
    await expect(feedback).toContainText("本机服务");
    await fixture.context.grantPermissions(["local-network-access"], {
      origin: "https://app.asbplayer.dev",
    });
    await page.getByRole("button", { name: "重试本机播放", exact: true }).click();
    const player = page.locator("video[preload=auto]");
    await expect
      .poll(() => player.evaluate((video: HTMLVideoElement) => video.readyState))
      .toBeGreaterThanOrEqual(2);
    await expect(feedback).toBeHidden();
    await expect(page.locator("[data-huayi-store-asbplayer]")).toHaveAttribute(
      "data-state",
      "waiting-tracks",
    );
    await player.evaluate((video: HTMLVideoElement) => {
      video.muted = true;
      return video.play();
    });
    await expect
      .poll(() => player.evaluate((video: HTMLVideoElement) => video.currentTime))
      .toBeGreaterThan(0.3);
    const capture = await player.evaluate((video) => {
      const media = video as HTMLVideoElement & {
        captureStream(): MediaStream;
        webkitAudioDecodedByteCount: number;
      };
      const stream = media.captureStream();
      const tracks = stream.getAudioTracks().length;
      stream.getTracks().forEach((track) => track.stop());
      const canvas = document.createElement("canvas");
      canvas.width = 8;
      canvas.height = 8;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas unavailable");
      context.drawImage(media, 0, 0, 8, 8);
      return {
        tracks,
        bytes: media.webkitAudioDecodedByteCount,
        readable: canvas.toDataURL().startsWith("data:image/png"),
      };
    });
    expect(capture.tracks).toBe(1);
    expect(capture.bytes).toBeGreaterThan(0);
    expect(capture.readable).toBe(true);
    expect(fixture.requests).toHaveLength(0);
  } finally {
    await fixture.close();
    await opener.close();
    await rm(directory, { recursive: true, force: true });
  }
});
