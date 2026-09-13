import { expect, test, type Route } from "@playwright/test";
import {
  analysisRecordSchema,
  confirmCandidatesRequestSchema,
  contractFixtures,
  structuredTeachingAccept,
} from "@huayi/cloud-contracts";
import { nativeWebAnalysis } from "../src/native-analysis.test-support.js";
import { createCloudBrowserAuthority } from "./support/cloud-browser-authority.js";
import { cloudCors } from "./support/cloud-browser-authority-request.js";
const json = (route: Route, value: unknown, status = 200) =>
  route.fulfill({ status, headers: cloudCors("https://web.huayi.invalid") ?? {}, json: value });
for (const width of [390, 1440])
  test(`native teaching and explicit candidate choices at ${width}`, async ({ page }, testInfo) => {
    const authority = createCloudBrowserAuthority({ authenticated: true, seed: "empty" });
    await authority.install(page);
    let analysis = nativeWebAnalysis();
    const legacy = analysisRecordSchema.parse({
      ...contractFixtures.analysis,
      source: { type: "manual", title: "旧版解析" },
    });
    let attempts = 0;
    const submissions: ReturnType<typeof confirmCandidatesRequestSchema.parse>[] = [];
    const readAccepts: string[] = [];
    await page.route("https://api.huayi.invalid/v1/analyses**", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (request.method() === "OPTIONS")
        return route.fulfill({
          status: 204,
          headers: cloudCors("https://web.huayi.invalid") ?? {},
        });
      if (request.method() === "GET") {
        readAccepts.push(request.headers().accept ?? "");
        return json(
          route,
          url.pathname === "/v1/analyses"
            ? { items: [analysis, legacy], nextCursor: null }
            : url.pathname.endsWith(legacy.id)
              ? legacy
              : analysis,
        );
      }
      if (url.pathname.endsWith("/candidates:confirm")) {
        submissions.push(confirmCandidatesRequestSchema.parse(request.postDataJSON()));
        attempts++;
        if (attempts === 1) return json(route, contractFixtures.error, 429);
        analysis = { ...analysis, revision: 2, reviewState: "reviewed" };
        return json(route, { ...contractFixtures.confirmCandidatesResponse, analysis });
      }
      throw new Error(`Unexpected offline analysis request: ${request.method()} ${url.pathname}`);
    });
    await page.setViewportSize({ width, height: 920 });
    await page.goto("https://web.huayi.invalid/app");
    await expect(page.getByRole("tab", { name: "译文", exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(page.getByRole("tabpanel")).toHaveCount(1);
    await page.getByRole("tab", { name: "深度解析", exact: true }).click();
    const units = page.locator("[data-native-unit]");
    await expect(units).toHaveCount(2);
    await expect(page.locator("[data-core-fragment]")).toHaveText([
      "The café",
      "opens early",
      "We can meet there",
    ]);
    const modifier = page.locator("[data-structure-modifiers]");
    await expect(modifier).not.toHaveAttribute("open");
    await modifier.locator("summary").focus();
    await page.keyboard.press("Enter");
    await expect(modifier).toHaveAttribute("open", "");
    await expect(modifier).toContainText("修饰主干 1");
    expect(
      await page.locator(".native-teaching-unit .analysis-reading-number").evaluateAll((numbers) =>
        numbers.map((number) => {
          const range = document.createRange();
          range.selectNodeContents(number);
          return range.getClientRects().length;
        }),
      ),
    ).toEqual([1, 1]);
    await page.getByRole("tab", { name: "学习内容", exact: true }).click();
    const recommended = page.locator("[data-recommendation]");
    await expect(recommended).toHaveCount(2);
    await expect(recommended.first()).toHaveAttribute(
      "data-candidate-id",
      "20000000-0000-4000-8000-000000000004",
    );
    await expect(page.locator("[data-candidate-selected]:checked")).toHaveCount(0);
    const remaining = page.locator("[data-remaining-candidates]");
    await expect(remaining).not.toHaveAttribute("open");
    await expect(page.locator(".recommendation-evidence")).toHaveCount(0);
    await expect(recommended.first().locator("[data-recommendation-advice]")).not.toHaveAttribute(
      "open",
    );
    await expect(recommended.first().getByText("生成示例", { exact: true })).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath(`native-learning-compact-${width}.png`),
      fullPage: true,
    });
    await recommended.first().getByText("编辑内容与标签", { exact: true }).click();
    await recommended.first().getByLabel("表达", { exact: true }).fill("meet there later");
    await recommended.first().getByLabel("标签（逗号分隔）").fill("friends");
    await recommended.first().locator("[data-candidate-selected]").first().check();
    await recommended
      .first()
      .getByLabel("表达", { exact: true })
      .evaluate((node) => node.setAttribute("data-preserved", "yes"));
    await page.getByRole("tab", { name: "译文", exact: true }).click();
    await page.getByRole("tab", { name: "学习内容", exact: true }).click();
    await expect(recommended.first().getByLabel("表达", { exact: true })).toHaveAttribute(
      "data-preserved",
      "yes",
    );
    await expect(recommended.first().getByLabel("表达", { exact: true })).toHaveValue(
      "meet there later",
    );
    await remaining.locator(":scope > summary").click();
    const unselected = remaining.locator(".collection-candidate").first();
    await unselected.getByText("编辑内容与标签", { exact: true }).click();
    await unselected.getByLabel("表达", { exact: true }).fill("");
    await remaining.locator(":scope > summary").click();
    await page.getByRole("button", { name: "旧版解析" }).click();
    await expect(page.locator("[data-native-unit]")).toHaveCount(0);
    await expect(page.locator("[data-recommendation]")).toHaveCount(0);
    await page.locator("aside[aria-label='收集内容'] button").first().click();
    await page.getByRole("button", { name: "刷新列表", exact: true }).click();
    await expect(page.getByRole("tab", { name: "译文", exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await page.getByRole("tab", { name: "学习内容", exact: true }).click();
    await expect(recommended.first().locator("[data-candidate-selected]").first()).toBeChecked();
    await recommended.first().getByText("编辑内容与标签", { exact: true }).click();
    await expect(recommended.first().getByLabel("表达", { exact: true })).toHaveValue(
      "meet there later",
    );
    await expect(recommended.first().getByRole("blockquote")).toHaveCount(0);
    await page.getByRole("button", { name: "加入学习库", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("当前选择和编辑已保留");
    expect(submissions[0]?.confirmations).toEqual([
      expect.objectContaining({
        candidateId: "20000000-0000-4000-8000-000000000004",
        payload: expect.objectContaining({ text: "meet there later" }),
        tags: ["friends"],
      }),
    ]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
      false,
    );
    await page.evaluate(() => {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      window.scrollTo(0, 0);
    });
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
    await page.screenshot({
      path: testInfo.outputPath(`native-review-${width}.png`),
      fullPage: true,
    });
    await page.getByRole("button", { name: "加入学习库", exact: true }).click();
    await expect.poll(() => submissions.length).toBe(2);
    await expect(page.locator(".analysis-detail h2")).toHaveText(legacy.sourceText);
    expect(submissions[1]).toEqual(submissions[0]);
    expect(readAccepts.every((value) => value === structuredTeachingAccept.json)).toBe(true);
    expect(authority.snapshot().practiceProviderCallCount).toBe(0);
  });
