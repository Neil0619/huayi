import { expect, test } from "@playwright/test";

import {
  broadcast,
  createAsbplayerPackageFixture,
  cues,
  english,
  learning,
  overlay,
} from "./support/asbplayer-package-fixture.js";

test.use({ screenshot: "off", trace: "off" });
test("actual BFCache restoration retires the Store card and requires a fresh subtitle snapshot", async () => {
  test.setTimeout(60000);
  const fixture = await createAsbplayerPackageFixture(false, { backForwardCache: true });
  const { frame, page } = fixture;
  try {
    await frame.locator("[data-confirm-tracks]").click();
    await frame.locator("#play").click();
    await frame.locator(english).dblclick({ position: { x: 15, y: 12 } });
    await expect(frame.locator(overlay)).toContainText("常用义");
    await frame.locator("body").evaluate((element) => {
      window.addEventListener("pageshow", (event) => {
        element.dataset.persistedRestore = String(event.persisted);
      });
    });
    await page.goto("https://example.test/");
    // BFCache restores an existing document; no new load event is required.
    await page.goBack({ waitUntil: "commit" });
    // Playwright can lose its child-frame handle across BFCache. Read the real
    // same-origin restored document through its parent, without dispatching lifecycle events.
    const restored = () =>
      page.evaluate(
        ({ learning, overlay }) => {
          const doc = document.querySelector<HTMLIFrameElement>("#player")?.contentDocument;
          const host = doc?.querySelector<HTMLElement>(learning);
          const native = doc?.querySelector(".asbplayer-subtitles");
          return {
            persisted: doc?.body.dataset.persistedRestore,
            cards: doc?.querySelectorAll(overlay).length,
            state: host?.dataset.state,
            ready: host?.dataset.bridgeReady,
            nativeVisible:
              native && doc?.defaultView?.getComputedStyle(native).visibility === "visible",
          };
        },
        { learning, overlay },
      );
    await expect.poll(restored).toEqual({
      persisted: "true",
      cards: 0,
      state: "waiting-full-snapshot",
      ready: "true",
      nativeVisible: true,
    });
    await broadcast(page, { command: "subtitles", value: cues });
    await broadcast(page, { command: "offset", value: 0 });
    await expect.poll(async () => (await restored()).state).toBe("waiting-tracks");
    const button = await page.evaluate(() => {
      const frame = document.querySelector<HTMLIFrameElement>("#player");
      const bounds = frame?.contentDocument
        ?.querySelector("[data-confirm-tracks]")
        ?.getBoundingClientRect();
      if (!frame || !bounds) throw new Error("Restored track confirmation unavailable");
      const outer = frame.getBoundingClientRect();
      return {
        x: outer.x + bounds.x + bounds.width / 2,
        y: outer.y + bounds.y + bounds.height / 2,
      };
    });
    await page.mouse.click(button.x, button.y);
    await expect.poll(async () => (await restored()).state).toBe("usable");
    await expect.poll(async () => (await restored()).nativeVisible).toBe(false);
    expect(fixture.requests.length).toBe(1);
  } finally {
    await fixture.close();
  }
});
