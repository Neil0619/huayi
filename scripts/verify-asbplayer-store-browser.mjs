import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { expect } from "@playwright/test";

import {
  createAsbplayerPackageFixture,
  english,
  learning,
  overlay,
} from "../apps/store-extension/e2e/support/asbplayer-package-fixture.ts";

// Approved live website gate; Provider traffic remains intercepted with synthetic responses.
if (!process.argv.includes("--run-approved-browser-validation")) {
  throw new Error("Official website verification requires explicit browser authorization.");
}
const receipt = { platform: process.platform, status: "running", checks: {}, bundles: {} };
let fixture;
let stage = "startup";
function mark(value) {
  stage = value;
  console.log(`Store official browser phase: ${value}`);
}
async function controls(target) {
  const player = target.locator(".asbplayer-token-container").first();
  const bounds = await player.boundingBox();
  assert.ok(bounds);
  await player.hover({ position: { x: bounds.width - 20, y: bounds.height - 20 } });
}
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
  mark("official-load");
  fixture = await createAsbplayerPackageFixture(true);
  const { context, frame, options, page, requests } = fixture;
  receipt.browser = context.browser()?.version() ?? "unknown";
  if (fixture.nativeDisplay) receipt.nativeDisplay = fixture.nativeDisplay;
  const asset = await page.locator('script[type="module"][src]').first().getAttribute("src");
  assert.ok(asset);
  const response = await context.request.get(new URL(asset, "https://app.asbplayer.dev/").href);
  assert.ok(response.ok());
  receipt.officialAssetSha256 = createHash("sha256")
    .update(await response.body())
    .digest("hex");
  await frame.getByRole("combobox", { name: "中文轨道" }).selectOption("1");
  await frame.locator("[data-confirm-tracks]").click();
  await expect(frame.locator(learning)).toHaveAttribute("data-state", "usable");
  receipt.checks.initialReplayAndTrackConfirmation = true;
  mark("learning-loop");
  const video = frame.locator('.asbplayer-token-container > video[preload="auto"]');
  await video.evaluate(async (element) => {
    element.currentTime = 0.2;
    await element.play();
  });
  await expect(frame.locator(english)).toHaveText("Learning matters.");
  await frame.locator(english).dblclick({ position: { x: 15, y: 12 } });
  await expect(frame.locator(overlay)).toContainText("常用义");
  assert.equal(requests.length, 1);
  assert.equal(await video.evaluate((element) => element.paused), true);
  await frame.locator(`${overlay} [data-save-word]`).click();
  await expect(frame.locator(overlay)).toContainText("已保存");
  receipt.checks.translationAndLocalSave = true;
  mark("fullscreen");
  await controls(frame);
  await frame.getByRole("button", { name: "Toggle Fullscreen", exact: true }).click();
  await expect(frame.locator(overlay)).toBeVisible();
  assert.equal(
    await page
      .locator("html")
      .evaluate((element) => Boolean(element.ownerDocument.fullscreenElement)),
    true,
  );
  assert.equal(requests.length, 1);
  await controls(frame);
  await frame.getByRole("button", { name: "Toggle Fullscreen", exact: true }).click();
  await expect(frame.locator(overlay)).toBeVisible();
  await video.click({ position: { x: 150, y: 80 } });
  await expect(frame.locator(overlay)).toHaveCount(0);
  await expect.poll(() => video.evaluate((element) => element.paused)).toBe(false);
  receipt.checks.fullscreenPreservesCardAndOwnedResume = true;
  mark("text-subtitle-formats");
  for (const [name, text] of [
    ["fixture.vtt", "WEBVTT\n\n00:00:00.000 --> 00:00:03.000\nFormat works.\n"],
    [
      "fixture.ass",
      "[Script Info]\nScriptType: v4.00+\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:00.00,0:00:03.00,Default,,0,0,0,,Format works.\n",
    ],
  ]) {
    await page
      .locator('input[type="file"]')
      .first()
      .setInputFiles([{ name, mimeType: "text/plain", buffer: Buffer.from(text) }]);
    await expect(frame.locator(learning)).toHaveAttribute("data-state", "waiting-tracks");
    await frame.locator("[data-confirm-tracks]").click();
    await video.evaluate((element) => {
      element.currentTime = 0.2;
      element.pause();
    });
    await expect(frame.locator(english)).toHaveText("Format works.");
  }
  receipt.checks.vttAndTextAss = true;
  mark("popout");
  await controls(frame);
  const pending = context.waitForEvent("page");
  await frame.getByRole("button", { name: "Pop Out", exact: true }).click();
  const popup = await pending;
  await expect(popup.locator(learning)).toHaveAttribute("data-state", "waiting-tracks");
  await popup.locator("[data-confirm-tracks]").click();
  await expect(popup.locator(learning)).toHaveAttribute("data-state", "usable");
  await expect(popup.locator(learning)).toContainText("未加载中文字幕");
  receipt.checks.popout = true;
  mark("disable-restore");
  await options.locator('[data-settings-nav="common"]').click();
  await options.locator("[data-asbplayer-mode]").selectOption("disabled");
  await expect(popup.locator(learning)).toHaveCount(0);
  assert.equal(await popup.locator("[data-huayi-asbplayer-active]").count(), 0);
  assert.equal(requests.length, 1);
  receipt.checks.disableRestoresOriginal = true;
  receipt.status = "passed";
} catch {
  receipt.status = "failed";
  receipt.failedStage = stage;
  process.exitCode = 1;
} finally {
  await fixture?.close();
  await writeFile(
    "artifacts/asbplayer-store-browser-receipt.json",
    JSON.stringify(receipt, null, 2) + "\n",
  );
  console.log(`Store official browser verification ${receipt.status}.`);
}
