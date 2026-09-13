import { expect, test } from "@playwright/test";
import { nativeWebAnalysis } from "../src/native-analysis.test-support.js";
import { createCloudBrowserAuthority } from "./support/cloud-browser-authority.js";
import { cloudCors } from "./support/cloud-browser-authority-request.js";

for (const width of [320, 390, 1440]) {
  test(`analysis tabs remain reachable beneath the header at ${width}`, async ({
    page,
  }, testInfo) => {
    const authority = createCloudBrowserAuthority({ authenticated: true, seed: "empty" });
    await authority.install(page);
    const analysis = nativeWebAnalysis();
    await page.route("https://api.huayi.invalid/v1/analyses**", async (route) => {
      expect(route.request().method()).toBe("GET");
      await route.fulfill({
        status: 200,
        headers: cloudCors("https://web.huayi.invalid") ?? {},
        json:
          new URL(route.request().url()).pathname === "/v1/analyses"
            ? { items: [analysis], nextCursor: null }
            : analysis,
      });
    });
    await page.setViewportSize({ width, height: 920 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("https://web.huayi.invalid/app");
    const tabs = page.getByRole("tablist", { name: "分析内容", exact: true });
    const translation = page.getByRole("tab", { name: "译文", exact: true });
    const learning = page.getByRole("tab", { name: "学习内容", exact: true });
    await expect(translation).toHaveAttribute("aria-selected", "true");
    // Exercise the same layout offset as the Hosted banner without contacting Hosted.
    await page.evaluate(() => {
      const notice = document.createElement("aside");
      notice.className = "acceptance-environment-notice";
      notice.textContent = "本地布局预览";
      document.body.prepend(notice);
      window.dispatchEvent(new Event("resize"));
    });
    await translation.focus();
    await page.keyboard.press("End");
    await expect(learning).toBeFocused();
    await expect(learning).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("tabpanel")).toHaveCount(1);
    await page.keyboard.press("ArrowLeft");
    await expect(page.getByRole("tab", { name: "深度解析", exact: true })).toBeFocused();
    await page.locator("[data-native-unit]").last().scrollIntoViewIfNeeded();
    await expect
      .poll(() =>
        tabs.evaluate((node) => {
          const header = document.querySelector(".app-shell > .topbar");
          if (!header) throw new Error("Missing workspace header");
          return node.getBoundingClientRect().top >= header.getBoundingClientRect().bottom;
        }),
      )
      .toBe(true);
    const tabBounds = await tabs.boundingBox();
    expect(tabBounds?.y).toBeLessThan(360);
    expect(tabBounds?.height).toBeGreaterThanOrEqual(44);
    await page.screenshot({ path: testInfo.outputPath(`tabs-sticky-${width}.png`) });
    await translation.click();
    await expect
      .poll(() =>
        tabs.evaluate((node) => {
          const box = node.getBoundingClientRect();
          return box.top >= 0 && box.bottom < innerHeight;
        }),
      )
      .toBe(true);
    await expect(page.getByRole("tabpanel", { name: "译文", exact: true })).toBeVisible();
    await learning.click();
    await expect(page.locator(".recommendation-evidence")).toHaveCount(0);
    await expect(page.locator("[data-recommendation-advice][open]")).toHaveCount(0);
    await expect(
      page.locator("[data-recommendation]").first().getByText("生成示例", { exact: true }),
    ).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
      false,
    );
    await page.screenshot({
      path: testInfo.outputPath(`tabs-learning-${width}.png`),
      fullPage: true,
    });
    expect(authority.snapshot().requestFacts.filter((fact) => fact.method === "POST")).toEqual([]);
  });
}
