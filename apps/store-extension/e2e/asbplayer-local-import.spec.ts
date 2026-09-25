import { expect, test } from "@playwright/test";
import { mkdtemp, writeFile, rm, utimes } from "node:fs/promises";
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
    nextVideo = join(directory, "next-video.mp4"),
    subtitle = join(directory, "english.srt");
  await writeFile(video, "bounded-video-payload");
  await writeFile(nextVideo, "next-episode-payload");
  await writeFile(subtitle, "bounded-subtitle-payload");
  let picked = 0;
  const opener = await startMediaOpener({
    pickFile: async () => {
      picked++;
      return picked === 1 ? video : nextVideo;
    },
    prepare: async (source) => ({
      files: [
        { path: source, name: "video.mp4", type: "video/mp4", kind: "video", size: 21 },
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
    // A real browser directory handle exercises IndexedDB persistence and file references.
    // Selection alone is injected: this does not claim a native directory dialog passed.
    const modified = await local.evaluate(async () => {
      const directory = await (
        await navigator.storage.getDirectory()
      ).getDirectoryHandle("cache", { create: true });
      const handle = await directory.getFileHandle("video.mp4", { create: true });
      const writable = await handle.createWritable();
      await writable.write("bounded-video-payload");
      await writable.close();
      const nextHandle = await directory.getFileHandle("next-video.mp4", { create: true });
      const nextWritable = await nextHandle.createWritable();
      await nextWritable.write("next-episode-payload");
      await nextWritable.close();
      const empty = await (
        await navigator.storage.getDirectory()
      ).getDirectoryHandle("wrong-cache", { create: true });
      let selections = 0;
      Object.defineProperty(window, "showDirectoryPicker", {
        configurable: true,
        value: async () => {
          selections++;
          if (selections === 1) throw new DOMException("cancelled", "AbortError");
          return selections === 2 ? empty : directory;
        },
      });
      return {
        first: (await handle.getFile()).lastModified,
        next: (await nextHandle.getFile()).lastModified,
      };
    });
    await utimes(video, modified.first / 1000, modified.first / 1000);
    await utimes(nextVideo, modified.next / 1000, modified.next / 1000);
    const mediaRequests: string[] = [];
    local.on("request", (request) => {
      if (new URL(request.url()).pathname.startsWith("/file/")) mediaRequests.push(request.url());
    });
    await local.getByRole("button", { name: "选择原视频", exact: true }).click();
    await expect(local.getByRole("button", { name: "授权缓存目录", exact: true })).toBeVisible();
    await expect(local.getByRole("button", { name: "开始学习", exact: true })).toBeDisabled();
    await local.getByRole("button", { name: "授权缓存目录", exact: true }).click();
    await expect(local.locator("#status")).toContainText("已取消目录授权");
    await expect(local.getByRole("button", { name: "开始学习", exact: true })).toBeDisabled();
    await local.getByRole("button", { name: "授权缓存目录", exact: true }).click();
    await expect(local.locator("#status")).toContainText("所选目录中没有这份缓存");
    await expect(local.getByRole("button", { name: "开始学习", exact: true })).toBeDisabled();
    await local.getByRole("button", { name: "授权缓存目录", exact: true }).click();
    await expect(local.getByRole("button", { name: "开始学习", exact: true })).toBeEnabled();
    // Reload with a fresh startup URL: the real persisted handle must work without a picker.
    await local.goto(opener.url);
    await expect(local.getByRole("button", { name: "开始学习", exact: true })).toBeEnabled();
    await expect(local.getByRole("button", { name: "授权缓存目录", exact: true })).toBeHidden();
    const launch = async (payload: string) => {
      const popup = local.waitForEvent("popup");
      await local.getByRole("button", { name: "开始学习", exact: true }).click();
      const player = await popup;
      await expect(player.locator("output")).toContainText(payload);
      await expect(player.locator("output")).toContainText("bounded-subtitle-payload");
      await expect(local.locator("#status")).toContainText("已送入播放器");
      await expect(player.getByRole("button", { name: "打开另一个视频" })).toBeVisible();
      expect(new URL(player.url()).hash).toBe("");
      return player;
    };
    const firstPlayer = await launch("bounded-video-payload");
    expect(mediaRequests).toHaveLength(1); // Only the small subtitle is requested over HTTP.
    await firstPlayer.evaluate(() =>
      window.postMessage({ type: "seen-said/local-replace", nonce: "untrusted" }, location.origin),
    );
    expect(firstPlayer.isClosed()).toBe(false);
    await firstPlayer.evaluate((origin) => {
      window.opener.postMessage({ type: "seen-said/local-open", nonce: "untrusted" }, origin);
    }, opener.origin);
    await expect(local.getByRole("button", { name: "开始学习", exact: true })).toBeEnabled();
    expect(picked).toBe(1);
    let releaseOpen: () => void = () => undefined;
    const openGate = new Promise<void>((resolve) => {
      releaseOpen = resolve;
    });
    await fixture.context.route(`${opener.origin}/api/open`, async (route) => {
      await openGate;
      await route.continue();
    });
    try {
      await firstPlayer.getByRole("button", { name: "打开另一个视频", exact: true }).click();
      await expect(local.getByRole("button", { name: "开始学习", exact: true })).toBeDisabled();
      await expect(firstPlayer.locator("[data-huayi-local-open-status]")).toContainText(
        "请在文件窗口",
      );
      await firstPlayer.getByRole("button", { name: "打开另一个视频", exact: true }).click();
      await expect(firstPlayer.locator("[data-huayi-local-open-status]")).toContainText(
        "正在处理文件",
      );
    } finally {
      releaseOpen();
    }
    await expect.poll(() => picked).toBe(2);
    await expect(local.getByRole("button", { name: "开始学习", exact: true })).toBeEnabled();
    await expect(local.getByRole("button", { name: "授权缓存目录", exact: true })).toBeHidden();
    const secondPlayer = await launch("next-episode-payload");
    await expect.poll(() => firstPlayer.isClosed()).toBe(true);
    // A former player navigated elsewhere must not be closed by the opener.
    await secondPlayer.goto("https://example.test/");
    const thirdPlayer = await launch("next-episode-payload");
    await expect(secondPlayer.locator("p")).toHaveText("Reading opens doors.");
    expect(secondPlayer.isClosed()).toBe(false);
    await local.close();
    await thirdPlayer.getByRole("button", { name: "打开另一个视频", exact: true }).click();
    await expect(thirdPlayer.locator("[data-huayi-local-open-status]")).toContainText(
      "打开器已关闭",
    );
    await thirdPlayer.close();
    await secondPlayer.close();
    expect(fixture.requests).toHaveLength(0);
  } finally {
    await opener.close();
    await fixture.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("batch page shows progress, stops remaining work and can select a prepared video", async () => {
  test.setTimeout(60000);
  const fixture = await createAsbplayerPackageFixture();
  const directory = await mkdtemp(join(tmpdir(), "seen-said-batch-browser-"));
  const files = [join(directory, "first.mp4"), join(directory, "next.mp4")];
  for (const file of files) await writeFile(file, "batch-video");
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const opener = await startMediaOpener({
    pickFile: async () => null,
    pickFiles: async () => files,
    prepare: async (source, progress) => {
      progress("正在准备兼容音轨");
      await gate;
      return {
        files: [{ path: source, name: "video.mp4", type: "video/mp4", kind: "video", size: 11 }],
        plan: { imageSubtitleCount: 0 },
      };
    },
    sidecars: async () => [],
  });
  try {
    await fixture.context.route(`${opener.origin}/**`, (route) => route.continue());
    const page = await fixture.context.newPage();
    await page.goto(opener.url);
    await page.getByRole("button", { name: "批量预处理视频", exact: true }).click();
    await expect(page.locator("#batch-items")).toContainText("first.mp4 — 正在准备兼容音轨");
    await expect(page.getByRole("button", { name: "选择原视频", exact: true })).toBeDisabled();
    await page.getByRole("button", { name: "停止剩余任务", exact: true }).click();
    await expect(page.locator("#batch-status")).toContainText("完成当前文件");
    release();
    await expect(page.locator("#batch-status")).toContainText("成功 1，失败 0，未处理 1");
    await page.getByRole("button", { name: "选用此视频", exact: true }).click();
    await expect(page.locator("#title")).toHaveText("first.mp4");
    await expect(page.getByRole("button", { name: "授权缓存目录", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "批量预处理视频", exact: true }).click();
    await expect(page.locator("#batch-status")).toContainText("成功 2，失败 0，未处理 0");
    await page.getByRole("button", { name: "选用此视频", exact: true }).nth(1).click();
    await expect(page.locator("#title")).toHaveText("next.mp4");
    expect(fixture.requests).toHaveLength(0);
  } finally {
    release();
    await opener.close();
    await fixture.close();
    await rm(directory, { recursive: true, force: true });
  }
});
