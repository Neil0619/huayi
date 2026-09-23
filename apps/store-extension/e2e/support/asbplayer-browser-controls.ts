import assert from "node:assert/strict";
import { expect, type BrowserContext, type Page } from "@playwright/test";

export async function denyOfficialLocalFonts(context: BrowserContext): Promise<void> {
  const page = context.pages()[0] ?? (await context.newPage());
  const session = await context.newCDPSession(page);
  const { targetInfo } = await session.send("Target.getTargetInfo");
  await session.send("Browser.setPermission", {
    permission: { name: "local-fonts" },
    setting: "denied",
    origin: "https://app.asbplayer.dev",
    ...(targetInfo.browserContextId ? { browserContextId: targetInfo.browserContextId } : {}),
  });
  // Chrome clears this override when its CDP session detaches. The isolated
  // context owns the session and closes it after verification has finished.
}

export async function sizeOfficialPopup(
  context: BrowserContext,
  popup: Page,
  expectedScale: number,
) {
  assert.equal(popup.context(), context);
  assert.equal(new URL(popup.url()).origin, "https://app.asbplayer.dev");
  await expect
    .poll(() => popup.locator("video").evaluate((video) => (video as HTMLVideoElement).readyState))
    .toBe(4);
  await popup.bringToFront();
  const session = await context.newCDPSession(popup);
  try {
    const { targetInfo } = await session.send("Target.getTargetInfo");
    const { windowId, bounds } = await session.send("Browser.getWindowForTarget", {
      targetId: targetInfo.targetId,
    });
    await session.send("Browser.setWindowBounds", {
      windowId,
      bounds: { width: 1000, height: 700, windowState: "normal" },
    });
    await expect.poll(() => popup.evaluate(() => innerHeight)).toBeGreaterThan(500);
    const after = await popup.evaluate(() => ({
      innerWidth,
      innerHeight,
      outerWidth,
      outerHeight,
      scale: devicePixelRatio,
    }));
    assert.equal(after.scale, expectedScale);
    assert.equal(after.outerWidth, 1000);
    assert.equal(after.outerHeight, 700);
    return { before: { width: bounds.width, height: bounds.height }, after };
  } finally {
    await session.detach();
  }
}
