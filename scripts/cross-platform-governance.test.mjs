import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflowUrl = new URL("../.github/workflows/cross-platform-quality.yml", import.meta.url);

export function normalizeLineEndings(value) {
  return value.replaceAll("\r\n", "\n");
}

async function readWorkflow() {
  return normalizeLineEndings(await readFile(workflowUrl, "utf8"));
}

test("workflow assertions normalize Windows checkout line endings", () => {
  assert.equal(
    normalizeLineEndings("permissions:\r\n  contents: read\r\n"),
    "permissions:\n  contents: read\n",
  );
});

test("cross-platform workflow runs both offline platform gates with pinned runtimes", async () => {
  const workflow = await readWorkflow();

  assert.match(workflow, /^permissions:\n\s{2}contents: read$/m);
  assert.match(workflow, /^\s{2}macos-quality:$/m);
  assert.match(workflow, /^\s{4}runs-on: macos-latest$/m);
  assert.match(workflow, /node-version: 24/);
  assert.match(workflow, /run: pnpm verify:macos/);
  assert.match(workflow, /^\s{2}windows-quality:$/m);
  assert.match(workflow, /^\s{4}runs-on: windows-latest$/m);
  assert.match(workflow, /node-version: 26/);
  assert.match(workflow, /run: pnpm verify:windows/);
  assert.match(workflow, /actions\/checkout@d23441a48e516b6c34aea4fa41551a30e30af803 # v6/);
  assert.match(workflow, /actions\/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38 # v6/);
  assert.match(workflow, /pnpm\/action-setup@0977fd99725f1db4007ccb2928dbb4e90d06cc86 # v6/);
  assert.equal(workflow.match(/pnpm exec playwright install chrome/g)?.length, 2);
  assert.doesNotMatch(workflow, /uses: [^\n]+@v\d+/);
});

test("cross-platform workflow never performs privileged or paid runtime operations", async () => {
  const workflow = await readWorkflow();

  assert.doesNotMatch(workflow, /smoke:/);
  assert.doesNotMatch(workflow, /host:install/);
  assert.doesNotMatch(workflow, /host:uninstall/);
  assert.doesNotMatch(workflow, /host:(?:eudic|openai|deepseek|compatible):/);
  assert.doesNotMatch(workflow, /secrets\./);
});

test("Windows failures retain only allowlisted visual screenshot PNGs", async () => {
  const workflow = await readWorkflow();
  const windowsVerifyIndex = workflow.indexOf("- run: pnpm verify:windows");
  const uploadStepIndex = workflow.indexOf(
    "- name: Upload Windows visual screenshot diffs on failure",
  );

  assert.notEqual(windowsVerifyIndex, -1);
  assert.ok(uploadStepIndex > windowsVerifyIndex);

  const uploadStep = workflow.slice(uploadStepIndex);
  assert.match(uploadStep, /^- name: Upload Windows visual screenshot diffs on failure\n/m);
  assert.match(uploadStep, /^\s{8}if: \$\{\{ failure\(\) \}\}$/m);
  assert.match(
    uploadStep,
    /^\s{8}uses: actions\/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7\.0\.1$/m,
  );
  assert.match(uploadStep, /^\s{10}if-no-files-found: ignore$/m);
  assert.match(uploadStep, /^\s{10}retention-days: 1$/m);

  const uploadedPaths = [...uploadStep.matchAll(/^\s{12}(\*\*\/[^\n]+)$/gm)].map(
    ([, path]) => path,
  );
  assert.deepEqual(uploadedPaths, [
    "**/lexical-translation-actual.png",
    "**/lexical-translation-diff.png",
    "**/lexical-explanation-actual.png",
    "**/lexical-explanation-diff.png",
    "**/practice-silver-desktop-actual.png",
    "**/practice-silver-desktop-diff.png",
    "**/practice-silver-mobile-actual.png",
    "**/practice-silver-mobile-diff.png",
    "**/store-silver-pearl-action-actual.png",
    "**/store-silver-pearl-action-diff.png",
    "**/store-silver-parchment-action-actual.png",
    "**/store-silver-parchment-action-diff.png",
  ]);
  assert.doesNotMatch(uploadStep, /(?:trace|playwright-report|test-results)/u);
  assert.doesNotMatch(uploadStep, /(?:\.zip|\.html|\.json)(?:\s|$)/u);
});
