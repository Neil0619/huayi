import { expect, test } from "@playwright/test";
import { studyCaptureDetailResponseSchema } from "@huayi/cloud-contracts";

import { createCloudBrowserAuthority } from "./support/cloud-browser-authority.js";
import { cloudCors } from "./support/cloud-browser-authority-request.js";

const sourceText = "Wildfire in southern Spain leaves at least 12 dead and 23 missing";

for (const width of [390, 1440]) {
  test(`capture failure retains the original and readable controls at ${width}px`, async ({
    page,
  }) => {
    const authority = createCloudBrowserAuthority({ authenticated: true, seed: "empty" });
    await authority.install(page);
    let analyzing = true;
    let generationCalls = 0;
    const detail = () =>
      studyCaptureDetailResponseSchema.parse({
        activeAnalysisRequest: analyzing ? { requestId: "request-1", state: "running" } : null,
        latestAnalysis: null,
        capture: {
          id: "capture-1",
          sourceText,
          kind: "sentence",
          status: analyzing ? "analyzing" : "pending",
          normalizedTextHash: "a".repeat(64),
          captureCount: 1,
          revision: analyzing ? 2 : 3,
          createdAt: "2026-09-04T10:45:00.000Z",
          updatedAt: "2026-09-04T10:51:00.000Z",
          firstCapturedAt: "2026-09-04T10:45:00.000Z",
          lastCapturedAt: "2026-09-04T10:45:00.000Z",
        },
      });
    await page.route("https://api.huayi.invalid/v1/study-captures**", async (route) => {
      const url = new URL(route.request().url());
      if (route.request().method() === "POST") generationCalls += 1;
      const current = detail();
      const body =
        url.pathname === "/v1/study-captures"
          ? {
              items: url.searchParams.get("status") === current.capture.status ? [current] : [],
              nextCursor: null,
            }
          : current;
      await route.fulfill({
        status: 200,
        headers: { ...cloudCors("https://web.huayi.invalid"), "content-type": "application/json" },
        body: JSON.stringify(body),
      });
    });
    await page.route("https://api.huayi.invalid/v1/analysis-requests/request-1", async (route) => {
      analyzing = false;
      await route.fulfill({
        status: 200,
        headers: { ...cloudCors("https://web.huayi.invalid"), "content-type": "application/json" },
        body: JSON.stringify({
          requestId: "request-1",
          state: "failed",
          error: {
            message: "The model output was invalid.",
            code: "model_output_invalid",
            requestId: "request-1",
          },
        }),
      });
    });
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("https://web.huayi.invalid/app");
    await expect(page.getByRole("heading", { name: sourceText })).toBeVisible();
    await page.getByRole("button", { name: "检查同一次分析" }).click();
    await expect(page.getByRole("alert")).toContainText("原文已保留");
    await expect(page.getByRole("heading", { name: sourceText })).toBeVisible();
    await expect(page.getByRole("button", { name: "开始深度分析" })).toBeEnabled();
    expect(generationCalls).toBe(0);
    const boxes = await page
      .locator(
        ".study-capture-form input, .study-capture-form select, .study-capture-form textarea",
      )
      .evaluateAll((elements) =>
        elements.map((element) => {
          const { x, y, width, height } = element.getBoundingClientRect();
          return { x, y, width, height };
        }),
      );
    expect(boxes).toHaveLength(3);
    for (const [index, box] of boxes.entries()) {
      expect(box.height).toBeGreaterThanOrEqual(40);
      const previous = boxes[index - 1];
      if (previous !== undefined) expect(box.y).toBeGreaterThan(previous.y + previous.height);
    }
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
    ).toBeLessThanOrEqual(0);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: `artifacts/hosted-analysis-repair-20260904/capture-${width}.png`,
      fullPage: true,
    });
  });
}
