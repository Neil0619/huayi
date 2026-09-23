import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { expect } from "@playwright/test";
import {
  createAsbplayerPackageFixture,
  english,
  learning,
  overlay,
} from "../apps/store-extension/e2e/support/asbplayer-package-fixture.ts";

// Live upstream controls and real Store worlds; media and Provider responses are synthetic.
if (!process.argv.includes("--run-approved-browser-validation")) {
  throw new Error("Official website verification requires explicit browser authorization.");
}
const receipt = {
  platform: process.platform,
  validation: "extended-matrix",
  status: "running",
  checks: {},
  bundles: {},
};
let fixture,
  stage = "startup";
function mark(value) {
  stage = value;
  console.log(`Official matrix: ${value}`);
}
async function controls(target) {
  const player = target.locator(".asbplayer-token-container").first();
  const bounds = await player.boundingBox();
  assert.ok(bounds);
  await player.hover({ position: { x: bounds.width - 20, y: bounds.height - 20 } });
}
const subtitle = (name, text) => ({ name, mimeType: "text/plain", buffer: Buffer.from(text) });
try {
  for (const name of [
    "asbplayer-main.js",
    "asbplayer-content.js",
    "service-worker.js",
    "manifest.json",
  ]) {
    receipt.bundles[name] = createHash("sha256")
      .update(await readFile(`apps/store-extension/dist-release/${name}`))
      .digest("hex");
  }
  fixture = await createAsbplayerPackageFixture(true);
  const { page, frame, requests, context } = fixture;
  receipt.browser = context.browser()?.version();
  receipt.nativeDisplay = fixture.nativeDisplay;
  const assetPath = await page.locator('script[type="module"][src]').first().getAttribute("src");
  assert.ok(assetPath);
  const asset = await context.request.get(new URL(assetPath, "https://app.asbplayer.dev/").href);
  assert.ok(asset.ok());
  receipt.officialAssetSha256 = createHash("sha256")
    .update(await asset.body())
    .digest("hex");
  await frame.locator("body").evaluate(() => {
    globalThis.addEventListener("message", (event) => {
      const data = event.data;
      if (
        event.source === globalThis &&
        data?.bridge === "seen-said/asbplayer-v1" &&
        data.type === "snapshot" &&
        data.snapshot?.offsetMs === 500 &&
        data.snapshot.status === "ready" &&
        !globalThis.__oldMatrixSnapshot
      )
        globalThis.__oldMatrixSnapshot = structuredClone(data);
    });
  });
  const video = frame.locator('.asbplayer-token-container > video[preload="auto"]');
  const seek = async (time) => {
    await video.evaluate((v, t) => {
      v.pause();
      v.currentTime = t;
    }, time);
  };
  const close = async () => {
    await page.keyboard.press("Escape");
    await expect(frame.locator(overlay)).toHaveCount(0);
  };
  const open = async () => {
    await expect(frame.locator(english)).toBeVisible();
    await frame.locator(english).dblclick({ position: { x: 15, y: 12 } });
    await expect(frame.locator(overlay)).toContainText("常用义");
    await expect.poll(() => video.evaluate((v) => v.paused)).toBe(true);
  };
  await frame.locator("[data-confirm-tracks]").click();
  mark("native-offset-controls");
  await seek(1.8);
  await expect(frame.locator(english)).toHaveText("Practice helps.");
  for (const [offset, text] of [
    [0.5, "Learning matters."],
    [0.5, "Learning matters."],
    [-0.5, "Practice helps."],
    [0, "Practice helps."],
  ]) {
    await controls(frame);
    const input = frame.locator('input[type="text"]').first();
    await input.fill(String(offset));
    await input.press("Enter");
    await expect(frame.locator(english)).toHaveText(text);
  }
  receipt.checks.positiveNegativeRepeatedOffset = true;
  mark("late-bridge-revision");
  await frame.locator("body").evaluate(async () => {
    if (!globalThis.__oldMatrixSnapshot) throw new Error("Expected observed complete snapshot");
    // Observe delivery after the stale message, then allow the real presentation to paint.
    await new Promise((resolve) => {
      const marker = crypto.randomUUID();
      const delivered = (event) => {
        if (event.source !== globalThis || event.data !== marker) return;
        globalThis.removeEventListener("message", delivered);
        globalThis.requestAnimationFrame(() => globalThis.requestAnimationFrame(resolve));
      };
      globalThis.addEventListener("message", delivered);
      globalThis.postMessage(globalThis.__oldMatrixSnapshot, globalThis.location.origin);
      globalThis.postMessage(marker, globalThis.location.origin);
    });
  });
  await expect(frame.locator(english)).toHaveText("Practice helps.");
  await expect(frame.locator(learning)).toHaveAttribute("data-state", "usable");
  receipt.checks.lateBridgeRevisionRejected = true;
  mark("native-rate-and-ended");
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles([
      subtitle(
        "en.srt",
        "1\n00:00:00,000 --> 00:00:01,500\nLearning matters.\n\n2\n00:00:01,500 --> 00:00:10,000\nPractice helps.\n",
      ),
      subtitle("zh.srt", "1\n00:00:00,000 --> 00:00:10,000\n学习很重要，练习有帮助。\n"),
    ]);
  await expect(frame.locator(learning)).toHaveAttribute("data-state", "waiting-tracks");
  await frame.locator("[data-confirm-tracks]").click();
  await controls(frame);
  const rate = frame.locator('input[type="text"]').nth(1);
  await rate.fill("2");
  await rate.press("Enter");
  assert.equal(await video.evaluate((v) => v.playbackRate), 2);
  await seek(0.1);
  await video.evaluate((v) => v.play());
  await expect(frame.locator(english)).toHaveText("Learning matters.");
  await expect(frame.locator(english)).toHaveText("Practice helps.");
  await expect.poll(() => video.evaluate((v) => v.ended)).toBe(true);
  assert.ok(await video.evaluate((v) => v.currentTime < 10));
  await expect(frame.locator(english)).toHaveCount(0);
  receipt.checks.rateAndEnded = true;
  await seek(0.2);
  await expect(frame.locator(english)).toHaveText("Learning matters.");
  receipt.checks.replayAfterEnded = true;
  await controls(frame);
  await rate.fill("1");
  await rate.press("Enter");
  mark("upstream-special-modes");
  const modes = {};
  for (const label of ["Condensed", "Auto-pause", "Fast-forward", "Repeat"]) {
    await controls(frame);
    await frame.getByRole("button", { name: "Playback Mode", exact: true }).click();
    await frame.getByText("Normal", { exact: true }).click();
    await frame.getByText(label, { exact: true }).click();
    await page.keyboard.press("Escape");
    await seek(0.2);
    await video.evaluate((v) => v.play());
    await open();
    await close();
    assert.equal(
      await video.evaluate((v) => v.paused),
      true,
      `${label} must not resume from closing a card`,
    );
    modes[label] = true;
  }
  receipt.checks.specialModes = modes;
  await controls(frame);
  await frame.getByRole("button", { name: "Playback Mode", exact: true }).click();
  await frame.getByText("Normal", { exact: true }).click();
  await page.keyboard.press("Escape");
  mark("single-track-bilingual");
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles([
      subtitle(
        "bilingual.srt",
        "1\n00:00:00,000 --> 00:00:03,000\nLearning matters.\n学习很重要。\n",
      ),
    ]);
  await expect(frame.locator(learning)).toHaveAttribute("data-state", "waiting-tracks");
  await frame.getByRole("combobox", { name: "中文轨道" }).selectOption("0");
  await frame.locator("[data-confirm-tracks]").click();
  await seek(0.2);
  await expect(frame.locator(english)).toHaveText("Learning matters.");
  await frame.getByRole("button", { name: "固定中文", exact: true }).click();
  await expect(frame.locator("[data-huayi-asbplayer-chinese]")).toHaveText("学习很重要。");
  receipt.checks.singleTrackBilingual = true;
  mark("video-replacement-and-retired-channel");
  await open();
  const old = await frame.locator("body").evaluate(() => ({
    channel: new URL(globalThis.location.href).searchParams.get("channel"),
    video: new URL(globalThis.location.href).searchParams.get("video"),
  }));
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles([
      { name: "replacement.webm", mimeType: "video/webm", buffer: Buffer.from(fixture.mediaBytes) },
      subtitle("replacement.srt", "1\n00:00:00,000 --> 00:00:03,000\nReplacement works.\n"),
    ]);
  await expect(frame.locator(overlay)).toHaveCount(0);
  await expect(frame.locator(learning)).toHaveAttribute("data-state", "waiting-tracks");
  const replacement = await frame.locator("body").evaluate(() => ({
    channel: new URL(globalThis.location.href).searchParams.get("channel"),
    video: new URL(globalThis.location.href).searchParams.get("video"),
  }));
  assert.notEqual(replacement.channel, old.channel);
  assert.notEqual(replacement.video, old.video);
  await frame.locator("[data-confirm-tracks]").click();
  await seek(0.2);
  await expect(frame.locator(english)).toHaveText("Replacement works.");
  await frame.locator("body").evaluate(async (_element, channel) => {
    await new Promise((resolve) => {
      const observer = new BroadcastChannel(channel);
      const sender = new BroadcastChannel(channel);
      observer.onmessage = () => {
        observer.close();
        globalThis.requestAnimationFrame(() => globalThis.requestAnimationFrame(resolve));
      };
      sender.postMessage({
        command: "subtitles",
        value: [
          { originalStart: 0, originalEnd: 3000, start: 0, end: 3000, track: 0, text: "STALE" },
        ],
      });
      sender.close();
    });
  }, old.channel);
  await expect(frame.locator(learning)).toHaveAttribute("data-state", "usable");
  await expect(frame.locator(english)).toHaveText("Replacement works.");
  receipt.checks.mediaReplacementAndRetiredChannel = true;
  mark("oversized-cue-fallback-and-recovery");
  await page.evaluate((channel) => {
    const sender = new BroadcastChannel(channel);
    sender.postMessage({
      command: "subtitles",
      value: [
        {
          originalStart: 0,
          originalEnd: 3000,
          start: 0,
          end: 3000,
          track: 0,
          text: "x".repeat(2001),
        },
      ],
    });
    sender.close();
  }, replacement.channel);
  await expect(frame.locator(learning)).not.toHaveAttribute("data-state", "usable");
  assert.equal(await frame.locator("[data-huayi-asbplayer-active]").count(), 0);
  await expect(frame.locator(".asbplayer-subtitles").first()).toBeVisible();
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles([
      subtitle("recovery.srt", "1\n00:00:00,000 --> 00:00:03,000\nRecovery works.\n"),
    ]);
  await expect(frame.locator(learning)).toHaveAttribute("data-state", "waiting-tracks");
  await frame.locator("[data-confirm-tracks]").click();
  await seek(0.2);
  await expect(frame.locator(english)).toHaveText("Recovery works.");
  receipt.checks.oversizedCueFallbackAndRecovery = true;
  assert.equal(requests.length, 1);
  receipt.providerRequests = requests.length;
  receipt.status = "passed";
} catch (error) {
  receipt.status = "failed";
  receipt.failedStage = stage;
  receipt.failureKind =
    ["toHaveCount", "toHaveAttribute", "toHaveText", "toContainText", "Timeout"].find(
      (kind) => error instanceof Error && error.message.includes(kind),
    ) ?? "other";
  process.exitCode = 1;
} finally {
  await fixture?.close();
  await writeFile(
    "artifacts/asbplayer-store-browser-receipt.json",
    JSON.stringify(receipt, null, 2) + "\n",
  );
  console.log(JSON.stringify(receipt));
}
