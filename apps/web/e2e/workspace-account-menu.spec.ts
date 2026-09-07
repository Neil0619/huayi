import { expect, test, type Page } from "@playwright/test";

import { createCloudBrowserAuthority } from "./support/cloud-browser-authority.js";
import { cloudCors } from "./support/cloud-browser-authority-request.js";

const webOrigin = "https://web.huayi.invalid";
const appearances = ["champagne", "moon", "porcelain", "silver"];

async function addHostedNotice(page: Page) {
  await page.evaluate(() => {
    const notice = document.createElement("aside");
    notice.className = "acceptance-environment-notice";
    notice.setAttribute("role", "status");
    const version = document.createElement("strong");
    version.textContent = "Hosted 验收 · fd2dc6e";
    const description = document.createElement("span");
    description.textContent = "真实托管验收环境；当前版本不是正式生产发布。";
    notice.append(version, description);
    document.querySelector("#root")?.prepend(notice);
  });
}

test("workspace account stays visible, fits every theme and exits with the existing CSRF contract", async ({
  page,
}, testInfo) => {
  test.slow();
  const authority = createCloudBrowserAuthority({ authenticated: true, seed: "empty" });
  await authority.install(page);
  let loggedOut = false;
  await page.route("https://api.huayi.invalid/v1/auth/logout", async (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers: cloudCors(request.headers().origin) ?? {} });
      return;
    }
    expect(request.method()).toBe("POST");
    expect(request.headers()["x-csrf-token"]).toBe("cloud-e2e-csrf-token-000000000000");
    expect(request.headers().cookie).toBeTruthy();
    loggedOut = true;
    await route.fulfill({ status: 204, headers: cloudCors(request.headers().origin) ?? {} });
  });
  await page.goto(`${webOrigin}/app`);
  for (const width of [320, 390, 768, 769, 1280, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const appearance of appearances) {
      await page.evaluate(
        (value) => localStorage.setItem("huayi.web.appearance.v1", value),
        appearance,
      );
      await page.reload();
      const trigger = page.getByRole("button", { name: "账户菜单 · learner@example.com" });
      await expect(trigger).toBeVisible();
      await expect(trigger.locator(".workspace-account-label")).toHaveCSS("font-size", "13px");
      expect(
        await trigger.locator(".workspace-account-avatar").evaluate((element) => {
          const reference = document.createElement("span");
          reference.style.color = "var(--text-on-action)";
          document.body.append(reference);
          const matches = getComputedStyle(element).color === getComputedStyle(reference).color;
          reference.remove();
          return matches;
        }),
      ).toBe(true);
      await addHostedNotice(page);
      await trigger.click();
      const menu = page.getByRole("menu");
      await expect(menu.getByRole("menuitem")).toHaveText([
        "账号与用量",
        "扩展设备",
        "数据与账号",
        "退出登录",
      ]);
      await expect(menu.getByRole("menuitem", { name: "账号与用量" })).toBeFocused();
      expect(
        await page.evaluate(() => {
          const triggerBox = document
            .querySelector(".workspace-account-trigger")
            ?.getBoundingClientRect();
          const menuBox = document
            .querySelector(".workspace-account-popover")
            ?.getBoundingClientRect();
          const notice = document
            .querySelector(".acceptance-environment-notice")
            ?.getBoundingClientRect();
          return {
            fits: document.documentElement.scrollWidth <= innerWidth,
            menuFits: !!menuBox && menuBox.left >= 0 && menuBox.right <= innerWidth,
            clearsNotice: !!triggerBox && !!notice && triggerBox.top >= notice.bottom,
            touchSize: !!triggerBox && triggerBox.height >= 44,
          };
        }),
      ).toEqual({ fits: true, menuFits: true, clearsNotice: true, touchSize: true });
      if (appearance === "silver" && (width === 390 || width === 1440))
        await page.screenshot({ path: testInfo.outputPath(`account-${width}.png`) });
      await menu.press("Escape");
      await expect(trigger).toBeFocused();
      await expect(menu).toHaveCount(0);
      await page.locator(".appearance-menu > summary").click();
      await expect(page.getByRole("group", { name: "外观" })).toBeVisible();
      expect(
        await page.getByRole("group", { name: "外观" }).evaluate((element) => {
          const box = element.getBoundingClientRect();
          return box.left >= 0 && box.right <= innerWidth;
        }),
      ).toBe(true);
      await page.locator(".appearance-menu > summary").press("Escape");
    }
  }
  const trigger = page.getByRole("button", { name: "账户菜单 · learner@example.com" });
  await trigger.press("ArrowDown");
  await page.getByRole("menu").press("Tab");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await trigger.click();
  await page.getByRole("heading", { name: "收集箱", level: 1 }).click();
  await expect(page.getByRole("menu")).toHaveCount(0);
  await trigger.click();
  await page.getByRole("menuitem", { name: "扩展设备" }).click();
  await expect(page).toHaveURL(`${webOrigin}/settings/devices`);
  await expect(trigger).toBeVisible();
  await expect(page.getByRole("menu")).toHaveCount(0);
  await trigger.click();
  await page.getByRole("menuitem", { name: "退出登录" }).click();
  await expect(page.getByRole("heading", { name: "需要先登录" })).toBeVisible();
  await expect(trigger).toHaveCount(0);
  expect(loggedOut).toBe(true);
});

for (const width of [390, 1440])
  test(`signed-out login action clears the Hosted banner at ${width}px`, async ({
    page,
  }, testInfo) => {
    const authority = createCloudBrowserAuthority({ authenticated: false, seed: "empty" });
    await authority.install(page);
    await page.goto(`${webOrigin}/app`);
    await page.setViewportSize({ width, height: 900 });
    for (const appearance of appearances) {
      await page.evaluate(
        (value) => localStorage.setItem("huayi.web.appearance.v1", value),
        appearance,
      );
      await page.reload();
      const login = page.getByRole("link", { name: "前往登录" });
      await expect(login).toHaveClass("primary-button");
      await addHostedNotice(page);
      const geometry = await page.evaluate(() => {
        const notice = document
          .querySelector(".acceptance-environment-notice")
          ?.getBoundingClientRect();
        const appearance = document
          .querySelector(".appearance-menu > summary")
          ?.getBoundingClientRect();
        const card = document.querySelector(".configuration-error")?.getBoundingClientRect();
        if (!notice || !appearance || !card) throw new Error("Expected signed-out layout.");
        return {
          appearanceTop: appearance.top,
          noticeBottom: notice.bottom,
          appearanceBottom: appearance.bottom,
          cardTop: card.top,
          fits: document.documentElement.scrollWidth <= innerWidth,
        };
      });
      expect(geometry.appearanceTop).toBeGreaterThanOrEqual(geometry.noticeBottom);
      expect(geometry.cardTop).toBeGreaterThanOrEqual(geometry.appearanceBottom);
      expect(geometry.fits).toBe(true);
      await expect(login).toHaveCSS("text-decoration-line", "none");
      await expect(login).toHaveCSS("display", "flex");
      expect(
        await login.evaluate((element) => {
          const css = getComputedStyle(element);
          return css.color !== css.backgroundColor && element.getBoundingClientRect().height >= 44;
        }),
      ).toBe(true);
      if (appearance === "silver")
        await page.screenshot({ path: testInfo.outputPath(`login-${width}.png`) });
    }
    await page.getByRole("link", { name: "前往登录" }).click();
    await expect(page).toHaveURL(`${webOrigin}/login`);
  });
