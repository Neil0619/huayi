import { expect, test } from "@playwright/test";

test("the Store popup keeps its intrinsic width in a narrow browser viewport", async ({ page }) => {
  await page.setViewportSize({ height: 600, width: 320 });
  await page.goto("/apps/store-extension/dist/popup.html");

  await expect(page.locator("body")).toHaveCSS("width", "380px");
});
