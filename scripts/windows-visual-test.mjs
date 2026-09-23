import { expect, test as base } from "@playwright/test";

export { expect };

// Match the Windows screenshot environment without rewriting product styles or
// installing fonts. Explicit CSS font families still take precedence.
export const test = base.extend({
  launchOptions: async ({ launchOptions }, use) => {
    await use(
      process.platform === "win32"
        ? { ...launchOptions, args: [...(launchOptions.args ?? []), "--disable-gpu"] }
        : launchOptions,
    );
  },
  page: async ({ page }, use) => {
    if (process.platform === "win32") {
      const session = await page.context().newCDPSession(page);
      const fontFamilies = { serif: "Microsoft YaHei", sansSerif: "Microsoft YaHei" };
      await session.send("Page.setFontFamilies", {
        fontFamilies,
        forScripts: [{ script: "Hans", fontFamilies }],
      });
    }
    await use(page);
  },
});
