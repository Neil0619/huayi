import { expect, test, type Page } from "@playwright/test";

const fixturePath = "/apps/extension/e2e/fixtures/shanbay-journeys.html";

async function openScenario(page: Page, scenario: string): Promise<void> {
  await page.goto(`${fixturePath}?scenario=${scenario}`);
}

function commandLog(page: Page) {
  return page.getByTestId("messages");
}

test("prefills a current Shanbay dialog and waits for the user's final click", async ({ page }) => {
  await openScenario(page, "success");
  await expect(page.locator("textarea")).toHaveValue("accepted\norbiting");
  await expect(commandLog(page)).not.toContainText("RESOLVE_SHANBAY_BATCH");

  await page.getByRole("button", { name: "批量添加", exact: true }).click();
  await expect(commandLog(page)).toContainText(
    '"rejectedTargets":[],"type":"RESOLVE_SHANBAY_BATCH"',
  );
});

test("resolves an exact partial failure before replacing only its residual words", async ({
  page,
}) => {
  await openScenario(page, "partial");
  await expect(page.locator("textarea")).toHaveValue("accepted\norbiting");
  await page.getByRole("button", { name: "批量添加", exact: true }).click();
  await expect(commandLog(page)).toContainText(
    '"rejectedTargets":["orbiting"],"type":"RESOLVE_SHANBAY_BATCH"',
  );

  await page.evaluate(() => {
    const fixture = (
      globalThis as typeof globalThis & {
        huayiShanbayFixture: {
          deliverLemmaBatch(): void;
          deliverResolved(): void;
        };
      }
    ).huayiShanbayFixture;
    fixture.deliverResolved();
    fixture.deliverLemmaBatch();
  });
  await expect(page.locator("textarea")).toHaveValue("orbit");
  await expect(page.locator("[data-huayi-shanbay-sync]")).toContainText("orbiting → orbit");
});

test("passes an exactly verified all-rejected result to offline word-form handling", async ({
  page,
}) => {
  await openScenario(page, "all-failed");
  await expect(page.locator("textarea")).toHaveValue("accepted\norbiting");
  await page.getByRole("button", { name: "批量添加", exact: true }).click();
  await expect(commandLog(page)).toContainText(
    '"rejectedTargets":["accepted","orbiting"],"type":"RESOLVE_SHANBAY_BATCH"',
  );
});

test("does not overwrite existing Shanbay input", async ({ page }) => {
  await openScenario(page, "existing");
  await expect(page.locator("textarea")).toHaveValue("user content");
  await expect(page.locator("[data-huayi-shanbay-sync]")).toContainText("批量输入框已有内容");
});

test("fails closed for login and changed-page fixtures", async ({ page }) => {
  await openScenario(page, "login");
  await expect(page.locator("[data-huayi-shanbay-sync]")).toContainText("请先登录扇贝");

  await openScenario(page, "changed");
  await expect(page.locator("[data-huayi-shanbay-sync]")).toContainText("扇贝页面结构已变化");
  await expect(commandLog(page)).not.toContainText("RESOLVE_SHANBAY_BATCH");
});

test("discards one unresolved word without hiding it before the Host responds", async ({
  page,
}) => {
  await openScenario(page, "unresolved");
  await expect(page.locator("[data-huayi-shanbay-sync]")).toContainText("splendidly");

  await page.locator('button[data-source-word="splendidly"]').click();

  await expect(commandLog(page)).toContainText(
    '"sourceWords":["splendidly"],"type":"DISCARD_SHANBAY_UNRESOLVED"',
  );
  await expect(page.locator("[data-huayi-shanbay-sync]")).toContainText("splendidly");
});

test("requires two clicks before discarding all unresolved words", async ({ page }) => {
  await openScenario(page, "unresolved");
  const discardAll = page.getByRole("button", { name: "全部放弃（11）", exact: true });

  await discardAll.click();
  await expect(page.getByRole("button", { name: "确认全部放弃（11）", exact: true })).toBeVisible();
  await expect(page.locator("[data-huayi-shanbay-sync]")).toContainText("不会再次自动同步");
  await expect(commandLog(page)).not.toContainText("DISCARD_ALL_SHANBAY_UNRESOLVED");

  await page.getByRole("button", { name: "确认全部放弃（11）", exact: true }).click();
  await expect(commandLog(page)).toContainText('"type":"DISCARD_ALL_SHANBAY_UNRESOLVED"');
});
