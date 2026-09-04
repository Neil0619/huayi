import { expect, test } from "@playwright/test";

import { createCloudBrowserAuthority } from "./support/cloud-browser-authority.js";

const origin = "https://web.huayi.invalid";
const themes = ["moon", "silver", "champagne", "porcelain"] as const;

test("inbox content and account sidebar stay compact in all four themes", async ({ page }) => {
  const authority = createCloudBrowserAuthority({ authenticated: true, seed: "dialogue-practice" });
  await authority.install(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  for (const theme of themes) {
    await page.goto(`${origin}/app`);
    await page.evaluate((value) => localStorage.setItem("huayi.web.appearance.v1", value), theme);
    await page.reload();
    await expect(page.getByRole("heading", { name: "还没有待分析内容" })).toBeVisible();
    await page.evaluate(() => {
      const notice = document.createElement("div");
      notice.className = "acceptance-environment-notice";
      notice.textContent = "Hosted 验收环境";
      document.body.prepend(notice);
    });
    const layout = await page.evaluate(() => ({
      firstContent: document.querySelector(".empty-state")?.getBoundingClientRect().top,
      headingSize: getComputedStyle(document.querySelector("h1") as HTMLElement).fontSize,
      overflow: document.documentElement.scrollWidth - innerWidth,
      filterInToolbar: document.querySelector(".study-inbox-toolbar select") !== null,
    }));
    expect(layout.firstContent).toBeLessThanOrEqual(240);
    expect(layout.headingSize).toBe("28px");
    expect(layout.overflow).toBeLessThanOrEqual(0);
    expect(layout.filterInToolbar).toBe(true);
    await expect(page).toHaveScreenshot(`inbox-${theme}.png`, { animations: "disabled" });
  }
  const reviewTab = page.getByRole("tab", { name: "待收藏", exact: true });
  await reviewTab.focus();
  await page.keyboard.press("Enter");
  await expect(reviewTab).toBeFocused();
  await expect(reviewTab).toHaveAttribute("aria-selected", "true");
  const captureTab = page.getByRole("tab", { name: "待分析", exact: true });
  await captureTab.focus();
  await page.keyboard.press("Space");
  await expect(captureTab).toBeFocused();
  await expect(captureTab).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("heading", { name: "还没有待分析内容" })).toBeVisible();
  await page.goto(`${origin}/settings/account`);
  await expect(page.getByRole("heading", { name: "当前账号" })).toBeVisible();
  const navigation = await page.getByRole("navigation", { name: "账号设置" }).boundingBox();
  expect(Math.round(navigation?.width ?? 0)).toBe(208);
  expect((await page.locator(".account-summary-card").boundingBox())?.y).toBeLessThanOrEqual(240);
  await expect(page).toHaveScreenshot("settings-desktop.png", { animations: "disabled" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.getByRole("heading", { name: "当前账号" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "账号设置" })).toBeHidden();
  await page.locator(".account-settings-disclosure > summary").click();
  await expect(page.getByRole("navigation", { name: "账号设置" })).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
  ).toBeLessThanOrEqual(0);
  await expect(page).toHaveScreenshot("settings-mobile.png", { animations: "disabled" });
});
