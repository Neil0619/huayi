import { expect, test } from "@playwright/test";

import { createCloudBrowserAuthority } from "./support/cloud-browser-authority.js";

test.beforeEach(async ({ page }) => {
  const authority = createCloudBrowserAuthority({
    authenticated: true,
    seed: "pending-pairing-approval",
  });
  await authority.install(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("https://web.huayi.invalid/pair-extension/pairing-approval-1");
  await expect(page.getByLabel("设备名称", { exact: true })).toBeVisible();
});

test("pairing supplies an editable device name without collecting machine details", async ({
  page,
}) => {
  const name = page.getByLabel("设备名称", { exact: true });
  await expect(name).toHaveValue("我的 Chrome 浏览器");
  await name.fill("书房电脑");
  await expect(name).toHaveValue("书房电脑");
});

test("pairing fields occupy separate full-width rows without overflow", async ({ page }) => {
  const fields = page.locator("form input[name=deviceLabel], form select");
  const boxes = await fields.evaluateAll((elements) =>
    elements.map((element) => {
      const { x, y, width, height } = element.getBoundingClientRect();
      return { x, y, width, height };
    }),
  );
  expect(boxes).toHaveLength(4);
  const first = boxes[0];
  if (first === undefined) throw new Error("Device field missing");
  for (const [index, box] of boxes.entries()) {
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.width).toBeGreaterThan(250);
    expect(Math.abs(box.x - first.x)).toBeLessThanOrEqual(1);
    const previous = boxes[index - 1];
    if (previous !== undefined) expect(box.y).toBeGreaterThan(previous.y + previous.height);
  }
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
  ).toBeLessThanOrEqual(0);
});

test("pairing keeps four themes readable and help usable on desktop and narrow screens", async ({
  page,
}) => {
  for (const theme of ["moon", "silver", "champagne", "porcelain"]) {
    await page.evaluate((value) => localStorage.setItem("huayi.web.appearance.v1", value), theme);
    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(viewport);
      await page.reload();
      await expect(page.getByRole("heading", { name: "连接语见插件" })).toBeVisible();
      await expect(page.locator(".pairing-privacy > p").first()).toBeHidden();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
      ).toBeLessThanOrEqual(0);
      await expect(page).toHaveScreenshot(`pairing-${theme}-${viewport.width}.png`, {
        animations: "disabled",
        fullPage: true,
      });
    }
  }
  const help = page.getByRole("button", { name: "设备名称说明" });
  await help.focus();
  await expect(page.getByRole("tooltip")).toContainText("方便辨认");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  await expect(help).toBeFocused();
  const privacy = page.getByText("数据与隐私详情", { exact: true });
  await privacy.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText(/最多保留一小时/u)).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(page.getByText(/最多保留一小时/u)).toBeHidden();
  await page.setViewportSize({ width: 320, height: 720 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
  ).toBeLessThanOrEqual(0);
});
