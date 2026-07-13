import { expect, test } from "@playwright/test";

import {
  dragSelect,
  expectAnalyzeRequest,
  expectInsideViewport,
  nativeRequests,
  openWordResult,
  overlayHost,
  panel,
  selectionFixturePath,
  toolbar,
} from "./support/journey-helpers.js";

test.beforeEach(async ({ page }) => {
  await page.goto(selectionFixturePath);
});

test("double-click classifies a word and renders lexical translation", async ({ page }) => {
  await page.getByTestId("word-selection").dblclick();

  await expect(toolbar(page)).toBeVisible();
  await toolbar(page).locator('[data-action="translate"]').click();

  await expect(panel(page)).toContainText("词汇翻译结果");
  await expect(panel(page)).toContainText("相似词");
  await expectAnalyzeRequest(page, "word", "translate");
});

test("drag selection classifies a phrase and renders lexical explanation", async ({ page }) => {
  await dragSelect(page, page.getByTestId("phrase-selection"));

  await expect(toolbar(page)).toBeVisible();
  await toolbar(page).locator('[data-action="explain"]').click();

  await expect(panel(page)).toContainText("词汇解释结果");
  await expect(panel(page)).toContainText("同义词");
  await expectAnalyzeRequest(page, "phrase", "explain");
});

test("a translated word can be added with its exact English sentence", async ({ page }) => {
  const resultPanel = await openWordResult(page, "word-selection");
  const button = resultPanel.locator('[data-action="add-word"]');

  await expect(button).toHaveText("加入欧路生词本");
  await button.dblclick();

  await expect(button).toHaveText("已加入生词本");
  await expect(button).toBeDisabled();
  const addRequest = nativeRequests(page, "add-word");
  await expect(addRequest).toHaveCount(1);
  await expect(addRequest).toHaveAttribute("data-word", "investigation");
  await expect(addRequest).toHaveAttribute(
    "data-wordbook-context",
    "He said the investigation was still in its early stages.",
  );
});

test("an explained word can be added and an existing word is not overwritten", async ({ page }) => {
  const explainedPanel = await openWordResult(page, "word-selection", "explain");
  await explainedPanel.locator('[data-action="add-word"]').click();
  await expect(explainedPanel.locator('[data-action="add-word"]')).toHaveText("已加入生词本");

  await page.getByTestId("existing-word-selection").dblclick();
  await toolbar(page).locator('[data-action="translate"]').click();
  const existingButton = panel(page).locator('[data-action="add-word"]');
  await expect(existingButton).toHaveText("已加入生词本");
  await expect(existingButton).toBeDisabled();
});

for (const [testId, message] of [
  ["unconfigured-word-selection", "尚未配置欧路授权"],
  ["unauthorized-word-selection", "欧路授权无效或已过期"],
  ["network-word-selection", "无法连接欧路服务"],
] as const) {
  test(`a recoverable Eudic error can be retried for ${testId}`, async ({ page }) => {
    const resultPanel = await openWordResult(page, testId);
    const button = resultPanel.locator('[data-action="add-word"]');

    await button.click();
    await expect(resultPanel.locator(".huayi-wordbook-error")).toContainText(message);
    await expect(button).toBeEnabled();
    await button.click();

    await expect(button).toHaveText("已加入生词本");
  });
}

test("rate limiting disables wordbook retry on the current result", async ({ page }) => {
  const resultPanel = await openWordResult(page, "rate-limited-word-selection");
  const button = resultPanel.locator('[data-action="add-word"]');

  await button.click();

  await expect(resultPanel.locator(".huayi-wordbook-error")).toContainText("欧路请求过于频繁");
  await expect(button).toBeDisabled();
});

test("closing a pending wordbook write sends a targeted cancel", async ({ page }) => {
  const resultPanel = await openWordResult(page, "pending-word-selection");
  await resultPanel.locator('[data-action="add-word"]').click();

  const addRequest = nativeRequests(page, "add-word");
  await expect(addRequest).toHaveCount(1);
  const requestId = await addRequest.getAttribute("data-request-id");
  expect(requestId).not.toBeNull();
  await expect(resultPanel.locator('[data-action="add-word"]')).toHaveText("正在添加…");
  await resultPanel.locator('[data-action="close"]').click();

  await expect(overlayHost(page)).toHaveCount(0);
  await expect(nativeRequests(page, "cancel")).toHaveAttribute(
    "data-target-request-id",
    requestId ?? "",
  );
});

test("drag selection classifies a sentence and renders sentence explanation", async ({ page }) => {
  await dragSelect(page, page.getByTestId("sentence-selection"));

  await expect(toolbar(page)).toBeVisible();
  await toolbar(page).locator('[data-action="explain"]').click();

  await expect(panel(page)).toContainText("句子解释主干");
  await expect(panel(page)).toContainText("语境作用");
  await expectAnalyzeRequest(page, "sentence", "explain");
});

