import { expect, test } from "@playwright/test";

import { createAsbplayerPackageFixture, overlay } from "./support/asbplayer-package-fixture.js";

// Real Store worlds/Worker with offline YouTube, media and Provider responses.
test.use({ screenshot: "off", trace: "off" });
test("actual Store YouTube initial watch load supports selection and owned resume", async () => {
  test.setTimeout(60000);
  const fixture = await createAsbplayerPackageFixture();
  try {
    const page = await fixture.context.newPage();
    await page.goto("https://www.youtube.com/watch?v=fixture-video");
    await page.locator("video").evaluate((video: HTMLVideoElement, bytes) => {
      video.src = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: "video/webm" }));
    }, fixture.mediaBytes);
    const text = page.locator("[data-huayi-store-youtube-english]");
    await expect(text).toHaveText("Learning matters.");
    await page.locator("video").evaluate((video: HTMLVideoElement) => video.play());
    await text.dblclick({ position: { x: 12, y: 10 } });
    await expect(page.locator(overlay)).toContainText("常用义");
    expect(fixture.requests.length).toBe(1);
    expect(await page.locator("video").evaluate((video: HTMLVideoElement) => video.paused)).toBe(
      true,
    );
    await page.keyboard.press("Escape");
    await expect(page.locator(overlay)).toHaveCount(0);
    await expect
      .poll(() => page.locator("video").evaluate((video: HTMLVideoElement) => video.paused))
      .toBe(false);
    // An upstream fixture CC DOM transition restores the original subtitle display.
    await page.locator(".ytp-subtitles-button").evaluate((button) => {
      button.setAttribute("aria-pressed", "false");
    });
    await expect(text).toHaveCount(0);
    await expect(page.locator(".ytp-caption-segment")).toBeVisible();
    expect(fixture.requests.length).toBe(1);
  } finally {
    await fixture.close();
  }
});
