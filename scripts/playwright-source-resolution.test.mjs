import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const playwrightConfigUrl = new URL("../playwright.config.ts", import.meta.url);
const viteConfigUrl = new URL("../apps/extension/e2e/vite.config.ts", import.meta.url);

test("Playwright resolves workspace protocol imports from source in a clean checkout", async () => {
  const [playwrightConfig, viteConfig] = await Promise.all([
    readFile(playwrightConfigUrl, "utf8"),
    readFile(viteConfigUrl, "utf8"),
  ]);

  assert.match(playwrightConfig, /vite --config apps\/extension\/e2e\/vite\.config\.ts/);
  assert.match(viteConfig, /"@huayi\/protocol"/);
  assert.match(viteConfig, /packages\/protocol\/src\/index\.ts/);
  assert.doesNotMatch(viteConfig, /packages\/protocol\/dist/);
});
