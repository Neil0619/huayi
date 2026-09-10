import { expect, test } from "@playwright/test";

for (const viewport of [
  { width: 390, height: 300 },
  { width: 390, height: 240 },
  { width: 320, height: 320 },
]) {
  test(`keeps sentence results readable and scrollable at ${viewport.width} × ${viewport.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto("/apps/store-extension/e2e/fixtures/query-interaction.html");
    await expect(page.locator("body")).toHaveAttribute("data-ready", "true");
    await page.locator("#original").evaluate((element, height) => {
      element.textContent = "We agree on the plan.";
      element.setAttribute(
        "style",
        `position:absolute;left:24px;top:${height / 2 - 10}px;margin:0;font:14px/20px sans-serif`,
      );
    }, viewport.height);
    await page.locator("#show").click();
    const overlay = page.locator("[data-huayi-store-overlay]");
    await overlay.locator("[data-action=explain]").click();
    await expect(overlay.locator(".panel")).toHaveAttribute("data-styles", "ready");
    await expect(overlay).toContainText("主语与谓语已经可以阅读。");
    const streamingBounds = await overlay.boundingBox();
    expect(streamingBounds?.y).toBeCloseTo(8, 0);

    await page.evaluate(() => window.queryFixture.finish());
    await expect(overlay.locator("[data-stop]")).toBeHidden();
    await expect(overlay).toContainText("新闻中补充信息来源。");
    const bounds = await overlay.boundingBox();
    if (!bounds) throw new Error("Missing overlay bounds");
    expect(bounds.x).toBeGreaterThanOrEqual(7);
    expect(bounds.y).toBeCloseTo(streamingBounds?.y ?? -1, 0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width - 7);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height - 7);

    const body = overlay.locator(".body");
    const layout = await body.evaluate((element) => ({
      height: element.clientHeight,
      overflow: element.scrollHeight - element.clientHeight,
      overflowY: getComputedStyle(element).overflowY,
    }));
    expect(layout.height).toBeGreaterThanOrEqual(90);
    expect(layout.overflow).toBeGreaterThan(0);
    expect(layout.overflowY).toBe("auto");
    const firstParagraph = overlay.locator("[data-result-section=main-structure] p").first();
    await expect(firstParagraph).toBeInViewport({ ratio: 1 });
    const header = overlay.locator(".header");
    const footer = overlay.locator(".footer");
    await expect(header).toBeInViewport({ ratio: 1 });
    await expect(footer).toBeInViewport({ ratio: 1 });
    const headerBefore = await header.boundingBox();
    const footerBefore = await footer.boundingBox();

    await body.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await expect(overlay.locator("[data-result-section=context-role] p")).toBeInViewport({
      ratio: 1,
    });
    await expect(firstParagraph).not.toBeInViewport();
    await expect(header).toBeInViewport({ ratio: 1 });
    await expect(footer).toBeInViewport({ ratio: 1 });
    expect((await header.boundingBox())?.y).toBeCloseTo(headerBefore?.y ?? -1, 0);
    expect((await footer.boundingBox())?.y).toBeCloseTo(footerBefore?.y ?? -1, 0);
  });
}
