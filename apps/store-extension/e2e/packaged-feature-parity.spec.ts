import { expect, test } from "@playwright/test";

// Exercise the actual bundles: source-only tests cannot detect a stale delivery directory.
for (const profile of ["hosted-acceptance", "production", "release"]) {
  test(`${profile} package preserves sentence disclosure and readable viewport placement`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 831, height: 769 });
    await page.goto(
      `/apps/store-extension/e2e/fixtures/query-interaction.html?package=parity-${profile}&explicit-structure`,
    );
    await expect(page.locator("body")).toHaveAttribute("data-packaged-ready", "true");
    await page.locator("#original").click({ clickCount: 3 });
    const panel = page.locator("[data-huayi-store-overlay]");
    await panel.locator("[data-action=explain]").click();
    await expect(panel.locator(".panel")).toHaveAttribute("data-styles", "ready");
    await expect(panel.locator(".panel")).toHaveCSS(
      "font-family",
      'system-ui, "PingFang SC", "Microsoft YaHei", sans-serif',
    );
    await expect(panel.locator(".panel")).toHaveCSS("font-size", "15px");
    await expect(panel.locator(".panel")).toHaveCSS("line-height", "22.5px");
    await expect(panel.locator(".core strong")).toHaveText([
      "He gave no details",
      "The plan costs money",
    ]);
    const summary = panel.locator("summary");
    await expect(summary).toHaveText("查看结构说明");
    await expect(panel.locator("details")).not.toHaveAttribute("open");
    await summary.click();
    await summary.focus();
    await page.evaluate(() => window.queryFixture.finish());
    await expect(panel.locator("[data-stop]")).toBeHidden();
    await expect(panel.locator("details")).toHaveAttribute("open");
    await expect(summary).toBeFocused();
    await expect(panel.locator(".notes")).toContainText("第一句主干为");
    await page.setViewportSize({ width: 390, height: 300 });
    await expect
      .poll(async () => {
        const bounds = await panel.boundingBox();
        return bounds ? bounds.y + bounds.height : Infinity;
      })
      .toBeLessThanOrEqual(293);
    await expect(panel.locator(".header")).toBeInViewport({ ratio: 1 });
    await expect(panel.locator(".footer")).toBeInViewport({ ratio: 1 });
    expect(
      await panel.locator(".body").evaluate((element) => element.clientHeight),
    ).toBeGreaterThan(90);
  });
}
