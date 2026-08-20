import { expect, test } from "@playwright/test";

import { createCloudBrowserAuthority } from "./support/cloud-browser-authority.js";

const webOrigin = "https://web.huayi.invalid";

test("pending sentence practice retries explicitly, completes feedback, and updates quota", async ({
  page,
}) => {
  const authority = createCloudBrowserAuthority({
    authenticated: true,
    seed: "pending-sentence-practice",
  });
  await authority.install(page);

  await page.goto(`${webOrigin}/practice`);
  await expect(page.getByRole("heading", { name: "题目尚未完成" })).toBeVisible();
  await page.waitForTimeout(250);
  expect(authority.snapshot().practiceProviderCallCount).toBe(0);

  await page.getByRole("button", { name: "重试生成题目" }).click();
  await expect(page.getByRole("heading", { name: "任务" })).toBeVisible();
  await page
    .getByRole("textbox", { name: "你的英文句子" })
    .fill("To be completely frank, this plan needs more evidence.");
  await page.getByRole("button", { name: "提交并获取反馈" }).click();

  await expect(page.getByRole("heading", { name: "练习反馈" })).toBeFocused();
  await expect(page.getByText("表达自然，并正确使用了目标表达。")).toBeVisible();
  await expect(page.getByText("To be completely frank, we need stronger evidence.")).toBeVisible();
  await page.getByRole("button", { name: "掌握" }).click();
  await expect(
    page.locator(".practice-feedback").getByText("自评已保存，排期已更新。"),
  ).toBeVisible();
  expect(authority.snapshot().practiceProviderCallCount).toBe(2);

  await page.goto(`${webOrigin}/settings/account`);
  await expect(page.getByRole("heading", { name: "当前账号" })).toBeVisible();
  await expect(page.getByText("learner@example.com")).toBeVisible();
  await expect(page.getByText("Chrome on Mac")).toHaveCount(0);
  await expect(page.getByText("1.0.0", { exact: true })).toBeVisible();
  await expect(page.getByText("有效扩展设备").locator("..")).toContainText("1");
  await expect(page.getByRole("progressbar", { name: "平台额度已使用 20%" })).toBeVisible();
  expect(authority.snapshot().requestFacts).toContainEqual({
    authenticatedAs: "web",
    method: "GET",
    path: "/v1/account",
    proof: "read",
  });
  const publicEvidence = JSON.stringify(authority.snapshot());
  expect(publicEvidence).not.toContain("To be completely frank, this plan needs more evidence.");
  expect(publicEvidence).not.toMatch(/lease|reservation|practice_generation_tasks/iu);
});

test("three-round dialogue returns per-item feedback and rates every item atomically", async ({
  page,
}) => {
  const authority = createCloudBrowserAuthority({
    authenticated: true,
    seed: "dialogue-practice",
  });
  await authority.install(page);

  await page.goto(`${webOrigin}/practice`);
  await page.getByRole("checkbox", { name: "to be completely frank" }).check();
  await page.getByRole("checkbox", { name: "It is worth {action}" }).check();
  await page.getByRole("button", { name: "开始对话" }).click();
  await expect(page.getByText("You are discussing a project plan with a colleague.")).toBeVisible();

  for (const reply of [
    "To be completely frank, the current plan needs clearer evidence.",
    "It is worth testing the risky assumption before launch.",
    "To be completely frank, I agree that it is worth revising the plan.",
  ]) {
    await page.getByRole("textbox", { name: "你的英文回复" }).fill(reply);
    await page.getByRole("button", { name: "发送回复" }).click();
    await expect(page.getByRole("list", { name: "对话内容" }).getByText(reply)).toBeVisible();
  }

  await page.getByRole("button", { name: "结束并获取反馈" }).click();
  await expect(page.getByRole("heading", { name: "对话反馈" })).toBeFocused();
  await expect(page.getByText("你完成了三轮对话，并自然覆盖了两个学习项。")).toBeVisible();
  await expect(page.getByText("直接表达观点时使用自然。")).toBeVisible();
  await expect(page.getByText("建议行动时结构准确。")).toBeVisible();

  await page.getByLabel("to be completely frank").selectOption("mastered");
  await page.getByLabel("It is worth {action}").selectOption("effortful");
  await page.getByRole("button", { name: "保存全部自评" }).click();
  await expect(page.getByText("所有自评已保存，排期已更新。")).toBeVisible();
  expect(authority.snapshot().practiceProviderCallCount).toBe(5);

  await page.goto(`${webOrigin}/settings/account`);
  await expect(page.getByRole("progressbar", { name: "平台额度已使用 50%" })).toBeVisible();
});
