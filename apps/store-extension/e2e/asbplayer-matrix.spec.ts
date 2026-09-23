import { expect, test } from "@playwright/test";

import {
  broadcast,
  createAsbplayerPackageFixture,
  cues,
  english,
  learning,
  overlay,
} from "./support/asbplayer-package-fixture.js";

// Actual Store package and media events, with offline upstream/Provider fixtures.
// HUAYI_ASBPLAYER_NATIVE_SCALE additionally verifies the real Windows desktop DPI.
test.use({ screenshot: "off", trace: "off" });

test("Store timing, track replacement and single-track bilingual input stay aligned", async () => {
  test.setTimeout(60000);
  const fixture = await createAsbplayerPackageFixture();
  const { frame, page } = fixture;
  try {
    await frame.locator("[data-confirm-tracks]").click();
    const video = frame.locator("video");
    await video.evaluate((element: HTMLVideoElement) => {
      element.currentTime = 1.8;
    });
    await expect(frame.locator(english)).toHaveText("Practice helps.");
    for (const offset of [500, 500]) {
      await broadcast(page, { command: "offset", value: offset });
      await expect(frame.locator(english)).toHaveText("Learning matters.");
    }
    await broadcast(page, { command: "offset", value: -500 });
    await expect(frame.locator(english)).toHaveText("Practice helps.");
    await broadcast(page, { command: "offset", value: 0 });
    // The final subtitle may outlast the media. Ending must not depend on recorder frame timing.
    await broadcast(page, {
      command: "subtitles",
      value: cues.map((cue) =>
        cue.originalEnd === 3000 ? { ...cue, originalEnd: 10000, end: 10000 } : cue,
      ),
    });
    await expect(frame.locator(learning)).toHaveAttribute("data-state", "waiting-tracks");
    await frame.locator("[data-confirm-tracks]").click();
    await video.evaluate(async (element: HTMLVideoElement) => {
      element.currentTime = 0.1;
      element.playbackRate = 2;
      element.loop = false;
      await element.play();
    });
    await expect(frame.locator(english)).toHaveText("Learning matters.");
    await expect(frame.locator(english)).toHaveText("Practice helps.");
    await expect
      .poll(() => video.evaluate((element: HTMLVideoElement) => element.ended))
      .toBe(true);
    await expect(frame.locator(english)).toHaveCount(0);
    await broadcast(page, {
      command: "subtitles",
      value: [
        { ...cues[0], originalEnd: 3000, end: 3000, text: "Learning matters.\n学习很重要。" },
      ],
    });
    await expect(frame.locator(learning)).toHaveAttribute("data-state", "waiting-tracks");
    await expect(frame.locator(".asbplayer-subtitles")).toBeVisible();
    await frame.getByRole("combobox", { name: "中文轨道" }).selectOption("0");
    await frame.locator("[data-confirm-tracks]").click();
    await video.evaluate((element: HTMLVideoElement) => {
      element.currentTime = 0.2;
    });
    await expect(frame.locator(english)).toHaveText("Learning matters.");
    await frame.getByRole("button", { name: "固定中文", exact: true }).click();
    await expect(frame.locator("[data-huayi-asbplayer-chinese]")).toHaveText("学习很重要。");
    await expect(frame.locator("[data-huayi-asbplayer-chinese]")).toBeVisible();
    expect(fixture.requests).toHaveLength(0);
  } finally {
    await fixture.close();
  }
});

test("Store pause ownership respects pre-paused media, user intervention and special modes", async () => {
  test.setTimeout(60000);
  const fixture = await createAsbplayerPackageFixture();
  const { frame, page } = fixture;
  try {
    await frame.locator("[data-confirm-tracks]").click();
    const video = frame.locator("video");
    const paused = () => video.evaluate((element: HTMLVideoElement) => element.paused);
    const open = async () => {
      await expect(frame.locator(english)).toBeVisible();
      await frame.locator(english).dblclick({ position: { x: 15, y: 12 } });
      await expect(frame.locator(overlay)).toContainText("常用义");
      await expect.poll(paused).toBe(true);
    };
    const close = async () => {
      await page.keyboard.press("Escape");
      await expect(frame.locator(overlay)).toHaveCount(0);
    };
    await open();
    await close();
    expect(await paused()).toBe(true);
    for (const intervention of ["seek", "play-pause", "play"]) {
      await video.evaluate(async (element: HTMLVideoElement) => {
        element.currentTime = 0.2;
        await element.play();
      });
      await open();
      await video.evaluate(async (element: HTMLVideoElement, action) => {
        if (action === "seek") element.currentTime = 0.3;
        else {
          await element.play();
          if (action === "play-pause") element.pause();
        }
      }, intervention);
      await close();
      expect(await paused()).toBe(intervention !== "play");
    }
    await broadcast(page, { command: "playModes", playModes: [2] });
    await video.evaluate(async (element: HTMLVideoElement) => {
      element.currentTime = 0.2;
      await element.play();
    });
    await open();
    await close();
    expect(await paused()).toBe(true);
    // Reopening the same complete query uses the existing Worker cache.
    expect(fixture.requests.length).toBe(1);
  } finally {
    await fixture.close();
  }
});

test("Store native video fullscreen restores subtitles and explanation saves survive card close", async () => {
  test.setTimeout(60000);
  const fixture = await createAsbplayerPackageFixture();
  const { frame, page } = fixture;
  try {
    await frame.locator("[data-confirm-tracks]").click();
    await frame.locator("#fullscreen").evaluate((element: HTMLButtonElement) => {
      element.onclick = () => void document.querySelector("video")?.requestFullscreen();
    });
    await frame.locator("#fullscreen").click();
    await expect
      .poll(() => frame.locator("video").evaluate((video) => document.fullscreenElement === video))
      .toBe(true);
    await expect(frame.locator(learning)).toBeHidden();
    expect(await frame.locator("[data-huayi-asbplayer-active]").count()).toBe(0);
    await frame.locator("body").evaluate(() => document.exitFullscreen());
    await expect(frame.locator(learning)).toBeVisible();
    await expect(frame.locator(".asbplayer-subtitles")).toBeHidden();
    await frame.locator(english).dblclick({ position: { x: 15, y: 12 } });
    await expect(frame.locator(overlay)).toContainText("常用义");
    await frame.locator(`${overlay} [data-action=explain]`).click();
    await expect(frame.locator(overlay)).toContainText("语境分析");
    await expect(frame.locator(`${overlay} [data-stop]`)).toBeHidden();
    await expect(frame.locator(`${overlay} [data-save-word]`)).toBeEnabled();
    expect(fixture.requests.length).toBe(2);
    await frame.locator(`${overlay} [data-save-word]`).click();
    await page.keyboard.press("Escape");
    await expect(frame.locator(overlay)).toHaveCount(0);
    await frame.locator(english).dblclick({ position: { x: 15, y: 12 } });
    await expect(frame.locator(overlay)).toContainText("已保存");
  } finally {
    await fixture.close();
  }
});
