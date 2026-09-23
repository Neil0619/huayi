import { expect, test } from "../../../scripts/windows-visual-test.mjs";

const fixture = "/apps/store-extension/e2e/fixtures/interface.html";
const themes = ["moon", "silver", "champagne", "porcelain"] as const;

test("backfill cached counts and popup controls survive a stalled background refresh", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 340, height: 650 });
  await page.goto(`${fixture}?backfill&backfillCount=496&backfillChecking&slowBackfill`);
  await expect(page.locator("html")).toHaveAttribute("data-interface-ready", "true");
  const panel = page.locator("[data-backfill-panel]");
  await expect(panel).toContainText("待回填 496");
  await expect(panel).toContainText("数量会继续更新");
  await page.evaluate(() => window.dispatchEvent(new Event("fixture-backfill-progress")));
  await expect(panel.getByRole("button", { name: "打开扇贝回填" })).toBeEnabled();
  await page.getByRole("button", { name: "选择外观" }).click();
  await expect(page.getByRole("button", { name: "霁蓝瓷光" })).toBeVisible();
  await page.getByRole("button", { name: "霁蓝瓷光" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-appearance", "porcelain");
  await expect(panel.getByRole("alert")).toContainText("网络");
  await expect(panel).toContainText("待回填 496");
  await expect(panel.getByRole("button", { name: "打开扇贝回填" })).toBeEnabled();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
  ).toBeLessThanOrEqual(0);
  await panel.screenshot({ path: testInfo.outputPath("backfill-cached-496.png") });
});

test("backfill attention opens the page panel without adding popup editors", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 340, height: 650 });
  await page.goto(`${fixture}?backfill&backfillReviewCount=52`);
  const panel = page.locator("[data-backfill-panel]");
  await expect(panel).toContainText("待回填 0 · 需处理 52");
  await page.evaluate(() =>
    window.addEventListener("fixture-backfill-open", (event) =>
      Reflect.set(window, "backfillOpenRequest", (event as CustomEvent).detail),
    ),
  );
  await panel.getByRole("button", { name: "需处理", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => Reflect.get(window, "backfillOpenRequest")))
    .toEqual({
      type: "store/backfill-open",
      view: "review",
      expectedScope: "local",
    });
  await expect(panel.locator("input")).toHaveCount(0);
  await expect(panel.getByRole("button", { name: "修改并重试" })).toHaveCount(0);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
  ).toBeLessThanOrEqual(0);
  await panel.screenshot({ path: testInfo.outputPath("backfill-popup-review-link.png") });
});

test("backfill stays inside external dictionaries at both settings widths", async ({
  page,
}, testInfo) => {
  await page.route("**/*", async (route) => {
    if (new URL(route.request().url()).hostname === "127.0.0.1") await route.continue();
    else await route.abort();
  });
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${fixture}?page=options&backfill`);
    await expect(page.locator("html")).toHaveAttribute("data-interface-ready", "true");
    const panel = page.locator("[data-backfill-panel]");
    await expect(panel).toHaveCount(1);
    for (const name of ["常用设置", "模型与密钥", "网站管理", "本地生词", "外部词典"]) {
      await page.getByRole("tab", { name, exact: true }).click();
      if (name === "外部词典") await expect(panel).toBeVisible();
      else await expect(panel).toBeHidden();
    }
    await expect(panel).toContainText("待回填 0 · 需处理 0");
    await expect(panel.getByRole("button", { name: "需处理 (0)", exact: true })).toBeDisabled();
    const card = page.locator("[data-options-backfill-mount]");
    const bounds = await card.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds?.width).toBeGreaterThan(width === 1440 ? 700 : 300);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
    ).toBeLessThanOrEqual(0);
    await card.screenshot({ path: testInfo.outputPath(`backfill-settings-${width}.png`) });
    await page.getByRole("tab", { name: "常用设置", exact: true }).click();
    await expect(panel).toBeHidden();
  }
});

test("configures model access and its key together at both settings widths", async ({
  page,
}, testInfo) => {
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${fixture}?page=options`);
    await expect(page.locator("html")).toHaveAttribute("data-interface-ready", "true");
    await expect(page.getByLabel("模型服务商", { exact: true })).toBeHidden();
    await expect(page.getByLabel("划词后的默认动作", { exact: true })).toBeVisible();
    await page.getByRole("tab", { name: "模型与密钥", exact: true }).click();
    await expect(page.locator("[data-network-consent]")).toBeVisible();
    const provider = page.getByLabel("模型服务商", { exact: true });
    await provider.selectOption("deepseek");
    const key = page.getByLabel("新的 DeepSeek API Key", { exact: true });
    await expect(key).toBeVisible();
    await expect(page.getByLabel("新的 OpenAI API Key", { exact: true })).toBeHidden();
    await expect(page.getByLabel("划词后的默认动作", { exact: true })).toBeHidden();
    const selectorBox = await provider.boundingBox();
    const keyBox = await key.boundingBox();
    if (selectorBox === null || keyBox === null) throw new Error("Model fields are missing");
    expect(keyBox.y - selectorBox.y - selectorBox.height).toBeLessThanOrEqual(100);
    expect(Math.abs(keyBox.x - selectorBox.x)).toBeLessThanOrEqual(1);
    await key.fill("offline-deepseek-key");
    await page.getByRole("button", { name: "加密保存", exact: true }).click();
    await expect(key).toHaveValue("");
    await expect(key).toHaveAttribute("placeholder", "••••••••");
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
    ).toBeLessThanOrEqual(0);
    await page.screenshot({ path: testInfo.outputPath(`model-settings-${width}.png`) });
  }
});

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
    await expect.soft(page.locator("body")).toHaveScreenshot(`popup-${theme}.png`, {
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
    await expect.soft(page).toHaveScreenshot(`settings-common-${width}.png`, {
      animations: "disabled",
    });
    await page.getByRole("tab", { name: "本地生词" }).click();
    const input = await page.locator("[data-lexicon-search-form] input").boundingBox();
    const button = await page.locator("[data-lexicon-search-form] button").boundingBox();
    expect(input).not.toBeNull();
    expect(button).not.toBeNull();
    expect(Math.abs((input?.y ?? 0) - (button?.y ?? 0))).toBeLessThanOrEqual(1);
    expect(input?.height).toBe(button?.height);
    await expect.soft(page).toHaveScreenshot(`settings-lexicon-${width}.png`, {
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
