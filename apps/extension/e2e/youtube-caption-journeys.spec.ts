import { expect, test } from "@playwright/test";

import { expectAnalyzeRequest, nativeRequests, panel, toolbar } from "./support/journey-helpers.js";

const youtubeFixturePath = "/apps/extension/e2e/fixtures/youtube-caption-journeys.html";

test.beforeEach(async ({ page }) => {
  await page.goto(youtubeFixturePath);
});

test("freezes a caption and analyzes an exact word beside its context", async ({ page }) => {
  const player = page.getByTestId("youtube-player");
  const control = player
    .locator("[data-huayi-youtube-control-host]")
    .getByRole("button", { name: "Huayi 字幕取词" });
  await expect(control).toBeEnabled();
  await control.click();

  const picker = player.locator("[data-huayi-youtube-picker-host]");
  await expect(picker).toBeVisible();
  const word = picker.getByRole("button", { exact: true, name: "investigation" });
  const wordBounds = await word.boundingBox();
  expect(wordBounds).not.toBeNull();
  if (wordBounds === null) {
    throw new Error("The selected caption word must have measurable bounds.");
  }
  const pointer = {
    x: wordBounds.x + wordBounds.width / 2,
    y: wordBounds.y + wordBounds.height / 2,
  };
  await page.mouse.click(pointer.x, pointer.y);

  const actionToolbar = toolbar(page);
  await expect(actionToolbar).toBeVisible();
  const toolbarBounds = await actionToolbar.boundingBox();
  expect(toolbarBounds).not.toBeNull();
  if (toolbarBounds !== null) {
    expect(Math.abs(toolbarBounds.x + toolbarBounds.width / 2 - pointer.x)).toBeLessThanOrEqual(12);
    expect(toolbarBounds.y + toolbarBounds.height).toBeLessThanOrEqual(pointer.y);
  }

  await actionToolbar.locator('[data-action="translate"]').click();
  const resultPanel = panel(page);
  await expect(resultPanel).toBeVisible();
  const panelBounds = await resultPanel.boundingBox();
  expect(panelBounds).not.toBeNull();
  if (panelBounds !== null) {
    expect(Math.abs(panelBounds.x + panelBounds.width / 2 - pointer.x)).toBeLessThanOrEqual(12);
  }
  const request = await expectAnalyzeRequest(page, "word", "translate");
  await expect(request).toHaveAttribute("data-selection-text", "investigation");
  await expect(request).toHaveAttribute(
    "data-analysis-context",
    "The investigation was still in its early stages.",
  );
  await expect(request).toHaveAttribute(
    "data-sentence-context",
    "The investigation was still in its early stages.",
  );

  const warmup = nativeRequests(page, "warmup");
  await expect(warmup).toHaveCount(1);
  await expect(warmup).toHaveAttribute("data-request-keys", "requestId,schemaVersion,type");
});

test("places whole-caption actions at the pointer and toggles the picker closed", async ({
  page,
}) => {
  const player = page.getByTestId("youtube-player");
  const control = player
    .locator("[data-huayi-youtube-control-host]")
    .getByRole("button", { name: "Huayi 字幕取词" });
  await control.click();

  const picker = player.locator("[data-huayi-youtube-picker-host]");
  const selectCaption = picker.getByRole("button", { name: "整句字幕" });
  const selectCaptionBounds = await selectCaption.boundingBox();
  expect(selectCaptionBounds).not.toBeNull();
  if (selectCaptionBounds === null) {
    throw new Error("The whole-caption action must have measurable bounds.");
  }
  const pointer = {
    x: selectCaptionBounds.x + selectCaptionBounds.width / 2,
    y: selectCaptionBounds.y + selectCaptionBounds.height / 2,
  };
  await page.mouse.click(pointer.x, pointer.y);

  const actionToolbar = toolbar(page);
  await expect(actionToolbar).toBeVisible();
  const toolbarBounds = await actionToolbar.boundingBox();
  expect(toolbarBounds).not.toBeNull();
  if (toolbarBounds !== null) {
    expect(Math.abs(toolbarBounds.x + toolbarBounds.width / 2 - pointer.x)).toBeLessThanOrEqual(12);
    expect(toolbarBounds.y + toolbarBounds.height).toBeLessThanOrEqual(pointer.y);
  }

  await control.click();
  await expect(picker).toBeHidden();
  await expect(actionToolbar).toBeHidden();
});

