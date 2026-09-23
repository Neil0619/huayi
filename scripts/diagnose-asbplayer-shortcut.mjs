import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { expect } from "@playwright/test";
import {
  broadcast,
  createAsbplayerPackageFixture,
  cues,
  learning,
} from "../apps/store-extension/e2e/support/asbplayer-package-fixture.ts";

assert.deepEqual(process.argv.slice(2), ["--run-offline-diagnostic"]);
assert.equal(process.env.HUAYI_ASBPLAYER_NATIVE_SCALE, undefined);
await mkdir(".codex-pet-runs/targeted-ci", { recursive: true });
const receipt = { platform: process.platform, status: "running", runs: [] };
const save = () =>
  writeFile(".codex-pet-runs/targeted-ci/shortcut.json", JSON.stringify(receipt, null, 2) + "\n");
for (let run = 1; run <= 20; run += 1) {
  let fixture;
  let stage = "setup";
  try {
    fixture = await createAsbplayerPackageFixture();
    const { frame, page, options } = fixture;
    receipt.browser = fixture.context.browser()?.version();
    stage = "configure-shortcut";
    await options.locator('[data-settings-nav="common"]').click();
    const recorder = options.locator("[data-asbplayer-shortcut]");
    await recorder.click();
    await recorder.press("Alt+H");
    await expect(recorder).toHaveText("Alt + H");
    await frame.getByRole("combobox", { name: "中文轨道" }).selectOption("1");
    await frame.locator("[data-confirm-tracks]").click();
    await frame.locator("video").evaluate((video) => {
      const events = [];
      video.dataset.phase = "valid-shortcut";
      for (const event of ["play", "playing", "pause", "seeking", "ended"]) {
        video.addEventListener(event, () => {
          events.push({
            event,
            phase: video.dataset.phase,
            paused: video.paused,
            time: video.currentTime,
          });
          video.dataset.eventTrace = JSON.stringify(events.slice(-32));
        });
      }
    });
    stage = "valid-shortcut";
    await frame.locator("#play").click();
    await frame.locator("body").evaluate((element) => {
      element.tabIndex = -1;
    });
    await frame.locator("body").focus();
    await page.keyboard.down("Alt");
    await page.keyboard.down("KeyH");
    await expect.poll(() => frame.locator("video").evaluate((video) => video.paused)).toBe(true);
    await page.keyboard.up("KeyH");
    await page.keyboard.up("Alt");
    await expect.poll(() => frame.locator("video").evaluate((video) => video.paused)).toBe(false);
    await frame.locator("video").evaluate((video) => {
      video.dataset.phase = "observe-invalidation";
      video.dataset.pauseCount = "0";
      video.addEventListener("pause", () => {
        video.dataset.pauseCount = String(Number(video.dataset.pauseCount) + 1);
      });
    });
    stage = "invalidate";
    await broadcast(page, {
      command: "subtitles",
      value: [{ ...cues[0], text: "x".repeat(2001) }],
    });
    await expect(frame.locator(learning)).toHaveAttribute("data-state", "invalidated");
    stage = "invalid-shortcut";
    await frame.locator("video").evaluate((video) => {
      video.dataset.phase = "invalid-shortcut";
    });
    await page.keyboard.press("Alt+H");
    const observed = await frame.locator("video").evaluate((video) => ({
      pauses: video.dataset.pauseCount,
      paused: video.paused,
      trace: JSON.parse(video.dataset.eventTrace ?? "[]"),
    }));
    receipt.runs.push({ run, ...observed });
    assert.equal(observed.pauses, "0");
    assert.equal(observed.paused, false);
    assert.equal(fixture.requests.length, 0);
  } catch {
    receipt.status = "failed";
    receipt.failedRun = run;
    receipt.failedStage = stage;
    const trace = await fixture?.frame
      .locator("video")
      .getAttribute("data-event-trace")
      .catch(() => null);
    if (trace) receipt.failedTrace = JSON.parse(trace);
    process.exitCode = 1;
  } finally {
    await fixture?.close();
    await save();
  }
  console.log(
    `Offline shortcut diagnostic iteration ${run}: ${receipt.status === "failed" ? "failed" : "passed"}.`,
  );
  if (receipt.status === "failed") break;
}
if (receipt.status === "running") receipt.status = "passed";
await save();
