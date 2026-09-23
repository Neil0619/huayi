import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { chromium, expect } from "@playwright/test";

// Explicit live/manual gate. Never included in the default offline test suite.
if (!process.argv.includes("--run-approved-browser-validation")) {
  throw new Error("This live Chrome check requires explicit browser-validation authorization.");
}
const artifact = fileURLToPath(new URL("../artifacts/asbplayer-m0-probe/", import.meta.url));
const profile = await mkdtemp(join(tmpdir(), "seen-said-asbplayer-m0-"));
const probe = "[data-seen-said-asbplayer-probe]";
const receipt = { platform: process.platform, checks: {}, status: "running" };
let context;
let stage = "launch";
function mark(next) {
  stage = next;
  console.log(`M0 browser phase: ${next}`);
}

async function ready(target, cues = 5, tracks = 2) {
  await expect(target.locator(probe)).toHaveAttribute("data-status", "ready");
  await expect(target.locator(probe)).toHaveAttribute("data-cues", String(cues));
  await expect(target.locator(probe)).toHaveAttribute("data-tracks", String(tracks));
  await expect(target.locator(probe)).toHaveAttribute("data-video-available", "true");
}

async function controls(target) {
  const container = target.locator(".asbplayer-token-container").first();
  const box = await container.boundingBox();
  assert.ok(box);
  await container.hover({ position: { x: box.width - 20, y: box.height - 20 } });
}

async function setOffset(target, seconds) {
  mark(`offset-${seconds}-controls`);
  await controls(target);
  // Official player has offset first and playback rate second. Hovering the volume
  // button temporarily unmounts both, so controls() deliberately avoids that region.
  await expect(target.locator('input[type="text"]')).toHaveCount(2);
  const input = target.locator('input[type="text"]').first();
  mark(`offset-${seconds}-fill`);
  await input.fill(String(seconds));
  mark(`offset-${seconds}-enter`);
  await input.press("Enter");
  mark(`offset-${seconds}-readback`);
  await expect(target.locator(probe)).toHaveAttribute("data-offset-ms", String(seconds * 1000));
}

async function playback(target, paused) {
  await target.getByRole("button", { name: paused ? "暂停测试" : "播放测试", exact: true }).click();
  await expect(target.locator(probe)).toHaveAttribute("data-paused", String(paused));
  await expect(target.locator(`${probe} pre`)).toContainText(`广播暂停: ${paused}`);
}

async function readModes(target) {
  return target.locator(`${probe} pre`).evaluate((element) => {
    const value = element.textContent.match(/播放模式: ([1-5](?:,[1-5])*)\n/u)?.[1];
    return value === undefined ? null : value.split(",").map(Number);
  });
}

