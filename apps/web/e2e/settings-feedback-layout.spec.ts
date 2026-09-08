import { expect, test, type Locator } from "@playwright/test";

import { createCloudBrowserAuthority } from "./support/cloud-browser-authority.js";

const origin = "https://web.huayi.invalid";

async function expectThemedLink(link: Locator) {
  await expect(link).toBeVisible();
  const style = await link.evaluate((element) => {
    const computed = getComputedStyle(element);
    return {
      color: computed.color,
      expectedColor: getComputedStyle(document.documentElement).color,
      height: element.getBoundingClientRect().height,
      decoration: computed.textDecorationLine,
    };
  });
  expect(style.color).toBe(style.expectedColor.trim());
  expect(style.height).toBeGreaterThanOrEqual(36);
  expect(style.decoration).toBe("none");
  await link.focus();
  await expect(link).toBeFocused();
  expect(await link.evaluate((element) => getComputedStyle(element).outlineStyle)).toBe("solid");
}

test("login recovery and privacy links use themed controls", async ({ page }) => {
  await createCloudBrowserAuthority({
    authenticated: false,
    seed: "password-authentication",
  }).install(page);
  await page.goto(`${origin}/login`);
  await expectThemedLink(page.getByRole("link", { name: "忘记密码？" }));
  await expectThemedLink(page.getByRole("link", { name: "隐私说明" }));
  await page.getByRole("heading", { name: "登录语见" }).click();
  await page.screenshot({ path: test.info().outputPath("login.png"), fullPage: true });
});

test("settings keep readable values and separate practice from extension choices", async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem("huayi.web.appearance.v1", "porcelain");
  });
  await createCloudBrowserAuthority({ authenticated: true, seed: "dialogue-practice" }).install(
    page,
  );
  for (const viewport of [
    { width: 1440, height: 1000 },
    { width: 375, height: 812 },
    { width: 812, height: 375 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto(`${origin}/settings/account`);
    await expect(page.getByRole("heading", { name: "当前账号" })).toBeVisible();
    const weights = await page
      .locator(".account-summary-card dd, .quota-metrics dd, .quota-warning")
      .evaluateAll((elements) =>
        elements.map((element) => Number(getComputedStyle(element).fontWeight)),
      );
    expect(weights.every((weight) => weight <= 650)).toBe(true);
    const practice = page.getByRole("group", { name: "每日练习", exact: true });
    const extension = page.getByRole("group", { name: "扩展行为", exact: true });
    await expect(practice.getByLabel("所在时区", { exact: true })).toHaveCount(0);
    await expect(practice).toContainText("统一按北京时间安排每日练习");
    await expect(practice.getByLabel("每日练习目标", { exact: true })).toBeVisible();
    await expect(extension.getByRole("combobox")).toHaveCount(3);
    for (const control of await page
      .locator(".account-preferences-card input, .account-preferences-card select")
      .all()) {
      const measured = await control.evaluate((element) => ({
        height: element.getBoundingClientRect().height,
        weight: Number(getComputedStyle(element).fontWeight),
        padding: parseFloat(getComputedStyle(element).paddingLeft),
      }));
      expect(measured.height).toBeGreaterThanOrEqual(44);
      expect(measured.weight).toBeLessThanOrEqual(500);
      expect(measured.padding).toBeGreaterThanOrEqual(12);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: test.info().outputPath(`settings-${viewport.width}.png`),
      fullPage: true,
    });
    if (viewport.width === 1440) {
      await page
        .locator(".account-preferences-card")
        .screenshot({ path: test.info().outputPath("preferences-desktop.png") });
    }
  }
});

test("operations log navigation matches the console and filters keep labels together", async ({
  page,
}) => {
  await createCloudBrowserAuthority({ authenticated: true, seed: "operator-console" }).install(
    page,
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${origin}/admin`);
  await expect(page.getByRole("heading", { name: "运营控制台", exact: true })).toBeVisible();
  await expectThemedLink(page.getByRole("link", { name: "报错日志", exact: true }));
  const email = await page.getByLabel("邮箱搜索").boundingBox();
  const emailLabel = await page.locator('label[for="admin-email-query"]').boundingBox();
  expect(emailLabel).not.toBeNull();
  expect(Math.abs((email?.x ?? 0) - (emailLabel?.x ?? 0))).toBeLessThanOrEqual(1);
  await page.getByRole("heading", { name: "运营控制台", exact: true }).click();
  await page.screenshot({ path: test.info().outputPath("operations.png") });
});

for (const theme of ["moon", "silver", "champagne", "porcelain"]) {
  test(`preference controls remain legible with ${theme} appearance`, async ({ page }) => {
    await page.addInitScript(
      (value) => localStorage.setItem("huayi.web.appearance.v1", value),
      theme,
    );
    await createCloudBrowserAuthority({ authenticated: true, seed: "dialogue-practice" }).install(
      page,
    );
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(`${origin}/settings/account`);
    const select = page.getByLabel("扩展使用哪种模型", { exact: true });
    await expect(select).toBeVisible();
    const colors = await select.evaluate((element) => ({
      foreground: getComputedStyle(element).color,
      background: getComputedStyle(element).backgroundColor,
      text: getComputedStyle(document.documentElement).color,
    }));
    expect(colors.foreground).toBe(colors.text);
    expect(colors.background).not.toBe("rgba(0, 0, 0, 0)");
    await select.focus();
    expect(await select.evaluate((element) => getComputedStyle(element).outlineStyle)).toBe(
      "solid",
    );
    await page.keyboard.press("Tab");
    await expect(page.getByLabel("如何加入待整理", { exact: true })).toBeFocused();
  });
}
