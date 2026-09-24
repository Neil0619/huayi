import { chromium, expect, test } from "@playwright/test";
import { createAsbplayerPackageFixture } from "./support/asbplayer-package-fixture.js";

test.use({ screenshot: "off", trace: "off" });

test("Store fixture video decodes and plays when the browser recorder never completes", async () => {
  test.setTimeout(60000);
  const launch = chromium.launchPersistentContext;
  chromium.launchPersistentContext = async (directory, options) => {
    const context = await launch.call(chromium, directory, options);
    await context.addInitScript(() => {
      Object.defineProperty(globalThis, "MediaRecorder", {
        configurable: true,
        value: class {
          start(): void {
            // Reproduce a browser encoder that never delivers data.
          }
          stop(): void {
            // In particular, do not emit the stop event awaited by the old fixture.
          }
        },
      });
    });
    return context;
  };
  let fixture: Awaited<ReturnType<typeof createAsbplayerPackageFixture>> | undefined;
  try {
    fixture = await createAsbplayerPackageFixture();
    const video = fixture.frame.locator("video");
    await expect
      .poll(() => video.evaluate((element: HTMLVideoElement) => element.readyState))
      .toBeGreaterThanOrEqual(2);
    await video.evaluate((element: HTMLVideoElement) => {
      element.currentTime = 0.2;
      return element.play();
    });
    await expect
      .poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime))
      .toBeGreaterThan(0.6);
    expect(
      await video.evaluate((element: HTMLVideoElement) => ({
        error: element.error,
        width: element.videoWidth,
        height: element.videoHeight,
        frames: element.getVideoPlaybackQuality().totalVideoFrames,
      })),
    ).toMatchObject({ error: null, width: 480, height: 270 });
    expect(
      await video.evaluate(
        (element: HTMLVideoElement) => element.getVideoPlaybackQuality().totalVideoFrames,
      ),
    ).toBeGreaterThan(0);
  } finally {
    chromium.launchPersistentContext = launch;
    await fixture?.close();
  }
});
