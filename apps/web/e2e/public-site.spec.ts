import { expect, test, type Page } from "@playwright/test";
import { serveCloudWebDist } from "./support/cloud-browser-web-fixture.js";

const origin = "https://web.huayi.invalid";
const themes = ["silver", "moon", "champagne", "porcelain"] as const;

async function installOfflineSite(page: Page) {
  const unexpected: string[] = [];
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (
      url.origin === origin &&
      (url.pathname.startsWith("/assets/") ||
        ["/", "/guide", "/privacy", "/login"].includes(url.pathname))
    ) {
      await serveCloudWebDist(route);
    } else {
      unexpected.push(`${route.request().method()} ${url.origin}${url.pathname}`);
      await route.abort();
    }
  });
  return { unexpected, errors };
}

async function expectNoOverflow(page: Page, width: number) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    width,
  );
}

for (const width of [320, 390, 768, 1440]) {
  for (const theme of themes) {
    test(`public pages at ${width}px in ${theme}`, async ({ page }, info) => {
      await page.setViewportSize({ width, height: 900 });
      const observed = await installOfflineSite(page);
      await page.goto(origin);
      await expect(page.getByRole("heading", { level: 1 })).toContainText("把看见的英文");
      const appearance = page.locator(".appearance-menu > summary");
      await appearance.click();
      await page.locator(`.appearance-options input[value="${theme}"]`).check();
      await expect(page.locator("html")).toHaveAttribute("data-appearance", theme);
      await expectNoOverflow(page, width);
      await appearance.press("Escape");
      await page.getByRole("button", { name: "02 看懂", exact: true }).click();
      await expect(page.locator(".site-example-body")).toContainText("为值得的事留出时间");
      await page.getByRole("button", { name: "03 用出来", exact: true }).click();
      await expect(page.locator(".site-example-body")).toContainText(
        "I make time for reading every evening.",
      );
      await expectNoOverflow(page, width);
      await page.screenshot({
        path: info.outputPath(`home-${theme}-${width}.png`),
        animations: "disabled",
        fullPage: true,
      });
      await page
        .getByRole("navigation", { name: "官网导航", exact: true })
        .getByRole("link", { name: "使用帮助", exact: true })
        .click();
      await expect(page).toHaveURL(`${origin}/guide`);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(
        "从一句英文，开始使用语见。",
      );
      await expect(page.locator("html")).toHaveAttribute("data-appearance", theme);
      await page.getByText("官网示例会使用我的模型额度吗？", { exact: true }).click();
      await expect(page.locator("details[open].site-faq")).toContainText("不会");
      await expectNoOverflow(page, width);
      await page.screenshot({
        path: info.outputPath(`guide-${theme}-${width}.png`),
        animations: "disabled",
        fullPage: true,
      });
      await page.getByRole("link", { name: "阅读完整隐私说明" }).click();
      await expect(page).toHaveURL(`${origin}/privacy`);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      expect(observed).toEqual({ unexpected: [], errors: [] });
    });
  }
}

test("keyboard navigation and reduced motion remain usable", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const observed = await installOfflineSite(page);
  await page.goto(origin);
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "跳到主要内容", exact: true });
  await expect(skip).toBeFocused();
  await expect(skip).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.locator("#site-content")).toBeFocused();
  const sample = page.getByRole("button", { name: "02 看懂", exact: true });
  await sample.focus();
  expect(await sample.evaluate((node) => getComputedStyle(node).outlineStyle)).not.toBe("none");
  await page.keyboard.press("Enter");
  await expect(sample).toHaveAttribute("aria-pressed", "true");
  const duration = await sample.evaluate((node) => getComputedStyle(node).transitionDuration);
  expect(parseFloat(duration)).toBeLessThanOrEqual(0.001);
  expect(observed).toEqual({ unexpected: [], errors: [] });
});

for (const viewport of [
  { width: 844, height: 390 },
  { width: 390, height: 844 },
]) {
  test(`text at 200 percent in ${viewport.width}x${viewport.height}`, async ({ page }, info) => {
    await page.setViewportSize(viewport);
    const observed = await installOfflineSite(page);
    await page.goto(origin);
    await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
    await page.getByRole("button", { name: "03 用出来", exact: true }).click();
    await expectNoOverflow(page, viewport.width);
    await page.locator(".appearance-menu > summary").click();
    await expectNoOverflow(page, viewport.width);
    await page.locator(".appearance-menu > summary").press("Escape");
    await page.screenshot({
      path: info.outputPath("home-text-200.png"),
      animations: "disabled",
      fullPage: true,
    });
    await page.goto(`${origin}/guide`);
    await page.addStyleTag({ content: "html { font-size: 200% !important; }" });
    await expectNoOverflow(page, viewport.width);
    await page.screenshot({
      path: info.outputPath("guide-text-200.png"),
      animations: "disabled",
      fullPage: true,
    });
    expect(observed).toEqual({ unexpected: [], errors: [] });
  });
}
