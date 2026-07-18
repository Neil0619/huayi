import { expect, test } from "@playwright/test";

test.use({ viewport: { height: 700, width: 900 } });

test("renders the lexical translation card inside the viewport", async ({ page }) => {
  await page.goto("/apps/extension/e2e/fixtures/article.html");

  const host = page.locator("[data-huayi-overlay-host]");
  const panel = host.locator(".huayi-panel");
  await expect(panel).toBeVisible();
  await expect(panel).toContainText("对案件、事故等进行系统查证的调查");
  await expect(panel.locator('[data-huayi-section="common-phrases"] li')).toHaveCount(2);
  await expect(panel.locator("[data-related-term]")).toHaveCount(0);
  await expect(panel.locator("input")).toHaveCount(0);

  const bounds = await panel.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds?.width).toBeLessThanOrEqual(420);
  expect(bounds?.x).toBeGreaterThanOrEqual(8);
  expect((bounds?.x ?? 0) + (bounds?.width ?? 0)).toBeLessThanOrEqual(892);

  await expect(panel).toHaveScreenshot("lexical-translation.png", {
    animations: "disabled",
  });
});

test("renders the lexical explanation card with structured sections", async ({ page }) => {
  await page.goto("/apps/extension/e2e/fixtures/article.html?action=explain");

  const panel = page.locator("[data-huayi-overlay-host]").locator(".huayi-panel");
  await expect(panel).toBeVisible();
  await expect(panel.locator('[data-huayi-section="word-form"] .huayi-entry')).toHaveCount(3);
  await expect(panel.locator('[data-huayi-section="usage-notes"] .huayi-entry')).toHaveCount(2);
  await expect(
    panel.locator('[data-huayi-section="synonym-comparisons"] .huayi-entry'),
  ).toHaveCount(2);
  await expect(panel).toHaveScreenshot("lexical-explanation.png", {
    animations: "disabled",
  });
});
