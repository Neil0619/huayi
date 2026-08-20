import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const playwrightConfigUrl = new URL("../playwright.config.ts", import.meta.url);
const viteConfigUrl = new URL("../apps/extension/e2e/vite.config.ts", import.meta.url);
const webPackageUrl = new URL("../apps/web/package.json", import.meta.url);
const webE2eTypecheckUrl = new URL("../apps/web/tsconfig.e2e.json", import.meta.url);

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

test("Playwright discovers Cloud journeys and builds one reviewed production Web fixture", async () => {
  const [playwrightConfig, viteConfig] = await Promise.all([
    readFile(playwrightConfigUrl, "utf8"),
    readFile(viteConfigUrl, "utf8"),
  ]);

  assert.match(playwrightConfig, /testDir:\s*["']apps["']/);
  assert.match(playwrightConfig, /testMatch:\s*["']\*\*\/e2e\/\*\*\/\*\.spec\.ts["']/);
  assert.match(viteConfig, /https:\/\/api\.huayi\.invalid/);
  assert.match(viteConfig, /apps\/web\/vite\.config\.ts/);
  assert.doesNotMatch(viteConfig, /packages\/cloud-contracts\/dist/);
});

test("Web workspace typechecks Playwright support and journey sources", async () => {
  const [packageSource, configSource] = await Promise.all([
    readFile(webPackageUrl, "utf8"),
    readFile(webE2eTypecheckUrl, "utf8"),
  ]);
  const packageJson = JSON.parse(packageSource);
  const config = JSON.parse(configSource);

  assert.match(packageJson.scripts.typecheck, /tsconfig\.e2e\.json/);
  assert.deepEqual(config.include, ["e2e/**/*.ts"]);
  assert.equal(config.compilerOptions.noEmit, true);
});
