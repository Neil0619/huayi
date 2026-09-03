import { expect, test, type Page } from "@playwright/test";

const fixturePath = "/apps/store-extension/e2e/fixtures/release.html";
const crossPlatformChineseGlyphDiffRatio = 0.06;

async function selectWord(page: Page, testId: string): Promise<void> {
  await page.getByTestId(testId).dblclick();
}

function overlay(page: Page) {
  return page.locator("[data-huayi-store-overlay]");
}

function shadow(page: Page) {
  return overlay(page).locator("section.panel");
}

async function expectActionCardContract(page: Page, theme: "pearl" | "parchment"): Promise<void> {
  const panel = shadow(page);
  const actions = panel.locator(".mode-actions > [data-action]");

  await expect(panel).toHaveAttribute("data-theme", theme);
  expect(
    await panel.evaluate((element) =>
      getComputedStyle(element).getPropertyValue("--material-blur").trim(),
    ),
  ).toBe(theme === "pearl" ? "34px" : "22px");
  await expect(panel).toHaveCSS("width", "120px");
  await expect(panel).toHaveCSS("border-radius", "13px");
  await expect(panel.locator(".action-header")).toHaveCSS("padding", "6px");
  await expect(panel.locator(".mode-actions")).toHaveCSS("gap", "4px");
  await expect(actions).toHaveCount(2);
  await expect(actions.nth(0)).toHaveAttribute("data-action", "explain");
  await expect(actions.nth(0)).toHaveText("解释");
  await expect(actions.nth(1)).toHaveAttribute("data-action", "translate");
  await expect(actions.nth(1)).toHaveText("翻译");
  await expect(actions.nth(0)).toHaveCSS("min-height", "32px");
  await expect(actions.nth(0)).toHaveCSS("border-radius", "8px");
  await expect(actions.nth(0)).toHaveCSS("color", "rgb(37, 41, 46)");
  await expect(actions.nth(0)).toHaveCSS("background-color", "rgba(255, 255, 255, 0.62)");
  await expect(actions.nth(0)).toHaveCSS("font-size", "14px");
}

test.beforeEach(async ({ page }) => {
  await page.goto(fixturePath);
  await expect(page.locator("html")).toHaveAttribute("data-store-harness-ready", "true");
});

test("the actual Store bundle renders all four appearances without changing card structure", async ({
  page,
}) => {
  test.slow();
  const appearances = [
    ["moon", "#29394b"],
    ["silver", "#24282d"],
    ["champagne", "#503c31"],
    ["porcelain", "#304477"],
  ] as const;

  for (const [appearance, action] of appearances) {
    await page.evaluate(({ key, value }) => window.localStorage.setItem(key, value), {
      key: "huayi.store.e2e.appearance",
      value: appearance,
    });
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-store-harness-ready", "true");
    await selectWord(page, "word");

    const panel = shadow(page);
    await expect(panel).toBeVisible();
    await expect(panel).toHaveAttribute("data-appearance", appearance);
    await expect(panel).toHaveAttribute("data-theme", "pearl");
    await expect(panel).toHaveAttribute("data-styles", "ready");
    expect(
      await panel.evaluate((element) =>
        getComputedStyle(element).getPropertyValue("--overlay-action").trim(),
      ),
    ).toBe(action);
    expect(
      await panel.evaluate((element) => element.scrollWidth - element.clientWidth),
    ).toBeLessThanOrEqual(0);
    await page.keyboard.press("Escape");
    await expect(overlay(page)).toHaveCount(0);
  }
});

