import { expect, test } from "@playwright/test";
import { createCloudBrowserAuthority } from "./support/cloud-browser-authority.js";

for (const width of [390, 1280])
  test(`WeChat linking guides direct mini-program login at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 });
    const authority = createCloudBrowserAuthority({
      authenticated: true,
      seed: "password-only-sign-in-methods",
    });
    await authority.install(page);
    await page.goto("https://web.huayi.invalid/settings/account");
    const panel = page.getByRole("region", { name: "微信小程序关联" });
    await expect(panel).toContainText("登录并关联");
    await expect(panel).toContainText("无需在网页重复验证");
    await expect(panel.locator("input")).toHaveCount(0);
    await panel.scrollIntoViewIfNeeded();
    expect(await panel.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
      true,
    );
    await panel.screenshot({ path: info.outputPath(`wechat-binding-${width}.png`) });
    expect(authority.snapshot().requestFacts).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ method: "POST", path: "/v1/auth/reauthenticate/password" }),
      ]),
    );
  });
