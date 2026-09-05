import { expect, test } from "@playwright/test";

import { createCloudBrowserAuthority } from "./support/cloud-browser-authority.js";

const privateReply = "To be completely frank, I would test the risky assumption first.";
const privateFeedback = "The dialogue used both targets accurately and stayed concise.";
const webOrigin = "https://web.huayi.invalid";

test("completed practice history deletes without removing learning items or schedules", async ({
  page,
}) => {
  const authority = createCloudBrowserAuthority({
    authenticated: true,
    seed: "completed-practice-history",
  });
  await page.setViewportSize({ height: 844, width: 390 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await authority.install(page);

  await page.goto(`${webOrigin}/practice/history`);
  await page.getByLabel("类型").selectOption("dialogue");
  await page.getByLabel("状态").selectOption("completed");
  await page.getByRole("button", { name: "应用筛选" }).click();
  await expect(page.getByRole("heading", { name: "记录 1" })).toBeVisible();

  await page.getByRole("button", { name: /受约束对话/u }).click();
  await expect(page.getByRole("heading", { name: "受约束对话详情" })).toBeFocused();
  await expect(page.getByText("项目同事")).toBeVisible();
  await expect(page.getByText("讨论方案是否具备足够证据。")).toBeVisible();
  await expect(page.getByText(privateReply)).toBeVisible();
  await expect(page.getByText(privateFeedback)).toBeVisible();
  await expect(page.getByText("to be completely frank：掌握")).toBeVisible();
  await expect(page.getByText("It is worth {action}：勉强")).toBeVisible();
  await expect(page.locator("body")).not.toContainText("practice-item-1");
  await expect(page.locator("body")).not.toContainText("practice-item-2");
  await expect(page.locator("body")).not.toContainText("practice-history-dialogue");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);

  await page.getByRole("button", { name: "删除这次练习" }).click();
  const confirm = page.getByRole("button", { name: "确认删除" });
  await expect(confirm).toBeFocused();
  await confirm.click();
  await expect(page.getByRole("heading", { name: "还没有练习记录" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "练习历史", level: 1 })).toBeFocused();

  const snapshot = authority.snapshot();
  expect(snapshot.practiceHistoryCount).toBe(0);
  expect(snapshot.requestFacts).toContainEqual({
    authenticatedAs: "web",
    method: "DELETE",
    path: "/v2/practice/sessions/practice-history-dialogue",
    proof: "write-valid",
  });
  expect(JSON.stringify(snapshot)).not.toContain(privateReply);
  expect(JSON.stringify(snapshot)).not.toContain(privateFeedback);

  await page.getByRole("link", { name: "返回今日练习" }).click();
  await expect(page).toHaveURL(`${webOrigin}/practice`);
  await expect(page.getByText("今日已练习 2 / 2 项", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "to be completely frank" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "It is worth {action}" })).toBeVisible();
  await expect(page.getByText("到期复习", { exact: true })).toHaveCount(2);
  expect(await page.locator("body").textContent()).not.toContain(privateReply);
  expect(await page.locator("body").textContent()).not.toContain(privateFeedback);
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