test("the default silver Store card keeps explain-first behavior and visual baselines", async ({
  page,
}) => {
  await selectWord(page, "word");
  await expect(shadow(page)).toHaveAttribute("data-styles", "ready");
  await expectActionCardContract(page, "pearl");
  await expect(shadow(page)).toHaveScreenshot("store-silver-pearl-action.png", {
    animations: "disabled",
    maxDiffPixelRatio: crossPlatformChineseGlyphDiffRatio,
  });

  await page.goto(`${fixturePath}?theme=parchment`);
  await expect(page.locator("html")).toHaveAttribute("data-store-harness-ready", "true");
  await selectWord(page, "word");
  await expect(shadow(page)).toHaveAttribute("data-styles", "ready");
  await expectActionCardContract(page, "parchment");
  await expect(shadow(page)).toHaveScreenshot("store-silver-parchment-action.png", {
    animations: "disabled",
    maxDiffPixelRatio: crossPlatformChineseGlyphDiffRatio,
  });
});

test("the narrow action card centers on the selection", async ({ page }) => {
  await page.setViewportSize({ height: 360, width: 320 });
  const target = page.getByTestId("word");
  await target.evaluate((element) => {
    element.style.position = "fixed";
    element.style.left = "140px";
    element.style.top = "96px";
  });
  await selectWord(page, "word");

  const targetBounds = await target.boundingBox();
  const panelBounds = await shadow(page).boundingBox();
  if (targetBounds === null || panelBounds === null) {
    throw new Error("The selection and Store action card must have measurable bounds.");
  }
  expect(
    Math.abs(targetBounds.x + targetBounds.width / 2 - (panelBounds.x + panelBounds.width / 2)),
  ).toBeLessThanOrEqual(4);
});

test("the expanded Store result clamps to a short narrow viewport", async ({ page }) => {
  await page.setViewportSize({ height: 260, width: 320 });
  const target = page.getByTestId("word");
  await target.evaluate((element) => {
    element.style.position = "fixed";
    element.style.right = "0";
    element.style.bottom = "4px";
  });
  await selectWord(page, "word");
  await shadow(page).locator('[data-action="translate"]').click();
  await expect(shadow(page)).toContainText("调查");

  const bounds = await shadow(page).boundingBox();
  if (bounds === null) throw new Error("The Store result card must have measurable bounds.");
  expect(bounds.x).toBeGreaterThanOrEqual(8);
  expect(bounds.y).toBeGreaterThanOrEqual(8);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(312.5);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(252.5);
  expect(
    await shadow(page).evaluate((element) => element.scrollHeight > element.clientHeight),
  ).toBe(true);
});

test("Store selection reaches a strict fake Provider result and saves only bounded fields", async ({
  page,
}) => {
  await selectWord(page, "word");
  await expect(shadow(page)).toBeVisible();
  await shadow(page).locator('[data-action="translate"]').click();

  await expect(shadow(page)).toContainText("调查");
  await expect(page.locator('[data-log-type="analysis"]')).toHaveAttribute(
    "data-message-keys",
    "action,boundaryEvidence,messageVersion,selection,sentenceContext,type",
  );
  await shadow(page).locator("[data-save-word]").click();
  await expect(shadow(page)).toContainText("已保存到本地生词本");
  await expect(page.locator('[data-log-type="lexicon"]')).toHaveAttribute(
    "data-message-keys",
    "contextualMeaningZh,headword,messageVersion,sentence,type",
  );
});

test("Provider failure never retries until the user explicitly retries", async ({ page }) => {
  await selectWord(page, "failure-word");
  await shadow(page).locator('[data-action="translate"]').click();
  await expect(shadow(page)).toContainText("网络连接失败");
  await page.waitForTimeout(250);
  await expect(page.locator('[data-log-type="analysis"]')).toHaveCount(1);

  await shadow(page).locator("[data-retry]").click();
  await expect(page.locator('[data-log-type="analysis"]')).toHaveCount(2);
});

test("the popup relay disables the current site without receiving its URL", async ({ page }) => {
  await page.getByTestId("disable-site").click();
  await expect(page.getByTestId("site-status")).toHaveText("disabled");

  await selectWord(page, "word");
  await expect(overlay(page)).toHaveCount(0);
  await expect(page.locator('[data-log-type="site-toggle"]')).toHaveAttribute(
    "data-message-keys",
    "enabled,messageVersion,type",
  );
});
