import { expect, test } from "@playwright/test";

import { createCloudBrowserAuthority } from "./support/cloud-browser-authority.js";

const apiOrigin = "https://api.huayi.invalid";
const downloadToken = "private-download-token";
const signedDownloadUrl = `https://download.huayi.invalid/account-export.txt?token=${downloadToken}`;
const webOrigin = "https://web.huayi.invalid";

test("an account owner exports data and permanently deletes the account", async ({
  context,
  page,
}) => {
  const authority = createCloudBrowserAuthority({ authenticated: true, seed: "empty" });
  await page.setViewportSize({ height: 844, width: 390 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await context.route("https://download.huayi.invalid/**", async (route) => {
    await route.fulfill({
      body: "private account export fixture",
      contentType: "text/plain; charset=utf-8",
      status: 200,
    });
  });
  await authority.install(page);

  await page.goto(`${webOrigin}/settings/data`);
  await expect(page.getByRole("heading", { name: "导出与永久删除", level: 1 })).toBeVisible();
  expect(
    await page.locator(".danger-zone").evaluate((element) => {
      const computed = getComputedStyle(element);
      return { borderColor: computed.borderColor, borderStyle: computed.borderStyle };
    }),
  ).toEqual({ borderColor: "rgb(152, 74, 91)", borderStyle: "solid" });
  await expect(page.getByRole("heading", { name: "尚未请求完整数据导出" })).toBeVisible();
  await page.getByRole("button", { name: "请求完整数据导出" }).click();
  await expect(page.getByRole("heading", { name: "正在等待生成" })).toBeVisible();

  await page.reload();
  await expect(page.getByRole("heading", { name: "可以下载" })).toBeVisible();
  const popupPromise = page.waitForEvent("popup");
  await page.getByRole("button", { name: "取得 15 分钟下载地址" }).click();
  const popup = await popupPromise;
  await expect(popup).toHaveURL(signedDownloadUrl);
  await expect(popup.locator("body")).toContainText("private account export fixture");
  await expect(page.getByRole("status").filter({ hasText: "一次性下载地址" })).toBeAttached();
  expect(await page.locator("body").textContent()).not.toContain(downloadToken);

  await page.getByLabel("我理解删除不可撤销，并已自行保存所需数据").check();
  await page.getByLabel("输入“删除我的账号”以继续").fill("删除我的账号");
  await page.getByRole("button", { name: "进入最终确认" }).click();
  const confirm = page.getByRole("button", { name: "永久删除我的账号" });
  await expect(confirm).toBeFocused();
  await confirm.click();

  await expect(page.getByRole("heading", { name: "需要先登录", level: 1 })).toBeVisible();
  await expect(page.getByRole("heading", { name: "导出与永久删除" })).toHaveCount(0);
  const postDeletionStatus = await page.evaluate(async (origin) => {
    const response = await fetch(`${origin}/v1/account-data-exports/current`, {
      credentials: "include",
    });
    return response.status;
  }, apiOrigin);
  expect(postDeletionStatus).toBe(401);

  const snapshot = authority.snapshot();
  for (const path of [
    "/v1/account-data-exports",
    "/v1/account-data-exports/export-1/download-url",
    "/v1/account-deletion",
  ]) {
    expect(snapshot.requestFacts).toContainEqual({
      authenticatedAs: "web",
      method: "POST",
      path,
      proof: "write-valid",
    });
  }
  expect(JSON.stringify(snapshot)).not.toContain(downloadToken);
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
