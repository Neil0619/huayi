import { expect, type Locator, type Page } from "@playwright/test";

export const selectionFixturePath = "/apps/extension/e2e/fixtures/selection-journeys.html";

export function overlayHost(page: Page): Locator {
  return page.locator("[data-huayi-overlay-host]");
}

export function toolbar(page: Page): Locator {
  return overlayHost(page).locator(".huayi-toolbar");
}

export function panel(page: Page): Locator {
  return overlayHost(page).locator(".huayi-panel");
}

export function nativeRequests(
  page: Page,
  type: "add-word" | "analyze" | "cancel" | "check-word",
): Locator {
  return page.locator(`[data-native-request="${type}"]`);
}

export async function openWordResult(
  page: Page,
  testId: string,
  action: "explain" | "translate" = "translate",
): Promise<Locator> {
  await page.getByTestId(testId).dblclick();
  await toolbar(page).locator(`[data-action="${action}"]`).click();
  const resultPanel = panel(page);
  await expect(resultPanel).toContainText(action === "translate" ? "词汇翻译结果" : "词汇解释结果");
  return resultPanel;
}

export async function dragSelect(page: Page, target: Locator): Promise<void> {
  await target.scrollIntoViewIfNeeded();
  const bounds = await target.boundingBox();
  expect(bounds).not.toBeNull();
  if (bounds === null) {
    throw new Error("Selection target has no layout box.");
  }

  const centerY = bounds.y + bounds.height / 2;
  await page.mouse.move(bounds.x + 1, centerY);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width - 1, centerY, { steps: 12 });
  await page.mouse.up();
}

export async function expectAnalyzeRequest(
  page: Page,
  selectionKind: "word" | "phrase" | "sentence" | "paragraph",
  action: "translate" | "explain",
): Promise<Locator> {
  const request = page.locator(
    `[data-native-request="analyze"][data-selection-kind="${selectionKind}"]` +
      `[data-analysis-action="${action}"]`,
  );
  await expect(request).toHaveCount(1);
  return request;
}

export async function expectInsideViewport(locator: Locator, page: Page): Promise<void> {
  const subpixelTolerance = 0.5;
  const bounds = await locator.boundingBox();
  const viewport = page.viewportSize();
  expect(bounds).not.toBeNull();
  expect(viewport).not.toBeNull();
  if (bounds === null || viewport === null) {
    throw new Error("The overlay and viewport must both have measurable bounds.");
  }

  expect(bounds.x).toBeGreaterThanOrEqual(8);
  expect(bounds.y).toBeGreaterThanOrEqual(8);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width - 8 + subpixelTolerance);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height - 8 + subpixelTolerance);
}

export async function requestIds(requests: Locator): Promise<string[]> {
  return requests.evaluateAll((entries) =>
    entries.flatMap((entry) => {
      const requestId = (entry as HTMLElement).dataset.requestId;
      return requestId === undefined ? [] : [requestId];
    }),
  );
}
