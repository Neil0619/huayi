import { expect, test } from "@playwright/test";

import { serveCloudWebDist } from "./support/cloud-browser-web-fixture.js";

for (const width of [320, 390, 1440]) {
  test(`privacy navigation stays usable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.route("**/*", async (route) => {
      if (new URL(route.request().url()).origin === "https://web.huayi.invalid") {
        await serveCloudWebDist(route);
      } else {
        await route.abort();
      }
    });
    await page.goto("https://web.huayi.invalid/privacy");

    const title = page.getByRole("heading", { level: 1 });
    await expect(title).toBeVisible();
    expect(
      await title.evaluate((node) => parseFloat(getComputedStyle(node).fontSize)),
    ).toBeLessThanOrEqual(40);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );

    const back = page.getByRole("link", { name: "返回登录", exact: true });
    await back.click({ trial: true, timeout: 2_000 });
    const appearance = page.locator(".appearance-menu > summary");
    await appearance.click();
    await expect(page.locator(".appearance-selector")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width,
    );
    await appearance.click();
    await back.click();
    await expect(page).toHaveURL("https://web.huayi.invalid/login");
  });
}
