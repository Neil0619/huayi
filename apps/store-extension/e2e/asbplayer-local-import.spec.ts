import { expect, test } from "@playwright/test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startMediaOpener } from "../../../scripts/asbplayer-opener-server.mjs";
import { createAsbplayerPackageFixture } from "./support/asbplayer-package-fixture.js";

test.use({ screenshot: "off", trace: "off" });
test("prepared cache starts learning without any directory picker or whole-video import", async () => {
  test.setTimeout(60000);
  const fixture = await createAsbplayerPackageFixture();
  // Model Chrome's site-level local-service grant, not a file/directory grant or security bypass.
  await fixture.context.grantPermissions(["local-network-access"], {
    origin: "https://app.asbplayer.dev",
  });
  const directory = await mkdtemp(join(tmpdir(), "seen-said-stream-browser-"));
  const video = join(directory, "cached.mp4"),
    subtitle = join(directory, "en.srt");
  await writeFile(video, "streamed-video-payload");
  await writeFile(subtitle, "subtitle-payload");
  const prepared = {
    reused: true,
    files: [
      { path: video, name: "episode.mp4", type: "video/mp4", kind: "video", size: 22 },
      { path: subtitle, name: "en.srt", type: "text/plain", kind: "subtitle", size: 16 },
    ],
    plan: { imageSubtitleCount: 0 },
  };
  const opener = await startMediaOpener({
    pickFile: async () => {
      throw new Error("original must not be required");
    },
    pickCache: async () => video,
    openCache: async () => prepared,
    prepare: async () => {
      throw new Error("conversion must not run");
    },
    sidecars: async () => [],
  });
  try {
    await fixture.context.route(`${opener.origin}/**`, (route) => route.continue());
    await fixture.context.route("https://app.asbplayer.dev/", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: `<!doctype html><input type="file" multiple><output></output><script>
      const nativeUrl=URL.createObjectURL;
      document.querySelector('input').onchange=async event=>{
        const files=[...event.target.files];
        const url=URL.createObjectURL(files[0]);
        const video=await fetch(url,{headers:{Range:'bytes=0-7'}}).then(r=>r.text());
        const ordinary=URL.createObjectURL(new Blob(['ordinary']));
        document.querySelector('output').textContent=JSON.stringify({video,sub:await files[1].text(),restored:URL.createObjectURL===nativeUrl,ordinary:ordinary.startsWith('blob:'),placeholder:files[0].size});
        URL.revokeObjectURL(ordinary);
      };</script>`,
      }),
    );
    const local = await fixture.context.newPage();
    await local.addInitScript(() => {
      Object.defineProperty(window, "showDirectoryPicker", {
        value: () => {
          throw Error("Unexpected directory picker");
        },
      });
    });
    await local.goto(opener.url);
    await expect(local.getByRole("button", { name: "打开缓存视频", exact: true })).toBeVisible({
      timeout: 2000,
    });
    await local.getByRole("button", { name: "打开缓存视频", exact: true }).click();
    await expect(local.getByRole("button", { name: "开始学习", exact: true })).toBeEnabled();
    await expect(local.locator("#status")).toContainText("已找到缓存");
    await expect(local.getByRole("button", { name: "授权缓存目录", exact: true })).toHaveCount(0);
    const popup = local.waitForEvent("popup");
    await local.getByRole("button", { name: "开始学习", exact: true }).click();
    const player = await popup;
    await expect(player.locator("output")).toHaveText(
      JSON.stringify({
        video: "streamed",
        sub: "subtitle-payload",
        restored: true,
        ordinary: true,
        placeholder: 1,
      }),
    );
    await expect(local.locator("#status")).toContainText("已送入播放器");
    await expect(player.getByRole("button", { name: "打开另一个视频", exact: true })).toBeVisible();
    expect(fixture.requests).toHaveLength(0);
  } finally {
    await opener.close();
    await fixture.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("registered importer streams selected media, confirms delivery and permits a second video", async () => {
  test.setTimeout(60000);
  const fixture = await createAsbplayerPackageFixture();
  await fixture.context.grantPermissions(["local-network-access"], {
    origin: "https://app.asbplayer.dev",
  });
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
        document.querySelector('output').textContent=JSON.stringify(await Promise.all(files.map(async file=>({name:file.name,text:file.name.endsWith(".mp4")?await fetch(URL.createObjectURL(file),{headers:{Range:"bytes=0-1000"}}).then(r=>r.text()):await file.text()}))));
      };</script>`,
      }),
    );
    const local = await fixture.context.newPage();
    await local.goto(opener.url);
    const mediaRequests: string[] = [];
    local.on("request", (request) => {
      if (new URL(request.url()).pathname.startsWith("/file/")) mediaRequests.push(request.url());
    });
    await local.getByRole("button", { name: "选择原视频", exact: true }).click();
    await expect(local.getByRole("button", { name: "开始学习", exact: true })).toBeEnabled();
    await expect(local.getByRole("button", { name: "授权缓存目录", exact: true })).toHaveCount(0);
    // Reload with a fresh startup URL; native cached selection needs no directory permission.
    await local.goto(opener.url);
    await expect(local.getByRole("button", { name: "开始学习", exact: true })).toBeEnabled();
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
    await expect(local.getByRole("button", { name: "授权缓存目录", exact: true })).toHaveCount(0);
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
    await expect(page.locator("#status")).not.toContainText("请在文件选择窗口中选择文件");
    await page.getByRole("button", { name: "选用此视频", exact: true }).click();
    await expect(page.locator("#title")).toHaveText("first.mp4");
    await expect(page.getByRole("button", { name: "开始学习", exact: true })).toBeEnabled();
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
