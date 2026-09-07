import { expect, test, type Locator } from "@playwright/test";

async function expectReadableComparisons(panel: Locator) {
  const entries = panel.locator("[data-result-layout=comparisons] .result-entry");
  await expect(entries).toHaveCount(2);
  for (const entry of await entries.all()) {
    const layout = await entry.evaluate((element) => {
      const list = element.parentElement;
      const lead = element.querySelector(".result-entry-lead");
      const badge = element.querySelector(".result-badge");
      const word = element.querySelector("strong");
      const detail = element.querySelector(".result-entry-detail");
      if (!list || !lead || !badge || !word || !detail) throw new Error("Missing comparison");
      return {
        width: element.getBoundingClientRect().width,
        listWidth: list.getBoundingClientRect().width,
        detailWidth: detail.getBoundingClientRect().width,
        badgeHeight: badge.getBoundingClientRect().height,
        wordHeight: word.getBoundingClientRect().height,
        leadHeight: lead.getBoundingClientRect().height,
      };
    });
    expect(layout.width).toBeGreaterThanOrEqual(layout.listWidth - 1);
    expect(layout.detailWidth).toBeGreaterThanOrEqual(layout.width - 1);
    expect(layout.wordHeight).toBeLessThan(30);
    expect(layout.badgeHeight).toBeLessThan(30);
    expect(layout.leadHeight).toBeLessThan(32);
  }
}

for (const width of [900, 390, 320]) {
  for (const fallback of [false, true]) {
    test(`word comparisons stay readable at ${width}px with ${fallback ? "fallback" : "loaded"} styles`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width, height: 713 });
      if (fallback) await page.route("**/pages/overlay.css", (route) => route.abort());
      await page.goto("/apps/store-extension/e2e/fixtures/query-interaction.html");
      await page.locator("#original").evaluate((element) => {
        element.textContent = "reasoning";
      });
      await page.locator("#show").click();
      const panel = page.locator("[data-huayi-store-overlay]");
      await panel.locator("[data-action=translate]").click();
      await expect(panel.locator(".panel")).toHaveAttribute(
        "data-styles",
        fallback ? "fallback" : "ready",
      );
      await expectReadableComparisons(panel);
      await page.evaluate(() => window.queryFixture.finish());
      await expect(panel.locator("[data-stop]")).toBeHidden();
      await expectReadableComparisons(panel);
      await expect(panel.locator("[data-close]")).toHaveCount(0);
      const badge = panel.locator("[data-result-layout=definitions] .result-badge");
      expect((await badge.boundingBox())?.height).toBeLessThan(30);
      if (!fallback && width >= 390) {
        expect((await panel.locator(".header").boundingBox())?.height).toBeLessThan(65);
      }
      await panel.screenshot({ path: testInfo.outputPath("word-card.png") });
      await page.mouse.click(2, 2);
      await expect(panel).toHaveCount(0);
      expect(await page.evaluate(() => window.getSelection()?.toString())).toBe("");
      await page.evaluate(() => window.queryFixture.show());
      await panel.locator("[data-action=translate]").click();
      await expect(panel.locator("[data-stop]")).toBeHidden();
      await page.keyboard.press("Escape");
      await expect(panel).toHaveCount(0);
      await expect(page.locator("body")).toHaveAttribute("data-calls", "1");
    });
  }
}
