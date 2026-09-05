import { expect, test } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
const evidenceDirectory = "artifacts/query-learning-refinement-20260905";
test("makes popup controls usable within 200ms with account and outbox reads stalled", async ({
  page,
}) => {
  await page.setViewportSize({ width: 340, height: 620 });
  await page.goto(
    "/apps/store-extension/e2e/fixtures/interface.html?slowAccount=1&theme=porcelain",
  );
  await expect(page.locator("html")).toHaveAttribute("data-controls-ms", /\d/u);
  const controlsMs = Number(await page.locator("html").getAttribute("data-controls-ms"));
  expect(controlsMs).toBeLessThan(200);
  await expect(page.locator("[data-global-enabled]")).toBeEnabled();
  await expect(page.locator("[data-site-enabled]")).toBeEnabled();
  await page.locator("[data-toggle-appearance]").click();
  await page.locator("[data-popup-theme=silver]").click();
  await expect(page.locator("html")).toHaveAttribute("data-appearance", "silver");
  await expect(page.locator("[data-open-options]")).toBeEnabled();
  await test.info().attach("offline-popup-latency", {
    contentType: "application/json",
    body: JSON.stringify({
      controlsMs,
      fixture: true,
      accountResponse: "pending",
      outboxResponse: "pending",
    }),
  });
  await mkdir(evidenceDirectory, { recursive: true });
  await writeFile(
    `${evidenceDirectory}/popup-latency.json`,
    JSON.stringify(
      { controlsMs, fixture: true, accountResponse: "pending", outboxResponse: "pending" },
      null,
      2,
    ),
  );
});
test("keeps focus, readable streaming, scroll position and cached results across card lifetimes", async ({
  page,
}) => {
  await page.setViewportSize({ width: 900, height: 700 });
  await page.goto("/apps/store-extension/e2e/fixtures/query-interaction.html");
  await page.locator("#show").click();
  const panel = page.locator("[data-huayi-store-overlay]");
  await expect(page.locator("#show")).toBeFocused();
  await panel.locator("[data-action=explain]").click();
  await expect(panel).toContainText("主语与谓语已经可以阅读。");
  await expect(page.locator("body")).toHaveAttribute("data-calls", "1");
  await page.evaluate(() => window.scrollTo(0, 400));
  await expect(panel).toBeVisible();
  expect((await panel.boundingBox())?.y).toBeGreaterThanOrEqual(0);
  await panel.locator("[data-close]").click();
  await page.evaluate(() => {
    const f = window.queryFixture;
    f.setDefault();
    f.show();
  });
  await expect(panel).toContainText("主语与谓语已经可以阅读。");
  await expect(page.locator("body")).toHaveAttribute("data-calls", "1");
  await page.evaluate(() => window.queryFixture.finish());
  await expect(panel).toContainText("新闻中补充信息来源。");
  await expect(panel.locator(".panel")).toHaveAttribute("data-styles", "ready");
  const layout = await panel.locator(".panel").evaluate((element) => {
    const header = element.querySelector(".header");
    const footer = element.querySelector(".footer");
    const body = element.querySelector<HTMLElement>(".body");
    if (!header || !footer || !body) throw new Error("Missing card regions");
    const before = [header.getBoundingClientRect().top, footer.getBoundingClientRect().top];
    body.scrollTop = 10000;
    return {
      overflow: element.scrollWidth - element.clientWidth,
      bodyOverflow: body.scrollHeight - body.clientHeight,
      fixed: before.every(
        (top, i) => Math.abs(top - (i === 0 ? header : footer).getBoundingClientRect().top) < 1,
      ),
    };
  });
  expect(layout.overflow).toBeLessThanOrEqual(1);
  expect(layout.bodyOverflow).toBeGreaterThan(0);
  expect(layout.fixed).toBe(true);
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await page.evaluate(() => window.queryFixture.show());
  await expect(panel).toContainText("新闻中补充信息来源。");
  await expect(page.locator("body")).toHaveAttribute("data-result-ms", /\d/u);
  const hitMs = Number(await page.locator("body").getAttribute("data-result-ms"));
  expect(hitMs).toBeLessThan(100);
  await page.evaluate(() => window.queryFixture.theme());
  await expect(page.locator("body")).toHaveAttribute("data-calls", "1");
  const paintMs = await page.evaluate(() =>
    performance
      .getEntriesByName("seen-said:query:increment-to-paint")
      .map((entry) => entry.duration),
  );
  expect(paintMs.length).toBeGreaterThan(0);
  expect(Math.max(...paintMs)).toBeLessThan(250);
  await test.info().attach("offline-query-latency", {
    contentType: "application/json",
    body: JSON.stringify({
      cacheHitToPaintMs: hitMs,
      incrementalPaintMs: paintMs,
      modelCalls: 1,
      fixture: true,
    }),
  });
  await page.screenshot({ path: "artifacts/query-learning-refinement-20260905/query-browser.png" });
  await writeFile(
    `${evidenceDirectory}/query-latency.json`,
    JSON.stringify(
      { cacheHitToPaintMs: hitMs, incrementalPaintMs: paintMs, modelCalls: 1, fixture: true },
      null,
      2,
    ),
  );
});
