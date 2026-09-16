import { expect, test, type Page } from "@playwright/test";

const fixture = "/apps/store-extension/e2e/fixtures/interface.html?page=options&backfill";

async function expectUnfilteredSurfaces(page: Page) {
  const filtered = await page.locator("body *:visible").evaluateAll((elements) =>
    elements.flatMap((element) =>
      [null, "::before", "::after"].flatMap((pseudo) => {
        const style = getComputedStyle(element, pseudo);
        if (pseudo && ["none", "normal"].includes(style.content)) return [];
        return style.backdropFilter === "none"
          ? []
          : [`${element.tagName}.${element.className}${pseudo ?? ""}: ${style.backdropFilter}`];
      }),
    ),
  );
  expect(filtered).toEqual([]);
  await expect(page.locator("body")).toHaveCSS("background-attachment", /^scroll(?:, scroll)*$/);
  await expect(page.locator("[data-page-status]")).toHaveCSS("backdrop-filter", "none");
}

for (const width of [1726, 390]) {
  test(`options scroll without backdrop sampling at ${width}px`, async ({ page }) => {
    await page.route("**/*", async (route) => {
      if (new URL(route.request().url()).hostname === "127.0.0.1") await route.continue();
      else await route.abort();
    });
    await page.setViewportSize({ width, height: 900 });
    await page.goto(fixture);
    await expect(page.locator("html")).toHaveAttribute("data-interface-ready", "true");
    const navigation = page.getByRole("tablist", { name: "设置分类" });
    await expect(navigation).toHaveCSS("position", width > 760 ? "sticky" : "static");

    for (const name of ["常用设置", "外部词典"]) {
      const tab = page.getByRole("tab", { name, exact: true });
      await tab.click();
      await expect(tab).toHaveAttribute("aria-selected", "true");
      await page.evaluate(() => window.scrollTo(0, 0));
      await expectUnfilteredSurfaces(page);
      await page.mouse.move(width - 40, 600);
      await page.mouse.wheel(0, 500);
      await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(0);
      await expectUnfilteredSurfaces(page);
      if (width > 760) {
        const bounds = await navigation.boundingBox();
        expect(bounds).not.toBeNull();
        expect(bounds?.y).toBeGreaterThanOrEqual(0);
        expect((bounds?.y ?? 900) + (bounds?.height ?? 0)).toBeLessThan(900);
      }
    }

    await page.getByRole("tab", { name: "常用设置", exact: true }).click();
    await page.getByRole("button", { name: "管理网站规则 →", exact: true }).click();
    await expect(page.getByRole("tab", { name: "网站管理", exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(page.locator("[data-site-rule-host]")).toBeVisible();
  });
}
