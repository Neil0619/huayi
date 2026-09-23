import { expect, test, type Page } from "@playwright/test";

import { denyOfficialLocalFonts } from "./support/asbplayer-browser-controls.js";

test.use({ screenshot: "off", trace: "off" });

async function fontPermission(page: Page) {
  return page.evaluate(async () => {
    const permission = await navigator.permissions.query({ name: "local-fonts" as PermissionName });
    return permission.state;
  });
}

test("official font denial survives setup and permits fullscreen without leaking to other origins or contexts", async ({
  browser,
}) => {
  const context = await browser.newContext();
  const independent = await browser.newContext();
  for (const current of [context, independent]) {
    await current.route("**/*", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: '<!doctype html><button onclick="document.documentElement.requestFullscreen()">Fullscreen</button>',
      }),
    );
  }
  try {
    const page = await context.newPage();
    const other = await context.newPage();
    const separate = await independent.newPage();
    await page.goto("https://app.asbplayer.dev/");
    await other.goto("https://example.test/");
    await separate.goto("https://app.asbplayer.dev/");
    const otherBefore = await fontPermission(other);
    const separateBefore = await fontPermission(separate);

    await denyOfficialLocalFonts(context);

    expect(await fontPermission(page)).toBe("denied");
    expect(await fontPermission(other)).toBe(otherBefore);
    expect(await fontPermission(separate)).toBe(separateBefore);
    expect(
      await page.evaluate(async () => {
        const query = Reflect.get(window, "queryLocalFonts");
        if (typeof query !== "function") throw new Error("Local font API is unavailable.");
        const fonts: unknown = await query.call(window);
        return Array.isArray(fonts) ? fonts.length : null;
      }),
    ).toBe(0);
    await page.bringToFront();
    await page.getByRole("button", { name: "Fullscreen" }).click();
    await expect.poll(() => page.evaluate(() => Boolean(document.fullscreenElement))).toBe(true);
  } finally {
    await context.close();
    await independent.close();
  }
});
