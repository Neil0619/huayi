import { expect, type Page, test } from "@playwright/test";

import {
  dragSelect,
  nativeRequests,
  overlayHost,
  panel,
  requestIds,
  selectionFixturePath,
  toolbar,
} from "./support/journey-helpers.js";

async function startWordAnalysis(
  page: Page,
  testId: string,
  action: "explain" | "translate" = "translate",
): Promise<void> {
  await page.getByTestId(testId).dblclick();
  await activateToolbarAction(page, action);
}

async function activateToolbarAction(
  page: Page,
  action: "explain" | "translate" = "translate",
): Promise<void> {
  await toolbar(page)
    .locator<HTMLButtonElement>(`[data-action="${action}"]`)
    .evaluate((button) => button.click());
}

async function observeWordbookLabels(page: Page, clickWhenEnabled = false): Promise<void> {
  await overlayHost(page).evaluate((host, shouldClick) => {
    const shadowRoot = host.shadowRoot;
    if (shadowRoot === null) {
      throw new Error("Overlay host must expose its shadow root.");
    }
    const labels: string[] = [];
    const observer = new MutationObserver(() => {
      const button = shadowRoot.querySelector<HTMLButtonElement>('[data-action="add-word"]');
      const label = button?.textContent;
      if (label !== null && label !== undefined && labels.at(-1) !== label) {
        labels.push(label);
        host.setAttribute("data-observed-wordbook-labels", JSON.stringify(labels));
      }
      if (shouldClick && button?.disabled === false && label === "加入欧路生词本") {
        observer.disconnect();
        button.click();
      }
    });
    observer.observe(shadowRoot, { childList: true, subtree: true });
  }, clickWhenEnabled);
}

async function observedWordbookLabels(page: Page): Promise<string[]> {
  const labels = await overlayHost(page).getAttribute("data-observed-wordbook-labels");
  return labels === null ? [] : (JSON.parse(labels) as string[]);
}

async function startPendingAnalysisAndCheck(page: Page): Promise<string[]> {
  await startWordAnalysis(page, "pending-analysis-word-selection");
  await expect(nativeRequests(page, "analyze")).toHaveCount(1);
  await expect(nativeRequests(page, "check-word")).toHaveCount(1);
  return requestIds(
    page.locator('[data-native-request="analyze"], [data-native-request="check-word"]'),
  );
}

async function expectCancelled(page: Page, requestIdsToCancel: string[]): Promise<void> {
  await expect
    .poll(async () => nativeRequests(page, "cancel").count())
    .toBe(requestIdsToCancel.length);
  await expect
    .poll(async () =>
      nativeRequests(page, "cancel").evaluateAll((entries) =>
        entries.map((entry) => (entry as HTMLElement).dataset.targetRequestId).sort(),
      ),
    )
    .toEqual([...requestIdsToCancel].sort());
}

test.beforeEach(async ({ page }) => {
  await page.goto(selectionFixturePath);
});

for (const [action, finalText] of [
  ["translate", "词汇翻译结果"],
  ["explain", "词汇解释结果"],
] as const) {
  test(`word ${action} streams before its final card`, async ({ page }) => {
    await startWordAnalysis(page, "word-selection", action);

    await expect(panel(page)).toContainText("正在逐步显示");
    await expect(panel(page)).toContainText(finalText);
  });
}

test("a present query updates streaming UI and logs only the checked word", async ({ page }) => {
  await startWordAnalysis(page, "existing-word-selection");

  await expect(panel(page)).toContainText("正在逐步显示");
  await expect(panel(page).locator('[data-action="add-word"]')).toHaveText("已加入生词本");
  await expect(nativeRequests(page, "check-word")).toHaveAttribute("data-word", "established");
  await expect(nativeRequests(page, "check-word")).not.toHaveAttribute(
    "data-wordbook-context",
    /.+/u,
  );
  await expect(panel(page)).toContainText("词汇翻译结果");
});

test("a late present query replaces the enabled result action in place", async ({ page }) => {
  await page.getByTestId("late-existing-word-selection").dblclick();
  await observeWordbookLabels(page);
  await activateToolbarAction(page);
  const button = panel(page).locator('[data-action="add-word"]');

  await expect.poll(() => observedWordbookLabels(page)).toEqual(["加入欧路生词本", "已加入生词本"]);
  await expect(button).toHaveText("已加入生词本");
  await expect(button).toBeDisabled();
});

