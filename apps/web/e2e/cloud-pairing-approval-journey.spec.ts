import { expect, test } from "@playwright/test";

import { createCloudBrowserAuthority } from "./support/cloud-browser-authority.js";

const deviceLabel = "Writing laptop";
const pairingId = "pairing-approval-1";
const webOrigin = "https://web.huayi.invalid";

test("pairing approval atomically selects preferences and reloads from approved state", async ({
  page,
}) => {
  const authority = createCloudBrowserAuthority({
    authenticated: true,
    seed: "pending-pairing-approval",
  });
  await page.setViewportSize({ height: 844, width: 390 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await authority.install(page);

  await page.goto(`${webOrigin}/pair-extension/${pairingId}`);
  await expect(page.getByRole("heading", { name: "连接语见插件" })).toBeVisible();
  await expect(page.getByText(/账号的所有已连接插件/u)).toBeVisible();
  await expect(page.getByText(/计入账号额度/u)).toBeVisible();
  await expect(page.getByText(/最多保留一小时/u)).toBeHidden();
  await page.getByText("数据与隐私详情", { exact: true }).click();
  await expect(page.getByText(/所选英文及必要语境.*最多保留一小时/u)).toBeVisible();
  await expect(page.getByText(/密钥和该次查询结果不会发送给语见/u)).toBeVisible();
  await expect(page.getByText(/不会上传页面地址、标题、视频编号或完整页面/u)).toBeVisible();
  await expect(page.getByLabel("插件查询模型")).toHaveValue("platform");
  await expect(page.getByLabel("句子与段落收集")).toHaveValue("manual");
  await expect(page.getByLabel("生词云端保存")).toHaveValue("enabled");

  const submit = page.getByRole("button", { name: "确认连接" });
  await page.getByLabel("设备名称", { exact: true }).fill(deviceLabel);
  await page.getByLabel("插件查询模型").selectOption("byok");
  await page.getByLabel("句子与段落收集").selectOption("automatic");
  await page.getByLabel("生词云端保存").selectOption("disabled");
  await expect(page.getByText(/费用由服务商收取/u)).toBeVisible();
  await expect(page.getByText(/不会自动开始深度分析/u)).toBeVisible();
  await expect(page.getByText(/已有云端生词不受影响/u)).toBeVisible();
  await expect(submit).toBeDisabled();
  await page.getByLabel("我同意连接设备并应用以上偏好").check();
  await expect(submit).toBeEnabled();
  await submit.click();

  await expect(page.getByRole("heading", { name: "设备配对已批准" })).toBeVisible();
  await expect(page.getByRole("status")).toContainText("扩展设备已批准，可以返回扩展。");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  await page.reload();
  await expect(page.getByRole("heading", { name: "设备配对已批准" })).toBeVisible();
  await expect(page.getByRole("button", { name: "确认连接" })).toHaveCount(0);

  const snapshot = authority.snapshot();
  expect(
    snapshot.requestFacts.filter(
      ({ method, path }) =>
        method === "POST" && path === `/v1/extension-pairings/${pairingId}/approve`,
    ),
  ).toHaveLength(1);
  for (const path of [`/v1/extension-pairings/${pairingId}`, "/v1/account/preferences"]) {
    expect(snapshot.requestFacts).toContainEqual({
      authenticatedAs: "web",
      method: "GET",
      path,
      proof: "read",
    });
  }
  expect(snapshot.requestFacts).toContainEqual({
    authenticatedAs: "web",
    method: "POST",
    path: `/v1/extension-pairings/${pairingId}/approve`,
    proof: "write-valid",
  });
  expect(snapshot.extensionSessionCount).toBe(0);
  expect(JSON.stringify(snapshot)).not.toContain(deviceLabel);
  expect(JSON.stringify(snapshot)).not.toContain("automatic");
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
