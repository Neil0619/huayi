import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const brand = Object.freeze({
  englishName: "Seen & Said",
  slogan: "Turn what you see into what you can say.",
  zhName: "语见",
});

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

const userFacingFiles = [
  "apps/extension/manifest.json",
  "apps/extension/pages/options.html",
  "apps/extension/pages/popup.html",
  "apps/extension/src/background/request-coordinator.ts",
  "apps/extension/src/background/word-sync-coordinator-support.ts",
  "apps/extension/src/background/word-sync-presentation.ts",
  "apps/extension/src/content/overlay/render-result.ts",
  "apps/extension/src/content/overlay/render-toolbar.ts",
  "apps/extension/src/content/shanbay/shanbay-batch-prefiller.ts",
  "apps/extension/src/popup/popup-page.ts",
  "apps/extension/src/shared/constants.ts",
  "apps/native-host/src/runtime/error-mapper.ts",
  "apps/store-extension/manifest.json",
  "apps/store-extension/pages/options.html",
  "apps/store-extension/pages/popup.html",
  "apps/store-extension/src/content/overlay/overlay-panel.ts",
  "apps/store-extension/src/content/shanbay/shanbay-sync-controller.ts",
  "apps/store-extension/src/options/local-word-import-options-controller.ts",
  "apps/store-extension/src/options/options-non-sensitive-controls.ts",
  "apps/store-extension/src/popup/popup-page.ts",
  "apps/web/index.html",
  "apps/web/src/account-data-rights-page.tsx",
  "apps/web/src/app.tsx",
  "apps/web/src/auth-page.tsx",
  "apps/web/src/cloud-app.tsx",
  "apps/web/src/device-sessions-page.tsx",
  "apps/web/src/inbox-app.tsx",
  "apps/web/src/learning-library-page.tsx",
  "apps/web/src/password-recovery-page.tsx",
  "apps/web/src/paste-analysis-page.tsx",
  "apps/web/src/workspace-shell.tsx",
  "apps/web/src/privacy-page.tsx",
  "apps/web/src/study-capture-inbox.tsx",
];

async function repositoryFile(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("defines the exact public brand and repository naming rule", async () => {
  const [context, guidelines, instructions, readme] = await Promise.all([
    repositoryFile("CONTEXT.md"),
    repositoryFile("docs/brand.md"),
    repositoryFile("AGENTS.md"),
    repositoryFile("README.md"),
  ]);

  for (const value of Object.values(brand)) {
    assert.match(guidelines, new RegExp(escapeRegExp(value), "u"));
    assert.match(instructions, new RegExp(escapeRegExp(value), "u"));
    assert.match(readme, new RegExp(escapeRegExp(value), "u"));
  }
  assert.match(instructions, /technical identifiers/iu);
  assert.doesNotMatch(context, /划译|华译/u);
});

test("uses the new name on every current user-facing product surface", async () => {
  const contents = await Promise.all(
    userFacingFiles.map(async (path) => [path, await repositoryFile(path)]),
  );

  for (const [path, content] of contents) {
    assert.doesNotMatch(content, /划译|华译|HUAYI CLOUD/u, path);
  }

  assert.doesNotMatch(
    await repositoryFile("apps/store-extension/src/content/overlay/overlay-panel.ts"),
    /brand\.textContent = "HUAYI"/u,
  );

  for (const path of [
    "apps/extension/manifest.json",
    "apps/store-extension/manifest.json",
    "apps/web/index.html",
  ]) {
    const content = (await repositoryFile(path)).replaceAll("&amp;", "&");
    assert.match(content, /语见/u, path);
    assert.match(content, /Seen & Said/u, path);
  }
});
