import { expect, test } from "@playwright/test";
import {
  analysisRecordSchema,
  contractFixtures,
  studyCaptureDetailResponseSchema,
} from "@huayi/cloud-contracts";

import { createCloudBrowserAuthority } from "./support/cloud-browser-authority.js";
import { cloudCors } from "./support/cloud-browser-authority-request.js";

for (const width of [390, 1440]) {
  test(`preserves reading without optional suggestions at ${width}`, async ({ page }, testInfo) => {
    const authority = createCloudBrowserAuthority({
      authenticated: true,
      seed: "candidate-analysis",
    });
    await authority.install(page);
    const analysis = analysisRecordSchema.parse({
      ...contractFixtures.analysis,
      studyCaptureId: "capture-empty",
    });
    if (analysis.result.type !== "sentence-passage-analysis-v2")
      throw new Error("Expected sentence");
    analysis.candidates = [];
    for (const sentence of analysis.result.sentences) sentence.candidateIds = [];
    const translation = analysis.result.overall.translationZh;
    const date = "2026-09-08T08:00:00.000Z";
    const detail = studyCaptureDetailResponseSchema.parse({
      activeAnalysisRequest: null,
      latestAnalysis: {
        id: analysis.id,
        revision: analysis.revision,
        reviewState: "pendingReview",
        createdAt: date,
      },
      capture: {
        id: "capture-empty",
        sourceText: analysis.sourceText,
        kind: "sentence",
        status: "analyzed",
        normalizedTextHash: "a".repeat(64),
        captureCount: 1,
        revision: 1,
        createdAt: date,
        updatedAt: date,
        firstCapturedAt: date,
        lastCapturedAt: date,
      },
    });
    await page.route("https://api.huayi.invalid/v1/study-captures**", async (route) => {
      const url = new URL(route.request().url());
      await route.fulfill({
        status: 200,
        headers: cloudCors("https://web.huayi.invalid") ?? {},
        json:
          url.pathname === "/v1/study-captures"
            ? {
                items: url.searchParams.get("status") === "analyzed" ? [detail] : [],
                nextCursor: null,
              }
            : detail,
      });
    });
    await page.route("https://api.huayi.invalid/v1/analyses**", async (route) => {
      if (route.request().method() !== "GET") return route.fallback();
      const list = new URL(route.request().url()).pathname === "/v1/analyses";
      await route.fulfill({
        status: 200,
        headers: cloudCors("https://web.huayi.invalid") ?? {},
        json: list ? { items: [analysis], nextCursor: null } : analysis,
      });
    });
    await page.setViewportSize({ width, height: 900 });
    await page.goto("https://web.huayi.invalid/app");
    await expect(page.getByRole("region", { name: "原文解析" })).toContainText(translation);
    await expect(page.getByRole("heading", { name: "原文解读已保留" })).toBeVisible();
    await expect(page.getByText(/本次没有合适的学习建议/u)).toBeVisible();
    await expect(page.getByRole("button", { name: "加入学习库", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "重新分析", exact: true })).toBeEnabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
      false,
    );
    expect(authority.snapshot().requestFacts.filter((fact) => fact.method === "POST")).toEqual([]);
    await page.screenshot({
      fullPage: true,
      path: testInfo.outputPath(`empty-suggestions-${width}.png`),
    });
  });
}
