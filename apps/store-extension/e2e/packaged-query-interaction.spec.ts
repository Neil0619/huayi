import { expect, test } from "@playwright/test";

// CI uses its own release build. Local delivery checks explicitly target the installed Hosted
// directory so source-only fixes cannot stand in for updating the unpacked Chrome installation.
const profile = process.env.HUAYI_STORE_E2E_PACKAGE_PROFILE === "hosted" ? "hosted" : "release";
test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 700 });
  await page.goto(`/apps/store-extension/e2e/fixtures/query-interaction.html?package=${profile}`);
  await expect(page.locator("body")).toHaveAttribute("data-packaged-ready", "true");
  await page.locator("#original").click({ clickCount: 3 });
  await expect(page.locator("[data-huayi-store-overlay]")).toBeVisible();
});

test("packaged mouse selection does not focus the explanation button", async ({ page }) => {
  const action = page.locator("[data-huayi-store-overlay] [data-action=explain]");
  await expect(action).not.toBeFocused();
  expect(await action.evaluate((element) => element.matches(":focus-visible"))).toBe(false);
  await page.keyboard.press("Tab");
  await expect(action).toBeFocused();
  expect(await action.evaluate((element) => element.matches(":focus-visible"))).toBe(true);
});

for (const direction of ["forward", "backward"] as const) {
  test(`packaged multiline ${direction} selection places actions at the mouse release`, async ({
    page,
  }) => {
    const lines = await page.locator("#multi-line").evaluate((element) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      return Array.from(range.getClientRects(), (rect) => ({
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
      }));
    });
    const first = lines[0];
    const last = lines.at(-1);
    if (!first || !last || first.top === last.top) throw new Error("Expected wrapped text.");
    const start = { x: first.left + 2, y: (first.top + first.bottom) / 2, bottom: first.bottom };
    const end = { x: last.right - 2, y: (last.top + last.bottom) / 2, bottom: last.bottom };
    const [from, release] = direction === "forward" ? [start, end] : [end, start];
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(release.x, release.y, { steps: 8 });
    await page.mouse.up();
    const panel = page.locator("[data-huayi-store-overlay]");
    await expect(panel).toBeVisible();
    await expect
      .poll(async () => {
        const box = await panel.boundingBox();
        return box ? Math.abs(box.x + box.width / 2 - release.x) : Infinity;
      })
      .toBeLessThanOrEqual(4);
    const box = await panel.boundingBox();
    expect(box?.y).toBeGreaterThanOrEqual(release.bottom);
    expect(box?.y).toBeLessThanOrEqual(release.bottom + 12);
  });
}

test("packaged cards survive small wheel deltas and dock when their selection leaves the viewport", async ({
  page,
}) => {
  const panel = page.locator("[data-huayi-store-overlay]");
  await page.mouse.move(870, 200);
  for (const delta of [2, 4, 8, 16, 32]) {
    await page.mouse.wheel(0, delta);
    await expect(panel).toBeVisible();
  }
  await page.mouse.wheel(0, 500);
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(400);
  await expect(panel).toBeVisible();
  expect((await panel.boundingBox())?.y).toBeGreaterThanOrEqual(0);
});

test("packaged content preserves whitespace increments through completion and cached reopen", async ({
  page,
}) => {
  const panel = page.locator("[data-huayi-store-overlay]");
  await panel.locator("[data-action=explain]").click();
  await expect(panel).toContainText("主语与谓语已经可以阅读。");
  await expect(panel).toContainText("Juanma Moreno 表示至少十二人遇难。");
  await expect(panel.locator("[data-retry]")).toHaveCount(0);
  await expect(panel.locator("[data-stop]")).toBeVisible();
  await expect(page.locator("body")).toHaveAttribute("data-calls", "1");
  await expect(panel).not.toContainText("新闻中补充信息来源。");
  await page.evaluate(() => window.queryFixture.finish());
  await expect(panel).toContainText("新闻中补充信息来源。");
  await expect(panel.locator("[data-stop]")).toBeHidden();
  const overflow = await panel
    .locator(".panel")
    .evaluate((element) => element.scrollWidth - element.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await page.mouse.click(880, 680);
  await expect(panel).toHaveCount(0);
  await page.locator("#original").click({ clickCount: 3 });
  await panel.locator("[data-action=explain]").click();
  await expect(panel).toContainText("新闻中补充信息来源。");
  await expect(page.locator("body")).toHaveAttribute("data-calls", "1");
});

test("packaged stop confirmation clears pending guidance and enables stop for a retry", async ({
  page,
}) => {
  const panel = page.locator("[data-huayi-store-overlay]");
  await panel.locator("[data-action=explain]").click();
  await expect(panel).toContainText("Juanma Moreno 表示至少十二人遇难。");
  await panel.locator("[data-stop]").click();
  await expect(panel).toContainText("分析已取消。");
  await expect(panel).not.toContainText("等待服务器确认");
  await expect(panel).toContainText("主语与谓语已经可以阅读。");
  await panel.locator("[data-retry]").click();
  await expect(page.locator("body")).toHaveAttribute("data-calls", "2");
  await expect(panel.locator("[data-stop]")).toBeVisible();
  await expect(panel.locator("[data-stop]")).toBeEnabled();
  await page.evaluate(() => window.queryFixture.finish());
  await expect(panel).toContainText("新闻中补充信息来源。");
  await expect(panel.locator("[data-stop]")).toBeHidden();
});

test("packaged word cards give comparisons full width and dismiss outside without a close button", async ({
  page,
}, testInfo) => {
  await page.keyboard.press("Escape");
  await page.locator("#original").evaluate((element) => {
    element.textContent = "reasoning";
  });
  await page.locator("#original").click({ clickCount: 3 });
  const panel = page.locator("[data-huayi-store-overlay]");
  await panel.locator("[data-action=translate]").click();
  await expect(panel.locator("[data-result-layout=comparisons] .result-entry")).toHaveCount(2);
  await page.evaluate(() => window.queryFixture.finish());
  await expect(panel.locator("[data-stop]")).toBeHidden();
  await expect(panel.locator("[data-close]")).toHaveCount(0);
  expect((await panel.locator(".header").boundingBox())?.height).toBeLessThan(65);
  const comparisons = panel.locator("[data-result-layout=comparisons]");
  const width = (await comparisons.boundingBox())?.width ?? Infinity;
  for (const detail of await comparisons.locator(".result-entry-detail").all()) {
    expect((await detail.boundingBox())?.width).toBeGreaterThanOrEqual(width - 1);
  }
  await panel.screenshot({ path: testInfo.outputPath("word-card.png") });
  await page.mouse.click(880, 680);
  await expect(panel).toHaveCount(0);
});