test("paragraph selection offers translation only and renders passage translation", async ({
  page,
}) => {
  await dragSelect(page, page.getByTestId("paragraph-selection"));

  await expect(toolbar(page)).toBeVisible();
  await expect(toolbar(page).locator('[data-action="explain"]')).toHaveCount(0);
  await expect(toolbar(page).locator('[data-action="translate"]')).toHaveCount(1);
  await toolbar(page).locator('[data-action="translate"]').click();

  await expect(panel(page)).toContainText("段落翻译结果");
  await expectAnalyzeRequest(page, "paragraph", "translate");
});

test("a retryable native error can be retried successfully", async ({ page }) => {
  await dragSelect(page, page.getByTestId("retry-selection"));
  await toolbar(page).locator('[data-action="translate"]').click();

  await expect(panel(page)).toContainText("模拟网络暂时不可用，请重试。");
  await expect(panel(page).locator('[data-action="retry"]')).toBeVisible();
  await panel(page).locator('[data-action="retry"]').click();

  await expect(panel(page)).toContainText("词汇翻译结果");
  await expect(nativeRequests(page, "analyze")).toHaveCount(2);
});

test("an unresponsive native request times out and sends a targeted cancel", async ({ page }) => {
  await page.goto(`${selectionFixturePath}?request-timeout-ms=1000`);
  await dragSelect(page, page.getByTestId("timeout-selection"));
  await toolbar(page).locator('[data-action="translate"]').click();

  const analyzeRequest = nativeRequests(page, "analyze");
  await expect(analyzeRequest).toHaveCount(1);
  const analyzeRequestId = await analyzeRequest.getAttribute("data-request-id");
  expect(analyzeRequestId).not.toBeNull();

  await expect(panel(page)).toContainText("处理超时，请重试。");
  await expect(nativeRequests(page, "cancel")).toHaveAttribute(
    "data-target-request-id",
    analyzeRequestId ?? "",
  );
});

test("a new selection cancels the active native request", async ({ page }) => {
  await dragSelect(page, page.getByTestId("pending-selection"));
  await toolbar(page).locator('[data-action="translate"]').click();
  await expect(panel(page)).toContainText("正在翻译");

  const firstRequest = nativeRequests(page, "analyze");
  await expect(firstRequest).toHaveCount(1);
  const firstRequestId = await firstRequest.getAttribute("data-request-id");
  expect(firstRequestId).not.toBeNull();

  const cancel = nativeRequests(page, "cancel");
  await page.waitForTimeout(1_100);
  await expect(cancel).toHaveCount(0);
  await page.getByTestId("replacement-selection").dblclick();

  await expect(cancel).toHaveCount(1);
  await expect(cancel).toHaveAttribute("data-target-request-id", firstRequestId ?? "");
  await expect(toolbar(page)).toBeVisible();
  await toolbar(page).locator('[data-action="translate"]').click();
  await expect(panel(page)).toContainText("词汇翻译结果");
  await expectAnalyzeRequest(page, "word", "translate");
});

test("the close button cancels the active native request", async ({ page }) => {
  await dragSelect(page, page.getByTestId("pending-selection"));
  await toolbar(page).locator('[data-action="translate"]').click();
  await expect(panel(page)).toContainText("正在翻译");

  const firstRequest = nativeRequests(page, "analyze");
  const firstRequestId = await firstRequest.getAttribute("data-request-id");
  expect(firstRequestId).not.toBeNull();
  const cancel = nativeRequests(page, "cancel");
  await expect(cancel).toHaveCount(0);
  await panel(page).locator('[data-action="close"]').click();

  await expect(overlayHost(page)).toHaveCount(0);
  await expect(cancel).toHaveAttribute("data-target-request-id", firstRequestId ?? "");
});

test("Escape closes the selection toolbar", async ({ page }) => {
  await page.getByTestId("word-selection").dblclick();
  await expect(toolbar(page)).toBeVisible();

  await page.keyboard.press("Escape");

  await expect(overlayHost(page)).toHaveCount(0);
  await expect(nativeRequests(page, "analyze")).toHaveCount(0);
});

test("a narrow viewport keeps the toolbar and draggable result panel constrained", async ({
  page,
}) => {
  await page.setViewportSize({ height: 480, width: 320 });
  await page.reload();

  await page.getByTestId("edge-selection").dblclick();
  await expect(toolbar(page)).toBeVisible();
  await expectInsideViewport(toolbar(page), page);
  await toolbar(page).locator('[data-action="translate"]').click();

  const resultPanel = panel(page);
  await expect(resultPanel).toContainText("词汇翻译结果");
  await expectInsideViewport(resultPanel, page);
  const resultBounds = await resultPanel.boundingBox();
  expect(resultBounds?.width).toBeLessThanOrEqual(304);
  await expect
    .poll(() =>
      resultPanel.locator(".huayi-body").evaluate((body) => body.scrollHeight > body.clientHeight),
    )
    .toBe(true);

  const dragHandle = resultPanel.locator("[data-drag-handle]");
  const handleBounds = await dragHandle.boundingBox();
  expect(handleBounds).not.toBeNull();
  if (handleBounds === null) {
    throw new Error("The overlay drag handle must have measurable bounds.");
  }
  await page.mouse.move(
    handleBounds.x + handleBounds.width / 2,
    handleBounds.y + handleBounds.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(1_000, 1_000, { steps: 5 });
  await page.mouse.up();

  await expectInsideViewport(resultPanel, page);
});
