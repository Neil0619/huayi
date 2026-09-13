import { expect, test } from "@playwright/test";
import { createPracticeProgressionAuthority } from "./support/practice-progression-authority.js";

for (const width of [390, 1440]) {
  test(`daily practice starts, recovers the next item and completes at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const authority = createPracticeProgressionAuthority();
    await authority.install(page);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("https://web.huayi.invalid/practice");
    await expect(page.getByRole("button", { name: "开始今日练习", exact: true })).toBeVisible();
    expect(authority.facts().generations).toBe(0);
    const history = page.getByRole("link", { name: "练习历史", exact: true });
    await expect(history).toHaveCSS("text-decoration-line", "none");
    await expect(history).toHaveCSS("border-top-style", "solid");
    await page.screenshot({ path: testInfo.outputPath("overview.png"), fullPage: true });
    await page.getByRole("button", { name: "开始今日练习", exact: true }).click();
    await expect(page.getByRole("heading", { name: "你的任务", exact: true })).toBeVisible();
    await expect(page.locator(".practice-session h2")).toHaveText("at least");
    await page
      .getByRole("textbox", { name: "你的英文句子" })
      .fill("At least we can finish tomorrow.");
    await page.getByRole("button", { name: "提交并获取反馈" }).click();
    await expect(page.getByRole("heading", { name: "练习反馈", exact: true })).toBeFocused();
    await page.getByRole("button", { name: "掌握", exact: true }).click();
    await expect(page.getByRole("button", { name: "练习下一项", exact: true })).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
    await page.screenshot({ path: testInfo.outputPath("next-item.png"), fullPage: true });
    authority.loseNextStartResponse();
    await page.getByRole("button", { name: "练习下一项", exact: true }).click();
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page.getByRole("heading", { name: "练习反馈", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "练习下一项", exact: true }).click();
    await expect(page.locator(".practice-session h2")).toHaveText("to be frank");
    await page
      .getByRole("textbox", { name: "你的英文句子" })
      .fill("To be frank, I need more time.");
    await page.getByRole("button", { name: "提交并获取反馈" }).click();
    await expect(page.getByRole("heading", { name: "练习反馈", exact: true })).toBeFocused();
    await page.getByRole("button", { name: "掌握", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "今天没有待练习内容", exact: true }),
    ).toBeVisible();
    await expect(page.locator("[data-next-practice]")).toHaveCount(0);
    expect(authority.facts().generations).toBe(4);
    expect(authority.facts().ratings).toBe(2);
    expect(authority.facts().sessions).toHaveLength(2);
    expect(authority.facts().sessions[0]?.attempts?.[0]?.answer).toBe(
      "At least we can finish tomorrow.",
    );
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
    await page.screenshot({ path: testInfo.outputPath("completed.png"), fullPage: true });
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "今天没有待练习内容", exact: true }),
    ).toBeVisible();
    expect(authority.facts().generations).toBe(4);
    expect(errors).toEqual([]);
  });
}