try {
  context = await chromium.launchPersistentContext(profile, {
    headless: false,
    viewport: { width: 1280, height: 900 },
    args: [`--disable-extensions-except=${artifact}`, `--load-extension=${artifact}`],
    ignoreDefaultArgs: ["--disable-extensions"],
  });
  context.setDefaultTimeout(10_000);
  receipt.browser = context.browser()?.version() ?? "unknown";
  receipt.probeSha256 = createHash("sha256")
    .update(await readFile(join(artifact, "probe.js")))
    .digest("hex");
  // Observation only. The actual probe is installed via its manifest, never addInitScript.
  // Only bounded numeric/boolean protocol summaries survive the callback.
  await context.addInitScript(() => {
    const params = new URL(globalThis.location.href).searchParams;
    if (
      globalThis.location.origin !== "https://app.asbplayer.dev" ||
      !params.has("video") ||
      !params.has("channel")
    )
      return;
    const events = [];
    const channel = new BroadcastChannel(params.get("channel"));
    Object.defineProperty(globalThis, "__m0SafeEvents", { value: events });
    channel.addEventListener("message", ({ data }) => {
      if (events.length >= 100 || typeof data !== "object" || data === null) return;
      if (data.command === "subtitles" && Array.isArray(data.value)) {
        events.push({
          kind: "subtitles",
          count: data.value.length,
          shifted1500: data.value.every((cue) => cue.start - cue.originalStart === 1500),
        });
      } else if (data.command === "offset" && Number.isFinite(data.value)) {
        events.push({ kind: "offset", value: data.value });
      } else if (data.command === "playModes" && Array.isArray(data.playModes)) {
        events.push({
          kind: "playModes",
          modes: data.playModes.filter((v) => Number.isInteger(v) && v >= 1 && v <= 5).slice(0, 5),
        });
      }
    });
    globalThis.addEventListener("pagehide", () => channel.close(), { once: true });
  });
  const page = await context.newPage();
  mark("official-page");
  await page.goto("https://app.asbplayer.dev/");
  const assetPath = await page.locator('script[type="module"][src]').first().getAttribute("src");
  const asset = await context.request.get(new URL(assetPath, "https://app.asbplayer.dev/").href);
  assert.equal(asset.ok(), true);
  receipt.officialAssetSha256 = createHash("sha256")
    .update(await asset.body())
    .digest("hex");
  mark("synthetic-fixture");
  const media = Buffer.from(
    await page.evaluate(async () => {
      const canvas = globalThis.document.createElement("canvas");
      canvas.width = 320;
      canvas.height = 180;
      const drawing = canvas.getContext("2d");
      const stream = canvas.captureStream(10);
      const recorder = new globalThis.MediaRecorder(stream, { mimeType: "video/webm;codecs=vp8" });
      const chunks = [];
      recorder.ondataavailable = (event) => chunks.push(event.data);
      const stopped = new Promise((resolve) => {
        recorder.onstop = resolve;
      });
      recorder.start();
      const timer = setInterval(() => {
        drawing.fillStyle = "#345678";
        drawing.fillRect(0, 0, 320, 180);
      }, 100);
      await new Promise((resolve) => setTimeout(resolve, 12_000));
      recorder.stop();
      await stopped;
      clearInterval(timer);
      stream.getTracks().forEach((track) => track.stop());
      return Array.from(new Uint8Array(await new Blob(chunks).arrayBuffer()));
    }),
  );
  const subtitle = (name, text) => ({ name, mimeType: "text/plain", buffer: Buffer.from(text) });
  const english = subtitle(
    "en.srt",
    "1\n00:00:01,000 --> 00:00:03,000\nSynthetic first cue.\n\n2\n00:00:04,000 --> 00:00:06,000\nSynthetic second cue.\n\n3\n00:00:08,000 --> 00:00:10,000\nSynthetic third cue.\n",
  );
  const chinese = subtitle(
    "zh.srt",
    "1\n00:00:01,000 --> 00:00:03,000\n测试字幕一。\n\n2\n00:00:04,000 --> 00:00:06,000\n测试字幕二。\n",
  );
  const fixtures = [{ name: "test.webm", mimeType: "video/webm", buffer: media }, english, chinese];
  mark("iframe-initial");
  await page.locator('input[type="file"]').first().setInputFiles(fixtures);
  await expect(page.locator("iframe")).toHaveCount(1);
  let frame = await page
    .locator("iframe")
    .elementHandle()
    .then((element) => element.contentFrame());
  await ready(frame);
  await expect(frame.locator(`${probe} pre`)).toContainText("播放模式: 1");
  receipt.checks.iframeInitial = {
    cues: 5,
    tracks: 2,
    modeBeforeInteraction: [1],
    events: await frame.evaluate(() => globalThis.__m0SafeEvents),
  };
  mark("fullscreen-unobstructed");
  // Regresses the original probe position covering this official control.
  await frame.getByRole("button", { name: "Toggle Fullscreen", exact: true }).click();
  assert.equal(await page.evaluate(() => Boolean(globalThis.document.fullscreenElement)), true);
  await ready(frame);
  await playback(frame, false);
  await playback(frame, true);
  await frame.getByRole("button", { name: "Toggle Fullscreen", exact: true }).click();
  receipt.checks.fullscreen = true;
  mark("parent-timeline");
  await frame.locator('.asbplayer-token-container > video[preload="auto"]').evaluate((video) => {
    video.currentTime = 1.5;
  });
  await playback(frame, false);
  await expect(page.locator("tr.Mui-selected")).toHaveCount(2);
  await playback(frame, true);
  const selectedAtPause = await page
    .locator("tr")
    .evaluateAll((rows) =>
      rows
        .map((row, index) => (row.classList.contains("Mui-selected") ? index : -1))
        .filter((index) => index >= 0),
    );
  assert.deepEqual(selectedAtPause, [0, 1]);
  const pausedAt = await frame
    .locator('video[preload="auto"]')
    .evaluate((video) => video.currentTime);
  await page.waitForTimeout(500);
  assert.equal(
    await frame.locator('video[preload="auto"]').evaluate((video) => video.currentTime),
    pausedAt,
  );
  receipt.checks.pausePlayAndParentTimeline = true;
  mark("thumbnail-settings");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("tab", { name: "Misc", exact: true }).click();
  await page.getByLabel("Show preview thumbnails", { exact: true }).check();
  await page.getByLabel("Remember subtitle offset", { exact: true }).check();
  await page.keyboard.press("Escape");
  mark("thumbnail-created");
  await controls(frame);
  mark("offset-first-fill");
  await setOffset(frame, 1.5);
  mark("thumbnail-count");
  await expect(frame.locator("video")).toHaveCount(2);
  assert.equal(
    await frame.locator("video").evaluateAll((videos) => videos[0].src === videos[1].src),
    true,
  );
  mark("thumbnail-control");
  await ready(frame);
  await playback(frame, false);
  assert.equal(
    await frame.locator('video[preload="none"]').evaluate((video) => video.paused),
    true,
  );
  await playback(frame, true);
  mark("absolute-offset");
  await setOffset(frame, 1.5);
  await setOffset(frame, -0.5);
  await setOffset(frame, 1.5);
  receipt.checks.thumbnailAndAbsoluteOffset = true;
  mark("popout");
  await controls(frame);
  const popupPromise = context.waitForEvent("page");
  await frame.getByRole("button", { name: "Pop Out", exact: true }).click();
  const popup = await popupPromise;
  await ready(popup);
  await expect(popup.locator(probe)).toHaveAttribute("data-offset-ms", "1500");
  await expect(popup.locator(`${probe} pre`)).toContainText("播放模式: 1");
  receipt.checks.popoutInitial = {
    cues: 5,
    tracks: 2,
    offsetMs: 1500,
    modes: await readModes(popup),
    events: await popup.evaluate(() => globalThis.__m0SafeEvents ?? null),
  };
  assert.equal(frame.isDetached(), true);
  await playback(popup, false);
  await playback(popup, true);
  mark("playback-modes");
  await controls(popup);
  await popup.getByRole("button", { name: "Playback Mode", exact: true }).click();
  const observedModes = {};
  for (const [label, mode] of [
    ["Condensed", 2],
    ["Auto-pause", 3],
    ["Fast-forward", 4],
    ["Repeat", 5],
  ]) {
    await popup.getByText(label, { exact: true }).click();
    await expect.poll(() => readModes(popup)).toContain(mode);
    observedModes[label] = await readModes(popup);
    await popup.getByText("Normal", { exact: true }).click();
    await expect(popup.locator(`${probe} pre`)).toContainText("播放模式: 1\n");
  }
  await popup.keyboard.press("Escape");
  receipt.checks.playbackModes = observedModes;
  mark("popin-lifecycle");
  await controls(popup);
  await popup.getByRole("button", { name: "Pop In", exact: true }).click();
  await expect.poll(() => popup.isClosed()).toBe(true);
  await expect(page.locator("iframe")).toHaveCount(1);
  frame = await page
    .locator("iframe")
    .elementHandle()
    .then((element) => element.contentFrame());
  await ready(frame);
  await expect(frame.locator(probe)).toHaveAttribute("data-offset-ms", "1500");
  receipt.checks.popinLifecycle = true;
  mark("late-injection");
  await frame.addScriptTag({ content: await readFile(join(artifact, "probe.js"), "utf8") });
  mark("late-double-probe");
  await expect(frame.locator(probe)).toHaveCount(2);
  mark("late-waiting");
  await expect(frame.locator(probe).last()).toHaveAttribute("data-status", "waiting");
  await page.waitForTimeout(500);
  await expect(frame.locator(probe).last()).toHaveAttribute("data-cues", "0");
  receipt.checks.lateInjection = true;
  // Upstream interprets frame unload as closing the player. Reopen via its native file input.
  await frame.evaluate(() => globalThis.location.reload());
  mark("reload-close-lifecycle");
  await expect(page.locator("iframe")).toHaveCount(0);
  assert.equal(frame.isDetached(), true);
  await page.locator('input[type="file"]').first().setInputFiles(fixtures);
  await expect(page.locator("iframe")).toHaveCount(1);
  frame = await page
    .locator("iframe")
    .elementHandle()
    .then((element) => element.contentFrame());
  await ready(frame);
  receipt.checks.lateInjectionAndReload = true;
  mark("subtitle-replacement");
  await page.locator('input[type="file"]').first().setInputFiles([english]);
  await ready(frame, 3, 1);
  receipt.checks.subtitleReplacement = { cues: 3, tracks: 1 };
  mark("unload-reload");
  const retiredUrl = new URL(frame.url());
  await frame.getByRole("button", { name: "Unload Video", exact: true }).click();
  await expect(page.locator("iframe")).toHaveCount(0);
  assert.equal(frame.isDetached(), true);
  await page.locator('input[type="file"]').first().setInputFiles(fixtures);
  await expect(page.locator("iframe")).toHaveCount(1);
  frame = await page
    .locator("iframe")
    .elementHandle()
    .then((element) => element.contentFrame());
  await ready(frame);
  const replacementUrl = new URL(frame.url());
  assert.notEqual(
    replacementUrl.searchParams.get("channel"),
    retiredUrl.searchParams.get("channel"),
  );
  assert.notEqual(replacementUrl.searchParams.get("video"), retiredUrl.searchParams.get("video"));
  await expect(frame.locator(probe)).toHaveAttribute("data-offset-ms", "1500");
  receipt.checks.unloadReload = { events: await frame.evaluate(() => globalThis.__m0SafeEvents) };
  receipt.status = "passed";
} catch (error) {
  // Never serialize Playwright errors: they can contain subtitle/file/channel/URL data.
  receipt.status = "failed";
  receipt.failedStage = stage;
  receipt.failureKind =
    [
      "intercepts pointer events",
      "not visible",
      "toHaveCount",
      "toHaveAttribute",
      "toContainText",
      "Timeout",
      "strict mode violation",
      "has been detached",
      "Target closed",
    ].find((kind) => error instanceof Error && error.message.includes(kind)) ?? "other";
  process.exitCode = 1;
} finally {
  await context?.close();
  await rm(profile, { recursive: true, force: true });
  receipt.browserClosed = true;
  receipt.profileRemoved = true;
  receipt.windows = "pending";
  await writeFile(join(artifact, "browser-receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(JSON.stringify(receipt));
}
