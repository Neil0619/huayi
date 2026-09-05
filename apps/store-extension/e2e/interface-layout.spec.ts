import { expect, test } from "@playwright/test";

const fixture = "/apps/store-extension/e2e/fixtures/interface.html";
const themes = ["moon", "silver", "champagne", "porcelain"] as const;

test("Eudic credential actions leave room for the focused input at both widths", async ({
  page,
}, testInfo) => {
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${fixture}?page=options`);
    await expect(page.locator("html")).toHaveAttribute("data-interface-ready", "true");
    await page.getByRole("tab", { name: "外部词典" }).click();
    const input = page.locator("[data-eudic-auth-input]");
    await input.focus();
    const field = await input.boundingBox();
    const save = await page.locator("[data-eudic-auth-save]").boundingBox();
    if (field === null || save === null) throw new Error("Credential controls missing");
    expect(save.y - (field.y + field.height)).toBeGreaterThanOrEqual(12);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
    ).toBeLessThanOrEqual(0);
    await page
      .locator("[data-wordbook-panel]")
      .screenshot({ path: testInfo.outputPath(`eudic-${width}.png`) });
  }
});

test("340px popup fits all four themes and keeps actionable queue failures visible", async ({
  page,
}) => {
  await page.setViewportSize({ width: 340, height: 620 });
  for (const theme of themes) {
    await page.goto(`${fixture}?theme=${theme}&queue=pending`);
    await expect(page.locator("html")).toHaveAttribute("data-interface-ready", "true");
    await expect(page.locator("[data-model-consent]")).toHaveAttribute("data-state", "allowed");
    await expect(page.locator(".outbox-row")).toBeVisible();
    await expect(page.locator("[data-submission-outbox-state]")).toHaveText("12 条待上传");
    await expect(page.getByRole("button", { name: "重试" })).toBeEnabled();
    await page.getByRole("button", { name: "选择外观" }).click();
    const layout = await page.evaluate(() => {
      const brand = document.querySelector(".popup-brand")?.getBoundingClientRect();
      const actions = document.querySelector(".header-actions")?.getBoundingClientRect();
      return {
        width: document.body.offsetWidth,
        overflow: document.documentElement.scrollWidth - innerWidth,
        overlap: (brand?.right ?? 0) - (actions?.left ?? 0),
      };
    });
    expect(layout.width).toBe(340);
    expect(layout.overflow).toBeLessThanOrEqual(0);
    expect(layout.overlap).toBeLessThan(0);
    await expect(page.locator("body")).toHaveScreenshot(`popup-${theme}.png`, {
      animations: "disabled",
    });
    await page.getByRole("button", { name: "霁蓝瓷光" }).click();
    await expect(page.locator("html")).toHaveAttribute("data-appearance", "porcelain");
  }
  await page.goto(`${fixture}?session=not-configured&consent=false`);
  await expect(page.locator(".outbox-row")).toBeHidden();
  await expect(page.locator("[data-cloud-session-state]")).toHaveText("此安装包不支持账号连接");
  await expect(page.locator("[data-model-consent]")).toHaveAttribute("data-state", "blocked");
  await page.goto(`${fixture}?queue=error&enabled=false`);
  await expect(page.locator(".outbox-row")).toBeVisible();
  await expect(page.locator(".outbox-row")).toContainText("读取失败");
  await expect(page.locator("[data-model-consent]")).toHaveAttribute("data-state", "inactive");
});

test("settings align search controls and expose help without overflowing at either width", async ({
  page,
}) => {
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${fixture}?page=options`);
    await expect(page.locator("html")).toHaveAttribute("data-interface-ready", "true");
    await expect(page.locator("[data-network-disclosure]")).not.toHaveAttribute("open");
    await expect(page).toHaveScreenshot(`settings-common-${width}.png`, { animations: "disabled" });
    await page.getByRole("tab", { name: "本地生词" }).click();
    const input = await page.locator("[data-lexicon-search-form] input").boundingBox();
    const button = await page.locator("[data-lexicon-search-form] button").boundingBox();
    expect(input).not.toBeNull();
    expect(button).not.toBeNull();
    expect(Math.abs((input?.y ?? 0) - (button?.y ?? 0))).toBeLessThanOrEqual(1);
    expect(input?.height).toBe(button?.height);
    await expect(page).toHaveScreenshot(`settings-lexicon-${width}.png`, {
      animations: "disabled",
    });
    await page.getByRole("button", { name: "本机生词说明" }).focus();
    await expect(page.getByRole("tooltip", { includeHidden: false })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("tooltip", { includeHidden: false })).toHaveCount(0);
    await page.getByRole("tab", { name: "网站管理" }).click();
    await expect(page.locator("[data-site-rule-row]")).toHaveCount(20);
    await page.locator("[data-site-rule-next]").click();
    await expect(page.locator("[data-site-rule-row]")).toHaveCount(1);
    await page.locator("[data-site-rule-delete]").click();
    await expect(page.locator("[data-site-rule-pagination]")).toBeHidden();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
    ).toBeLessThanOrEqual(0);
  }
});
