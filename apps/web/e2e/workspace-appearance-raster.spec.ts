import { expect, test } from "@playwright/test";

import { createCloudBrowserAuthority } from "./support/cloud-browser-authority.js";

test("workspace appearance text stays stable when Chrome rebuilds its backdrop layer", async ({
  page,
}) => {
  const authority = createCloudBrowserAuthority({ authenticated: true, seed: "dialogue-practice" });
  await authority.install(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("https://web.huayi.invalid/settings/account");
  await page.evaluate(() => localStorage.setItem("huayi.web.appearance.v1", "porcelain"));

  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.reload();
    await expect(page.getByRole("heading", { name: "当前账号" })).toBeVisible();
    await page.locator(".account-settings-disclosure > summary").click();
    const summary = page.locator(".topbar .appearance-menu > summary");
    const originalFilter = await summary.evaluate(
      (element) => getComputedStyle(element).backdropFilter,
    );
    const region = await summary.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return {
        x: Math.floor(rect.left),
        y: Math.floor(rect.top),
        width: Math.ceil(rect.right) - Math.floor(rect.left),
        height: Math.ceil(rect.bottom) - Math.floor(rect.top),
      };
    });
    const before = await page.screenshot({ animations: "disabled", scale: "css" });

    // Exercise a compositor rebuild, then restore the exact original CSS. Previously
    // the same font and rectangle could produce different text pixels after this cycle.
    await summary.evaluate((element: HTMLElement) => {
      element.style.backdropFilter = "none";
    });
    await page.screenshot({ animations: "disabled", scale: "css" });
    await summary.evaluate((element: HTMLElement) => {
      element.style.removeProperty("backdrop-filter");
    });
    expect(await summary.evaluate((element) => getComputedStyle(element).backdropFilter)).toBe(
      originalFilter,
    );
    const after = await page.screenshot({ animations: "disabled", scale: "css" });
    const identical = await page.evaluate(
      async ({ images, region }) => {
        const pixels = [];
        for (const encoded of images) {
          const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
          const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
          const canvas = new OffscreenCanvas(region.width, region.height);
          const context = canvas.getContext("2d");
          if (context === null) throw new Error("Screenshot comparison requires a 2D canvas.");
          context.drawImage(bitmap, -region.x, -region.y);
          pixels.push(context.getImageData(0, 0, region.width, region.height).data);
          bitmap.close();
        }
        const [first, second] = pixels;
        return (
          first !== undefined &&
          second !== undefined &&
          first.every((value, i) => value === second[i])
        );
      },
      { images: [before.toString("base64"), after.toString("base64")], region },
    );
    expect(identical, `repaint ${attempt + 1} changed the appearance control`).toBe(true);
  }
});
