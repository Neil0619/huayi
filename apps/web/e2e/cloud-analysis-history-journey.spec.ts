import { expect, test } from "@playwright/test";

import { createCloudBrowserAuthority } from "./support/cloud-browser-authority.js";

const privateResult = "坦率地说，这很有效。";
const privateSource = "To be frank, this works.";
const webOrigin = "https://web.huayi.invalid";

test("analysis history keeps review and archive independent before linked capture deletion", async ({
  page,
}) => {
  const authority = createCloudBrowserAuthority({
    authenticated: true,
    seed: "analysis-history-maintenance",
  });
  await page.setViewportSize({ height: 844, width: 390 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await authority.install(page);

  await page.goto(`${webOrigin}/history`);
  await page.getByLabel("搜索").fill("frank");
  await page.getByLabel("来源").selectOption("study-capture");
  await page.getByLabel("选区").selectOption("passage");
  await page.getByRole("button", { name: "应用筛选" }).click();
  await expect(page.getByRole("button", { name: /Captured planning note/u })).toBeVisible();

  await page.getByRole("button", { name: /Captured planning note/u }).click();
  await expect(
    page.getByRole("heading", { name: "Captured planning note", level: 2 }),
  ).toBeFocused();
  await expect(page.getByText(privateSource, { exact: true }).first()).toBeVisible();
  await expect(page.getByText(privateResult).first()).toBeVisible();
  await expect(page.getByText("to be frank", { exact: true }).first()).toBeVisible();
  await expect(page.locator(".analysis-history-model")).toContainText("deepseek-chat");
  await expect(page.locator(".analysis-history-detail")).not.toContainText("analysis-history-1");
  await expect(page.locator(".analysis-history-detail")).not.toContainText("candidate-1");
  await expect(page.locator(".analysis-history-detail")).not.toContainText("分析单元");
  await expect(page.locator(".analysis-history-detail")).not.toContainText("revision");
  await expect(page.locator(".analysis-history-detail")).not.toContainText(
    "sentence-passage-analysis-v2",
  );
  await expect(page.locator(".analysis-history-detail")).not.toContainText("Prompt 1");
  await expect(page.locator(".analysis-history-detail")).not.toContainText("Schema 1");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  await page.getByRole("button", { name: "无需收藏，标记已整理" }).click();
  await expect(page.getByRole("status")).toContainText("标记已整理已完成。");
  await expect(page.locator(".analysis-history-detail")).toContainText("整理状态：已整理");
  await expect(page.locator(".analysis-history-detail")).toContainText("归档状态：未归档");

  await page.getByRole("button", { name: "归档", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("归档已完成。");
  await expect(page.locator(".analysis-history-detail")).toContainText("整理状态：已整理");
  await expect(page.locator(".analysis-history-detail")).toContainText("归档状态：已归档");

  await page.getByRole("button", { name: "恢复", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("恢复已完成。");
  await expect(page.locator(".analysis-history-detail")).toContainText("整理状态：已整理");
  await expect(page.locator(".analysis-history-detail")).toContainText("归档状态：未归档");

  await page.getByRole("button", { name: "删除…" }).click();
  await expect(page.getByLabel("同时删除原始 StudyCapture")).toBeChecked();
  const confirm = page.getByRole("button", { name: "确认删除" });
  await expect(confirm).toBeFocused();
  await confirm.click();
  await expect(page.getByText("当前筛选下没有分析记录。")).toBeVisible();

  const snapshot = authority.snapshot();
  expect(snapshot.analysisCount).toBe(0);
  expect(snapshot.captureCount).toBe(0);
  for (const path of ["/v1/analyses", "/v1/analyses/analysis-history-1"]) {
    expect(snapshot.requestFacts).toContainEqual({
      authenticatedAs: "web",
      method: "GET",
      path,
      proof: "read",
    });
  }
  for (const [method, path] of [
    ["POST", "/v1/analyses/analysis-history-1/process"],
    ["POST", "/v1/analyses/analysis-history-1/archive"],
    ["POST", "/v1/analyses/analysis-history-1/restore"],
    ["DELETE", "/v1/analyses/analysis-history-1"],
  ] as const) {
    expect(snapshot.requestFacts).toContainEqual({
      authenticatedAs: "web",
      method,
      path,
      proof: "write-valid",
    });
  }
  expect(JSON.stringify(snapshot)).not.toContain(privateSource);
  expect(JSON.stringify(snapshot)).not.toContain(privateResult);
  expect(await page.locator("body").textContent()).not.toContain(privateSource);
  expect(await page.locator("body").textContent()).not.toContain(privateResult);
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
