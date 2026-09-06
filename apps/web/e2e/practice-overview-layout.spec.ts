import { expect, test } from "@playwright/test";
import {
  contractFixtures,
  dailyPracticeQueueResponseSchema,
  practiceSessionResponseSchema,
} from "@huayi/cloud-contracts";
import { createCloudBrowserAuthority } from "./support/cloud-browser-authority.js";

const origin = "https://web.huayi.invalid";
test("practice uses the available width and clicking the current navigation does not frame the page", async ({
  page,
}) => {
  const authority = createCloudBrowserAuthority({ authenticated: true, seed: "dialogue-practice" });
  await authority.install(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${origin}/practice`);
  await page.evaluate(() => localStorage.setItem("huayi.web.appearance.v1", "porcelain"));
  await page.reload();
  await expect(page.getByRole("button", { name: "引导造句", exact: true }).first()).toBeVisible();
  await page
    .getByRole("navigation", { name: "主导航" })
    .getByRole("link", { name: "今日练习" })
    .click();
  await page.keyboard.press("Tab");
  await page.locator("main").focus();
  expect(
    await page.locator("main").evaluate((element) => getComputedStyle(element).outlineStyle),
  ).toBe("none");
  await page.getByRole("button", { name: "造句练习", exact: true }).focus();
  expect(
    await page
      .getByRole("button", { name: "造句练习", exact: true })
      .evaluate((element) => getComputedStyle(element).outlineStyle),
  ).toBe("solid");
  const row = page.locator(".practice-overview article").first();
  expect((await row.boundingBox())?.width).toBeGreaterThan(650);
  expect((await row.boundingBox())?.height).toBeLessThanOrEqual(150);
  await page.getByRole("button", { name: "情境对话", exact: true }).click();
  await expect(page.getByText("选择 1–3 项，试着在和 AI 的英文对话中用出来。")).toBeVisible();
  expect(
    (await page.getByRole("button", { name: "开始对话", exact: true }).boundingBox())?.y,
  ).toBeLessThan(500);
  await page.screenshot({
    path: "artifacts/practice-redesign-20260906/dialogue-desktop.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.getByRole("button", { name: "造句练习", exact: true }).click();
  await expect(page.getByRole("button", { name: "造句练习", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.screenshot({
    path: "artifacts/practice-redesign-20260906/practice-desktop.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("button", { name: "引导造句", exact: true }).first()).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
  ).toBeLessThanOrEqual(1);
  await page.screenshot({
    path: "artifacts/practice-redesign-20260906/practice-mobile.png",
    fullPage: true,
    animations: "disabled",
  });
});

test("many learning items stay paged and saved practices show their own content and status", async ({
  page,
}) => {
  const authority = createCloudBrowserAuthority({ authenticated: true, seed: "dialogue-practice" });
  await authority.install(page);
  const base = contractFixtures.confirmCandidatesResponse.results[0];
  if (base.type !== "learning-item") throw new Error("Missing learning fixture");
  const schedule = { consecutiveMastered: 0, dueAt: null, level: -1 };
  const expressions = [
    "at least",
    "look forward to",
    "in the long run",
    "take a closer look",
    "it turns out",
    "as far as I know",
    "by the way",
    "make a difference",
    "on the other hand",
    "keep in mind",
    "in other words",
    "as a result",
    "to some extent",
    "at first glance",
  ];
  const items = expressions.map((text, index) => ({
    item: {
      type: "expression",
      systemAttributes: base.item.systemAttributes,
      tags: base.item.tags,
      id: `item-${index}`,
      content: {
        type: "expression",
        text,
        meaningZh: index === 0 ? "至少" : "在新的场景中练习使用",
        usageZh: "用于日常对话。",
      },
    },
    schedule,
  }));
  const sessions = items.slice(0, 6).map((item, index) =>
    practiceSessionResponseSchema.parse({
      id: `saved-${index}`,
      type: "sentence-creation",
      status: index === 2 ? "completed" : "active",
      prompt: "用这条表达谈谈你的计划。",
      revision: 1,
      turns: [],
      ...(index === 2 ? { finalFeedback: "表达自然，接下来请自评。" } : {}),
      createdAt: `2026-09-05T0${6 - index}:00:00.000Z`,
      updatedAt: `2026-09-05T0${6 - index}:00:00.000Z`,
      items: [{ itemId: item.item.id, position: 0, scheduleBefore: schedule }],
      workspace: {
        phase: "paused",
        mode: index % 2 === 0 ? "free" : "guided",
        draft: index === 0 ? "At least we can try again tomorrow." : "",
        draftRevision: 1,
      },
    }),
  );
  await page.route("**/v2/practice/daily-queue", (route) =>
    route.fulfill({
      headers: {
        "access-control-allow-origin": origin,
        "access-control-allow-credentials": "true",
      },
      json: dailyPracticeQueueResponseSchema.parse({
        currentItems: [],
        currentSession: null,
        items,
        completedToday: 0,
        dailyGoal: 20,
        date: "2026-09-05",
        timezone: "Asia/Shanghai",
      }),
    }),
  );
  await page.route("**/v2/practice-workspace", (route) =>
    route.fulfill({
      json: sessions,
      headers: {
        "access-control-allow-origin": origin,
        "access-control-allow-credentials": "true",
      },
    }),
  );
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${origin}/practice`);
  await page.evaluate(() => localStorage.setItem("huayi.web.appearance.v1", "porcelain"));
  await page.reload();
  await expect(page.locator(".practice-item-row")).toHaveCount(6);
  await expect(page.locator(".practice-resume-item")).toHaveCount(3);
  await expect(page.locator(".practice-resume-item").first()).toContainText("at least");
  await expect(page.locator(".practice-resume-item").first()).toContainText(
    "草稿：At least we can try again tomorrow.",
  );
  await expect(page.locator(".practice-resume-item").nth(2)).toContainText("反馈已完成 · 待自评");
  await page.getByRole("button", { name: "查看全部 6 项" }).click();
  await expect(page.locator(".practice-resume-item")).toHaveCount(6);
  await page.getByRole("button", { name: "收起", exact: true }).click();
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await page.screenshot({
    path: "artifacts/practice-redesign-20260906/practice-with-drafts.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.getByRole("searchbox", { name: "查找学习项" }).fill("at first glance");
  await expect(page.locator(".practice-item-row")).toHaveCount(1);
  await expect(page.locator(".practice-item-row")).toContainText("at first glance");
  await page.getByRole("searchbox", { name: "查找学习项" }).fill("");
  await page.getByRole("button", { name: "情境对话", exact: true }).click();
  await page.getByRole("checkbox", { name: "at least", exact: true }).check();
  await page.getByRole("button", { name: "下一页" }).click();
  await page.getByRole("checkbox", { name: "by the way", exact: true }).check();
  await page.getByRole("checkbox", { name: "make a difference", exact: true }).check();
  await expect(
    page.getByRole("checkbox", { name: "on the other hand", exact: true }),
  ).toBeDisabled();
  await expect(page.getByLabel("已选对话学习项")).toContainText("at least");
  await page.getByRole("button", { name: "移除 at least", exact: true }).click();
  await expect(
    page.getByRole("checkbox", { name: "on the other hand", exact: true }),
  ).toBeEnabled();
  expect(authority.snapshot().practiceProviderCallCount).toBe(0);
});
