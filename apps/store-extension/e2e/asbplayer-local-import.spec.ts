import { expect, test } from "@playwright/test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startMediaOpener } from "../../../scripts/asbplayer-opener-server.mjs";
import { createAsbplayerPackageFixture } from "./support/asbplayer-package-fixture.js";

test.use({ screenshot: "off", trace: "off" });
test("registered importer receives local Files, confirms delivery and permits a second video", async () => {
  test.setTimeout(60000);
  const fixture = await createAsbplayerPackageFixture();
  const directory = await mkdtemp(join(tmpdir(), "seen-said-opener-browser-"));
  const video = join(directory, "video.mp4"),
    subtitle = join(directory, "english.srt");
  await writeFile(video, "bounded-video-payload");
  await writeFile(subtitle, "bounded-subtitle-payload");
  let picked = 0;
  const opener = await startMediaOpener({
    pickFile: async () => {
      picked++;
      return video;
    },
    prepare: async () => ({
      files: [
        { path: video, name: "video.mp4", type: "video/mp4", kind: "video", size: 21 },
        { path: subtitle, name: "english.srt", type: "text/plain", kind: "subtitle", size: 24 },
      ],
      plan: { imageSubtitleCount: 0 },
    }),
    sidecars: async () => [],
  });
  try {
    await fixture.context.route(`${opener.origin}/**`, (route) => route.continue());
    // Reproduce the official file-input contract. Import itself is the registered Store bundle.
    await fixture.context.route("https://app.asbplayer.dev/", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: `<!doctype html><input type="file" multiple><output></output><script>
      document.querySelector('input').onchange=async event=>{
        const files=[...event.target.files];
        document.querySelector('output').textContent=JSON.stringify(await Promise.all(files.map(async file=>({name:file.name,text:await file.text()}))));
      };</script>`,
      }),
    );
    const local = await fixture.context.newPage();
    await local.goto(opener.url);
    await local.getByRole("button", { name: "选择原视频", exact: true }).click();
    await expect(local.getByRole("button", { name: "开始学习", exact: true })).toBeEnabled();
    const launch = async () => {
      const popup = local.waitForEvent("popup");
      await local.getByRole("button", { name: "开始学习", exact: true }).click();
      const player = await popup;
      await expect(player.locator("output")).toContainText("bounded-video-payload");
      await expect(player.locator("output")).toContainText("bounded-subtitle-payload");
      await expect(local.locator("#status")).toContainText("已送入播放器");
      await expect(player.getByRole("button", { name: "打开另一个视频" })).toBeVisible();
      expect(new URL(player.url()).hash).toBe("");
      return player;
    };
    const firstPlayer = await launch();
    await firstPlayer.evaluate(() =>
      window.postMessage({ type: "seen-said/local-replace", nonce: "untrusted" }, location.origin),
    );
    expect(firstPlayer.isClosed()).toBe(false);
    await local.getByRole("button", { name: "选择原视频", exact: true }).click();
    await expect.poll(() => picked).toBe(2);
    await expect(local.getByRole("button", { name: "开始学习", exact: true })).toBeEnabled();
    const secondPlayer = await launch();
    await expect.poll(() => firstPlayer.isClosed()).toBe(true);
    // A former player navigated elsewhere must not be closed by the opener.
    await secondPlayer.goto("https://example.test/");
    const thirdPlayer = await launch();
    await expect(secondPlayer.locator("p")).toHaveText("Reading opens doors.");
    expect(secondPlayer.isClosed()).toBe(false);
    await thirdPlayer.close();
    await secondPlayer.close();
    expect(fixture.requests).toHaveLength(0);
  } finally {
    await opener.close();
    await fixture.close();
    await rm(directory, { recursive: true, force: true });
  }
});
