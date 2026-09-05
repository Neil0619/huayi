import { expect, test } from "@playwright/test";
import { createLearningWorkspaceAuthority } from "./support/learning-workspace-authority.js";
const origin = "https://web.huayi.invalid";
test("collects two originals, completes analysis after leaving, learns, writes, rates once and returns to overview", async ({
  page,
}) => {
  const authority = createLearningWorkspaceAuthority();
  await authority.install(page);
  await page.goto(`${origin}/app?paste=1`);
  await expect(page.getByRole("navigation", { name: "主导航" }).getByRole("link")).toHaveCount(4);
  for (const [index, text] of [authority.source, "At least we can try again."].entries()) {
    await page.getByRole("textbox", { name: "想学习的英文原文" }).fill(text);
    await page.getByRole("button", { name: "保存并开始分析" }).click();
    await expect.poll(() => authority.facts().calls).toBe(index + 1);
    await expect(page.getByRole("button", { name: "保存并开始分析" })).toBeEnabled();
  }
  expect(authority.facts()).toMatchObject({ captures: 2, calls: 2 });
  await page.goto(`${origin}/practice`);
  authority.complete();
  await page.goto(`${origin}/app`);
  await expect(page.getByRole("heading", { name: "选择你想学会使用的表达与句型" })).toBeVisible();
  expect(authority.facts().calls).toBe(2);
  await expect(page.locator(".collection-candidate-choice")).toContainText("at least");
  await expect(page.locator(".analysis-reading")).toContainText("至少我们可以再试一次。");
  await page.getByRole("button", { name: /To be frank, this works\./u }).click();
  await expect(page.locator(".collection-candidate-choice")).toContainText("to be frank");
  await expect(page.locator(".analysis-reading")).toContainText("坦率地说，这很有效。");
  await page.screenshot({
    path: "artifacts/query-learning-refinement-20260905/collection-desktop.png",
    fullPage: true,
  });
  await page.locator("[data-candidate-selected]").first().check();
  await page.getByRole("button", { name: "加入学习库", exact: true }).click();
  await page.getByRole("link", { name: "立即练习", exact: true }).click();
  await expect(page.getByRole("heading", { name: "把读过的表达，用在自己的话里" })).toBeVisible();
  await page.getByRole("button", { name: "自由造句", exact: true }).first().click();
  expect(authority.facts().calls).toBe(2);
  await page
    .getByRole("textbox", { name: "你的英文句子" })
    .fill("To be frank, I need at least two days.");
  await page.reload();
  await page.getByRole("button", { name: /继续上次练习/u }).click();
  await expect(page.getByRole("textbox", { name: "你的英文句子" })).toHaveValue(
    "To be frank, I need at least two days.",
  );
  await page.getByRole("button", { name: "提交并获取反馈" }).click();
  await expect(page.getByRole("heading", { name: "练习反馈", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "掌握", exact: true }).click();
  await page.getByRole("button", { name: "下一项 · 返回总览" }).click();
  await expect(page.getByText("今日已练习 1 / 5 项")).toBeVisible();
  expect(authority.facts()).toEqual({ captures: 2, analyses: 2, calls: 3, ratings: 1 });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(page.getByRole("heading", { name: "今日练习", exact: true })).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
  ).toBeLessThanOrEqual(1);
  await page.screenshot({
    path: "artifacts/query-learning-refinement-20260905/practice-mobile.png",
    fullPage: true,
  });
});