for (const [testId, word] of [
  ["word-selection", "investigation"],
  ["unconfigured-word-selection", "unconfigured"],
] as const) {
  test(`an absent or failed passive query preserves add for ${word}`, async ({ page }) => {
    await startWordAnalysis(page, testId);
    const button = panel(page).locator('[data-action="add-word"]');

    await expect(panel(page)).toContainText("词汇翻译结果");
    await expect(button).toHaveText("加入欧路生词本");
    await expect(button).toBeEnabled();
    await expect(nativeRequests(page, "check-word")).toHaveAttribute("data-word", word);
  });
}

test("phrases, sentences, and paragraphs never query the wordbook", async ({ page }) => {
  await dragSelect(page, page.getByTestId("phrase-selection"));
  await toolbar(page).locator('[data-action="translate"]').click();
  await expect(panel(page)).toContainText("词汇翻译结果");

  await dragSelect(page, page.getByTestId("sentence-selection"));
  await toolbar(page).locator('[data-action="translate"]').click();
  await expect(panel(page)).toContainText("段落翻译结果");

  await dragSelect(page, page.getByTestId("paragraph-selection"));
  await toolbar(page).locator('[data-action="translate"]').click();
  await expect(panel(page)).toContainText("段落翻译结果");

  await expect(nativeRequests(page, "check-word")).toHaveCount(0);
});

test("explicit add cancels only a pending check and keeps the original sentence", async ({
  page,
}) => {
  await page.getByTestId("late-existing-word-selection").dblclick();
  await observeWordbookLabels(page, true);
  await activateToolbarAction(page);
  const checkRequest = nativeRequests(page, "check-word");
  const checkRequestId = await checkRequest.getAttribute("data-request-id");
  expect(checkRequestId).not.toBeNull();
  const button = panel(page).locator('[data-action="add-word"]');

  await expectCancelled(page, [checkRequestId ?? ""]);
  await expect(nativeRequests(page, "add-word")).toHaveAttribute("data-word", "lateexisting");
  await expect(nativeRequests(page, "add-word")).toHaveAttribute(
    "data-wordbook-context",
    "The lateexisting term reports its existing status after the analysis result.",
  );
  await expect(button).toHaveText("已加入生词本");
});

test("close cancels both pending request lanes", async ({ page }) => {
  const pendingIds = await startPendingAnalysisAndCheck(page);

  await panel(page).locator('[data-action="close"]').click();

  await expect(overlayHost(page)).toHaveCount(0);
  await expectCancelled(page, pendingIds);
});

test("a new selection cancels both pending request lanes", async ({ page }) => {
  const pendingIds = await startPendingAnalysisAndCheck(page);

  await page.getByTestId("replacement-selection").dblclick();

  await expect(toolbar(page)).toBeVisible();
  await expectCancelled(page, pendingIds);
});

test("Escape cancels both pending request lanes", async ({ page }) => {
  const pendingIds = await startPendingAnalysisAndCheck(page);

  await page.keyboard.press("Escape");

  await expect(overlayHost(page)).toHaveCount(0);
  await expectCancelled(page, pendingIds);
});

test("late delta and status cannot mutate a replacement overlay", async ({ page }) => {
  await startWordAnalysis(page, "stale-event-word-selection");
  await expect(panel(page)).toContainText("正在逐步显示");

  await page.getByTestId("replacement-selection").dblclick();
  await toolbar(page).locator('[data-action="translate"]').click();
  await expect(panel(page)).toContainText("词汇翻译结果");
  await page.waitForTimeout(1_800);

  await expect(panel(page)).not.toContainText("迟到文本");
  await expect(panel(page).locator('[data-action="add-word"]')).toHaveText("加入欧路生词本");
});

test("a narrow result keeps the header action, drag handle, and close control separate", async ({
  page,
}) => {
  await page.setViewportSize({ height: 480, width: 320 });
  await page.reload();
  await startWordAnalysis(page, "word-selection");
  await expect(panel(page)).toContainText("词汇翻译结果");

  const action = panel(page).locator('[data-action="add-word"]');
  const dragHandle = panel(page).locator("[data-drag-handle]");
  const close = panel(page).locator('[data-action="close"]');
  await expect(action).toBeVisible();
  await expect(dragHandle).toBeVisible();
  await expect(close).toBeVisible();

  const [actionBox, dragBox, closeBox] = await Promise.all([
    action.boundingBox(),
    dragHandle.boundingBox(),
    close.boundingBox(),
  ]);
  expect(actionBox).not.toBeNull();
  expect(dragBox).not.toBeNull();
  expect(closeBox).not.toBeNull();
  if (actionBox === null || dragBox === null || closeBox === null) {
    throw new Error("Header controls must have measurable bounds.");
  }
  expect(actionBox.x).toBeGreaterThanOrEqual(dragBox.x + dragBox.width);
  expect(closeBox.x).toBeGreaterThanOrEqual(actionBox.x + actionBox.width);
});
