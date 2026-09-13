import { expect, test } from "@playwright/test";
import { createCloudBrowserAuthority } from "./support/cloud-browser-authority.js";

for (const width of [390, 1440]) {
  test(`library navigation has selected buttons and keyboard access at ${width}px`, async ({
    page,
  }, testInfo) => {
    await createCloudBrowserAuthority({ authenticated: true, seed: "dialogue-practice" }).install(
      page,
    );
    await page.setViewportSize({ width, height: 900 });
    await page.goto("https://web.huayi.invalid/library");
    const navigation = page.getByRole("navigation", { name: "学习库导航" });
    const expressions = navigation.getByRole("link", { name: "表达与句型", exact: true });
    const words = navigation.getByRole("link", { name: "生词", exact: true });
    await expect(expressions).toHaveAttribute("aria-current", "page");
    await expect(words).not.toHaveAttribute("aria-current", "page");
    await expect(expressions).toHaveCSS("text-decoration-line", "none");
    await expect(expressions).toHaveCSS("border-top-style", "solid");
    expect((await expressions.boundingBox())?.height).toBeGreaterThanOrEqual(44);
    await expressions.focus();
    await expressions.press("Tab");
    await expect(words).toBeFocused();
    await words.press("Enter");
    await expect(words).toHaveAttribute("aria-current", "page");
    await expect(expressions).not.toHaveAttribute("aria-current", "page");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.screenshot({ path: testInfo.outputPath("library-buttons.png"), fullPage: true });
  });
}
