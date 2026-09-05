import { expect, test } from "@playwright/test";

import { createCloudBrowserAuthority } from "./support/cloud-browser-authority.js";

const webOrigin = "https://web.huayi.invalid";
const storageKey = "huayi.web.appearance.v1";

const appearances = [
  { action: "#29394b", label: "去青月白", value: "moon" },
  { action: "#24282d", label: "流银镜白", value: "silver" },
  { action: "#503c31", label: "香槟晨霜", value: "champagne" },
  { action: "#304477", label: "霁蓝瓷光", value: "porcelain" },
] as const;

const viewports = [
  { height: 1_000, width: 1_440 },
  { height: 900, width: 1_024 },
  { height: 900, width: 768 },
  { height: 844, width: 390 },
] as const;

test("practice overview uses the available width and keeps its first action near the heading", async ({
  page,
}) => {
  const authority = createCloudBrowserAuthority({ authenticated: true, seed: "dialogue-practice" });
  await authority.install(page);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${webOrigin}/practice`);
    await expect(page.locator(".practice-queue article")).toHaveCount(2);
    const overview = await page.locator(".practice-overview").boundingBox();
    const queue = await page.locator(".practice-queue").boundingBox();
    expect(overview).not.toBeNull();
    expect(queue?.width).toBeGreaterThanOrEqual((overview?.width ?? 0) - 1);
    const first = await page.locator(".practice-queue article").nth(0).boundingBox();
    const second = await page.locator(".practice-queue article").nth(1).boundingBox();
    if (width === 1440) expect(second?.y).toBe(first?.y);
    else expect(second?.y).toBeGreaterThan(first?.y ?? 0);
    expect(
      (await page.getByRole("button", { name: "引导造句" }).first().boundingBox())?.y,
    ).toBeLessThan(600);
  }
});

test("approved appearances keep one production layout across responsive viewports", async ({
  page,
}) => {
  test.slow();
  const authority = createCloudBrowserAuthority({
    authenticated: true,
    seed: "dialogue-practice",
  });
  await authority.install(page);
  await page.goto(`${webOrigin}/practice`);

  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    for (const appearance of appearances) {
      await page.evaluate(({ key, value }) => window.localStorage.setItem(key, value), {
        key: storageKey,
        value: appearance.value,
      });
      await page.reload();

      await expect(page.getByRole("heading", { level: 1, name: "今日练习" })).toBeVisible();
      await expect(page.locator("html")).toHaveAttribute("data-appearance", appearance.value);
      await expect(page.locator(".appearance-menu > summary")).toContainText(appearance.label);
      await expect(page.locator(".workspace-navigation nav")).toContainText("学习库");

      const contract = await page.evaluate(() => {
        const root = getComputedStyle(document.documentElement);
        const heading = document.querySelector(".page-heading");
        const queue = document.querySelector(".practice-queue");
        if (heading === null || queue === null) throw new Error("Practice layout is incomplete.");
        return {
          action: root.getPropertyValue("--action").trim(),
          headingWidth: Math.round(heading.getBoundingClientRect().width),
          overflow: document.documentElement.scrollWidth - window.innerWidth,
          queueWidth: Math.round(queue.getBoundingClientRect().width),
        };
      });

      expect(contract.action).toBe(appearance.action);
      expect(contract.overflow).toBeLessThanOrEqual(0);
      expect(contract.headingWidth).toBeGreaterThan(0);
      expect(contract.queueWidth).toBeGreaterThan(0);
    }
  }
});

test("the production selector persists keyboard changes without changing practice state", async ({
  page,
}) => {
  const authority = createCloudBrowserAuthority({
    authenticated: true,
    seed: "dialogue-practice",
  });
  await authority.install(page);
  await page.goto(`${webOrigin}/practice`);

  await page.locator(".appearance-menu > summary").click();
  const silver = page.getByRole("radio", { name: "流银镜白" });
  await silver.focus();
  await silver.press("ArrowRight");
  await expect(page.getByRole("radio", { name: "香槟晨霜" })).toBeChecked();
  await expect(page.locator("html")).toHaveAttribute("data-appearance", "champagne");
  await expect(page.getByText("今日已练习 0 / 2 项", { exact: true })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "to be completely frank" })).not.toBeChecked();

  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-appearance", "champagne");
  await expect(page.getByText("今日已练习 0 / 2 项", { exact: true })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "to be completely frank" })).not.toBeChecked();
});

test("the default silver practice surface keeps desktop and mobile visual baselines", async ({
  page,
}) => {
  const authority = createCloudBrowserAuthority({
    authenticated: true,
    seed: "dialogue-practice",
  });
  await authority.install(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ height: 1_000, width: 1_440 });
  await page.goto(`${webOrigin}/practice`);
  await expect(page.getByText("今日已练习 0 / 2 项", { exact: true })).toBeVisible();
  await expect(page).toHaveScreenshot("practice-silver-desktop.png", {
    animations: "disabled",
    maxDiffPixelRatio: 0.02,
  });

  await page.setViewportSize({ height: 844, width: 390 });
  await page.reload();
  await expect(page.getByText("今日已练习 0 / 2 项", { exact: true })).toBeVisible();
  await expect(page).toHaveScreenshot("practice-silver-mobile.png", {
    animations: "disabled",
    maxDiffPixelRatio: 0.02,
  });
});
