import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { release } from "node:os";
import { chromium } from "@playwright/test";

const arguments_ = process.argv.slice(2);
assert.equal(arguments_[0], "--run-offline-diagnostic");
assert.ok(arguments_.length === 1 || arguments_.length === 3);
const executablePath = arguments_[2];
if (executablePath !== undefined) {
  assert.equal(arguments_[1], "--browser-executable");
  assert.ok(isAbsolute(executablePath));
}
const classic = await readFile("apps/extension/src/content/overlay/base-styles.ts", "utf8");
const popup = await readFile("apps/store-extension/pages/popup.css", "utf8");
const family = (source, pattern) => {
  const value = pattern.exec(source)?.[1]?.trim();
  assert.ok(value);
  return value;
};
const samples = [
  {
    id: "classic-serif",
    text: "对案件、事故等进行系统查证的调查",
    font: `17px/1.5 ${family(classic, /--huayi-serif:\s*([^;]+);/u)}`,
  },
  {
    id: "classic-sans",
    text: "常见释义",
    font: `600 10px/1.55 ${family(classic, /--huayi-sans:\s*([^;]+);/u)}`,
  },
  {
    id: "store-sans",
    text: "语见 常用设置 流银镜白",
    font: `15px/1.55 ${family(popup, /font-family:\s*([^;]+);/u)}`,
  },
];
const browser = await chromium.launch({
  channel: "chrome",
  ...(executablePath ? { executablePath } : {}),
});
try {
  const context = await browser.newContext();
  await context.route("**/*", (route) => route.abort());
  const page = await context.newPage();
  await page.setContent('<!doctype html><html lang="en"><body></body></html>');
  await page.evaluate((samples) => {
    for (const sample of samples) {
      const element = globalThis.document.createElement("span");
      element.id = sample.id;
      element.textContent = sample.text;
      element.style.font = sample.font;
      element.style.display = "block";
      element.style.width = "max-content";
      globalThis.document.body.append(element);
    }
  }, samples);
  await page.evaluate(() => globalThis.document.fonts.ready);
  const session = await context.newCDPSession(page);
  await session.send("DOM.enable");
  await session.send("CSS.enable");
  const { root } = await session.send("DOM.getDocument");
  const fonts = {};
  for (const { id } of samples) {
    const { nodeId } = await session.send("DOM.querySelector", {
      nodeId: root.nodeId,
      selector: `#${id}`,
    });
    const result = await session.send("CSS.getPlatformFontsForNode", { nodeId });
    fonts[id] = result.fonts.map((font) => ({
      family: font.familyName.slice(0, 160),
      postScript: font.postScriptName.slice(0, 160),
      custom: font.isCustomFont,
      glyphs: font.glyphCount,
    }));
  }
  const browserSession = await browser.newBrowserCDPSession();
  const { gpu } = await browserSession.send("SystemInfo.getInfo");
  const receipt = {
    platform: process.platform,
    osRelease: release(),
    browser: browser.version(),
    fonts,
    renderer: String(gpu.auxAttributes?.glRenderer ?? "unavailable").slice(0, 512),
    display: await page.evaluate(() => ({
      scale: globalThis.devicePixelRatio,
      width: globalThis.innerWidth,
      height: globalThis.innerHeight,
    })),
    metrics: await page.locator("span").evaluateAll((elements) =>
      elements.map((element) => {
        const bounds = element.getBoundingClientRect();
        return { id: element.id, width: bounds.width, height: bounds.height };
      }),
    ),
  };
  await mkdir(".codex-pet-runs/targeted-ci", { recursive: true });
  await writeFile(
    ".codex-pet-runs/targeted-ci/rendering.json",
    JSON.stringify(receipt, null, 2) + "\n",
  );
  console.log(JSON.stringify(receipt));
} finally {
  await browser.close();
}
