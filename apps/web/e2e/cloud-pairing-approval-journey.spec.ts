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
  await expect(page.getByRole("heading", { name: "批准扩展设备" })).toBeVisible();
  await expect(page.getByText(/最小选区.*最多保留一小时/u)).toBeVisible();
  await expect(page.getByText(/标题、视频 ID/u)).toBeVisible();
  await expect(page.getByText(/BYOK Key 与精简结果不会发送给语见/u)).toBeVisible();
  await expect(page.getByText(/StudyCapture 原始学习意图/u)).toBeVisible();
  await expect(page.getByText(/CloudWordCopy 单词副本/u)).toBeVisible();
  await expect(page.getByText(/三项选择相互独立/u)).toBeVisible();
  await expect(page.getByLabel("插件查询模型")).toHaveValue("platform");
  await expect(page.getByLabel("待学习采集")).toHaveValue("manual");
  await expect(page.getByLabel("云端单词副本")).toHaveValue("enabled");

  const submit = page.getByRole("button", { name: "批准此设备" });
  await page.getByLabel("设备名称").fill(deviceLabel);
  await page.getByLabel("插件查询模型").selectOption("byok");
  await page.getByLabel("待学习采集").selectOption("automatic");
  await page.getByLabel("云端单词副本").selectOption("disabled");
  await expect(submit).toBeDisabled();
  await page.getByLabel("我了解并同意上述语见云端同步").check();
  await expect(submit).toBeEnabled();
  await submit.click();

  await expect(page.getByRole("heading", { name: "设备配对已批准" })).toBeVisible();
  await expect(page.getByRole("status")).toContainText("扩展设备已批准，可以返回扩展。");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  await page.reload();
  await expect(page.getByRole("heading", { name: "设备配对已批准" })).toBeVisible();
  await expect(page.getByRole("button", { name: "批准此设备" })).toHaveCount(0);

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
