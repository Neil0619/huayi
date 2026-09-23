import { expect, test } from "@playwright/test";
import { appendFile, mkdir } from "node:fs/promises";

import {
  dragSelect,
  expectAnalyzeRequest,
  panel,
  selectionFixturePath,
  toolbar,
} from "./support/journey-helpers.js";

test.use({ screenshot: "off", trace: "off" });

for (let run = 1; run <= 100; run += 1) {
  test(`observe native phrase drag ${run}`, async ({ page, browser }) => {
    await page.route("**/*", (route) =>
      new URL(route.request().url()).origin === "http://127.0.0.1:4173"
        ? route.continue()
        : route.abort(),
    );
    await page.addInitScript(() => {
      const events: object[] = [];
      Object.assign(window, { phraseDragEvents: events });
      for (const type of ["scroll", "mousedown", "mouseup", "selectionchange"]) {
        document.addEventListener(
          type,
          (event) => {
            const selection = window.getSelection();
            events.push({
              type,
              trusted: event.isTrusted,
              ranges: selection?.rangeCount ?? 0,
              length: selection?.toString().length ?? 0,
              matches: selection?.toString().trim() === "sustained heatwave",
              x: event instanceof MouseEvent ? event.clientX : null,
              y: event instanceof MouseEvent ? event.clientY : null,
              buttons: event instanceof MouseEvent ? event.buttons : null,
              target:
                event.target instanceof Element
                  ? (event.target.getAttribute("data-testid") ?? event.target.tagName)
                  : null,
            });
            if (events.length > 40) events.shift();
          },
          true,
        );
      }
    });
    let stage = "navigate";
    let passed = false;
    try {
      await page.goto(selectionFixturePath);
      stage = "drag";
      await dragSelect(page, page.getByTestId("phrase-selection"));
      stage = "toolbar";
      await expect(toolbar(page)).toBeVisible();
      stage = "explain";
      await toolbar(page).locator('[data-action="explain"]').click();
      const resultPanel = panel(page);
      await expect(resultPanel).toHaveAttribute("data-status", "result", { timeout: 10_000 });
      await expect(resultPanel).toContainText("词汇解释结果");
      await expect(resultPanel).toContainText("同义词");
      await expectAnalyzeRequest(page, "phrase", "explain");
      passed = true;
    } finally {
      const observed = await page
        .evaluate(() => {
          const selection = window.getSelection();
          const target = document.querySelector('[data-testid="phrase-selection"]');
          const box = target?.getBoundingClientRect();
          return {
            events: (window as unknown as { phraseDragEvents?: object[] }).phraseDragEvents ?? [],
            ranges: selection?.rangeCount ?? 0,
            length: selection?.toString().length ?? 0,
            matches: selection?.toString().trim() === "sustained heatwave",
            focused: document.hasFocus(),
            readyState: document.readyState,
            scrollY,
            bounds: box ? { x: box.x, y: box.y, width: box.width, height: box.height } : null,
            toolbarPresent: Boolean(
              document
                .querySelector("[data-huayi-overlay-host]")
                ?.shadowRoot?.querySelector(".huayi-toolbar"),
            ),
          };
        })
        .catch(() => null);
      await mkdir(".codex-pet-runs/targeted-ci", { recursive: true });
      await appendFile(
        ".codex-pet-runs/targeted-ci/selection.jsonl",
        JSON.stringify({ run, passed, stage, browser: browser.version(), observed }) + "\n",
      );
    }
  });
}
