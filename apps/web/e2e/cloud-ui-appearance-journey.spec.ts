import { expect, test, type Locator } from "@playwright/test";

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

async function bounds(locator: Locator) {
  const box = await locator.boundingBox();
  if (box === null) throw new Error("Expected practice element to have a rendered box.");
  return box;
}

test("practice overview uses dense full-width rows and keeps its first action in view", async ({
  page,
}) => {
  const authority = createCloudBrowserAuthority({ authenticated: true, seed: "dialogue-practice" });
  await authority.install(page);
  for (const viewport of [viewports[0], viewports[3]]) {
    await page.setViewportSize(viewport);
    await page.goto(`${webOrigin}/practice`);
    const rows = page.locator(".practice-item-row");
    await expect(rows).toHaveCount(2);
    const overview = await bounds(page.locator(".practice-overview"));
    const heading = await bounds(page.locator(".page-heading"));
    const panel = await bounds(page.getByRole("region", { name: "开始新练习" }));
    const sidebar = await bounds(page.getByRole("complementary", { name: "继续练习" }));
    const items = await bounds(page.getByLabel("今日学习项", { exact: true }));
    const first = await bounds(rows.nth(0));
    const second = await bounds(rows.nth(1));
    expect(overview.width).toBeGreaterThanOrEqual(heading.width - 1);
    expect(first.width).toBeGreaterThanOrEqual(items.width - 1);
    expect(second.width).toBeGreaterThanOrEqual(items.width - 1);
    expect(second.x).toBe(first.x);
    expect(second.y).toBeGreaterThanOrEqual(first.y + first.height - 1);
    expect(second.y - first.y - first.height).toBeLessThanOrEqual(1);
    for (const row of [first, second]) {
      expect(row.height).toBeLessThanOrEqual(viewport.width === 1440 ? 150 : 180);
    }
    if (viewport.width === 1440) {
      expect(panel.width).toBeGreaterThanOrEqual(overview.width * 0.7);
      expect(first.width).toBeGreaterThan(650);
      expect(sidebar.x).toBeGreaterThan(panel.x + panel.width);
      expect(sidebar.y).toBe(panel.y);
      expect(sidebar.x + sidebar.width).toBeCloseTo(overview.x + overview.width, 0);
    } else {
      expect(panel.width).toBeGreaterThanOrEqual(overview.width - 1);
      expect(sidebar.width).toBeGreaterThanOrEqual(panel.width - 1);
      expect(sidebar.y).toBeGreaterThanOrEqual(panel.y + panel.height);
    }
    const firstAction = page.getByRole("button", { name: "引导造句", exact: true }).first();
    await expect(firstAction).toBeInViewport({ ratio: 1 });
    const action = await bounds(firstAction);
    expect(action.y + action.height).toBeLessThanOrEqual(viewport.height);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
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
        const panel = document.querySelector(".practice-main-panel");
        if (heading === null || panel === null) throw new Error("Practice layout is incomplete.");
        return {
          action: root.getPropertyValue("--action").trim(),
          headingWidth: Math.round(heading.getBoundingClientRect().width),
          overflow: document.documentElement.scrollWidth - window.innerWidth,
          panelWidth: Math.round(panel.getBoundingClientRect().width),
        };
      });

      expect(contract.action).toBe(appearance.action);
      expect(contract.overflow).toBeLessThanOrEqual(0);
      expect(contract.headingWidth).toBeGreaterThan(0);
      expect(contract.panelWidth).toBeGreaterThanOrEqual(
        contract.headingWidth * (viewport.width === 1440 ? 0.7 : 0.99),
      );
      await expect(page.locator(".practice-item-row")).toHaveCount(2);
      await expect(page.getByRole("button", { name: "造句练习", exact: true })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      await expect(page.getByRole("checkbox")).toHaveCount(0);
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

  const sentenceMode = page.getByRole("button", { name: "造句练习", exact: true });
  const dialogueMode = page.getByRole("button", { name: "情境对话", exact: true });
  const choice = page.getByRole("checkbox", { name: "to be completely frank", exact: true });
  const startDialogue = page.getByRole("button", { name: "开始对话", exact: true });
  await expect(sentenceMode).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("checkbox")).toHaveCount(0);
  await expect(startDialogue).toHaveCount(0);
  await dialogueMode.click();
  await expect(dialogueMode).toHaveAttribute("aria-pressed", "true");
  await expect(sentenceMode).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByRole("button", { name: "引导造句", exact: true })).toHaveCount(0);
  await expect(choice).not.toBeChecked();
  await expect(startDialogue).toBeDisabled();
  await choice.check();
  await expect(startDialogue).toBeEnabled();

  await page.locator(".appearance-menu > summary").click();
  const silver = page.getByRole("radio", { name: "流银镜白" });
  await silver.focus();
  await silver.press("ArrowRight");
  await expect(page.getByRole("radio", { name: "香槟晨霜" })).toBeChecked();
  await expect(page.locator("html")).toHaveAttribute("data-appearance", "champagne");
  await expect(page.getByText("今日已练习 0 / 2 项", { exact: true })).toBeVisible();
  await expect(dialogueMode).toHaveAttribute("aria-pressed", "true");
  await expect(choice).toBeChecked();
  await expect(startDialogue).toBeEnabled();
  await expect(page.getByText("已选 1 / 3 项", { exact: true })).toBeVisible();

  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-appearance", "champagne");
  await expect(page.getByText("今日已练习 0 / 2 项", { exact: true })).toBeVisible();
  await expect(sentenceMode).toHaveAttribute("aria-pressed", "true");
  await expect(dialogueMode).toHaveAttribute("aria-pressed", "false");
  await expect(page.getByRole("checkbox")).toHaveCount(0);
  await expect(startDialogue).toHaveCount(0);
  await expect(page.getByRole("button", { name: "引导造句", exact: true })).toHaveCount(2);
  await dialogueMode.click();
  await expect(choice).not.toBeChecked();
  await expect(startDialogue).toBeDisabled();
  expect(authority.snapshot().practiceProviderCallCount).toBe(0);
  expect(authority.snapshot().requestFacts.filter((fact) => fact.method !== "GET")).toEqual([]);
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
  await expect.soft(page).toHaveScreenshot("practice-silver-desktop.png", {
    animations: "disabled",
    maxDiffPixelRatio: 0.02,
  });

  await page.setViewportSize({ height: 844, width: 390 });
  await page.reload();
  await expect(page.getByText("今日已练习 0 / 2 项", { exact: true })).toBeVisible();
  await expect.soft(page).toHaveScreenshot("practice-silver-mobile.png", {
    animations: "disabled",
    maxDiffPixelRatio: 0.02,
  });
});
