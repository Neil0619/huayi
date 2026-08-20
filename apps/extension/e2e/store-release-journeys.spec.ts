import { expect, test, type Page } from "@playwright/test";

const fixturePath = "/apps/store-extension/e2e/fixtures/release.html";

async function selectWord(page: Page, testId: string): Promise<void> {
  await page.getByTestId(testId).dblclick();
}

function overlay(page: Page) {
  return page.locator("[data-huayi-store-overlay]");
}

function shadow(page: Page) {
  return overlay(page).locator("section.panel");
}

test.beforeEach(async ({ page }) => {
  await page.goto(fixturePath);
  await expect(page.locator("html")).toHaveAttribute("data-store-harness-ready", "true");
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
