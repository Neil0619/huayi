import { expect, test } from "@playwright/test";
test("diagnostic consent is discoverable, optional and reversible", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto("/apps/store-extension/e2e/fixtures/interface.html?page=options");
  await expect(page.locator("html")).toHaveAttribute("data-interface-ready", "true");
  const input = page.getByRole("switch", { name: "自动上传错误诊断" });
  await expect(input).toBeEnabled();
  await expect(input).not.toBeChecked();
  await input.check();
  await expect(page.locator("[data-diagnostic-status]")).toContainText("自动诊断已开启");
  await input.uncheck();
  await expect(page.locator("[data-diagnostic-status]")).toContainText("待上传日志已清除");
  await page.getByRole("heading", { name: "帮助发现错误" }).scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page
    .locator("section[aria-labelledby=diagnostic-title]")
    .screenshot({ path: testInfo.outputPath("diagnostic-settings-390.png") });
});