test("drags across stable caption words and sends one exact phrase", async ({ page }) => {
  const player = page.getByTestId("youtube-player");
  await player
    .locator("[data-huayi-youtube-control-host]")
    .getByRole("button", { name: "Huayi 字幕取词" })
    .click();

  const picker = player.locator("[data-huayi-youtube-picker-host]");
  const first = picker.getByRole("button", { exact: true, name: "early" });
  const last = picker.getByRole("button", { exact: true, name: "stages" });
  const firstBounds = await first.boundingBox();
  const lastBounds = await last.boundingBox();
  expect(firstBounds).not.toBeNull();
  expect(lastBounds).not.toBeNull();
  if (firstBounds === null || lastBounds === null) {
    throw new Error("Caption words must have measurable bounds.");
  }

  await page.mouse.move(
    firstBounds.x + firstBounds.width / 2,
    firstBounds.y + firstBounds.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(lastBounds.x + lastBounds.width / 2, lastBounds.y + lastBounds.height / 2, {
    steps: 8,
  });
  await page.mouse.up();

  await toolbar(page).locator('[data-action="explain"]').click();
  const request = await expectAnalyzeRequest(page, "phrase", "explain");
  await expect(request).toHaveAttribute("data-selection-text", "early stages");
  await expect(request).toHaveAttribute(
    "data-sentence-context",
    "The investigation was still in its early stages.",
  );
});

test("shows a rolling sentence immediately and sends only the completed target", async ({
  page,
}) => {
  await page.goto(`${youtubeFixturePath}?playing=true&caption=The%20investigation%20was%20still`);

  const player = page.getByTestId("youtube-player");
  await player
    .locator("[data-huayi-youtube-control-host]")
    .getByRole("button", { name: "Huayi 字幕取词" })
    .click();

  const picker = player.locator("[data-huayi-youtube-picker-host]");
  await expect(picker.getByText("正在补全当前句…")).toBeVisible();
  await expect(picker.getByRole("button", { name: "investigation" })).toHaveCount(0);

  await page.evaluate(() => {
    const caption = document.querySelector<HTMLElement>(".ytp-caption-segment");
    if (caption !== null) {
      caption.textContent = "was still in its early stages.";
    }
  });

  await picker.getByRole("button", { name: "investigation" }).click();
  await toolbar(page).locator('[data-action="translate"]').click();
  const request = await expectAnalyzeRequest(page, "word", "translate");
  await expect(request).toHaveAttribute(
    "data-analysis-context",
    "The investigation was still in its early stages.",
  );
  await expect(request).toHaveAttribute(
    "data-sentence-context",
    "The investigation was still in its early stages.",
  );
});

test("falls back to the current caption when no sentence ending arrives", async ({ page }) => {
  await page.goto(
    `${youtubeFixturePath}?playing=true&caption=An%20automatic%20caption%20without%20punctuation`,
  );
  const player = page.getByTestId("youtube-player");
  await player
    .locator("[data-huayi-youtube-control-host]")
    .getByRole("button", { name: "Huayi 字幕取词" })
    .click();

  const picker = player.locator("[data-huayi-youtube-picker-host]");
  await expect(picker.getByText("正在补全当前句…")).toBeVisible();
  await expect(picker.getByText("未检测到完整句尾，已使用当前片段")).toBeVisible();
  await picker.getByRole("button", { exact: true, name: "automatic" }).click();
  await toolbar(page).locator('[data-action="translate"]').click();

  const request = await expectAnalyzeRequest(page, "word", "translate");
  await expect(request).toHaveAttribute(
    "data-analysis-context",
    "An automatic caption without punctuation",
  );
  await expect(request).toHaveAttribute(
    "data-sentence-context",
    "An automatic caption without punctuation",
  );
});
