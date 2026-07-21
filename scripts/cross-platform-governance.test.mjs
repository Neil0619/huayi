import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflowUrl = new URL("../.github/workflows/cross-platform-quality.yml", import.meta.url);

test("cross-platform workflow runs both offline platform gates with pinned runtimes", async () => {
  const workflow = await readFile(workflowUrl, "utf8");

  assert.match(workflow, /^permissions:\n\s{2}contents: read$/m);
  assert.match(workflow, /^\s{2}macos-quality:$/m);
  assert.match(workflow, /^\s{4}runs-on: macos-latest$/m);
  assert.match(workflow, /node-version: 24/);
  assert.match(workflow, /run: pnpm verify:macos/);
  assert.match(workflow, /^\s{2}windows-quality:$/m);
  assert.match(workflow, /^\s{4}runs-on: windows-latest$/m);
  assert.match(workflow, /node-version: 26/);
  assert.match(workflow, /run: pnpm verify:windows/);
  assert.match(workflow, /actions\/checkout@v6/);
  assert.match(workflow, /actions\/setup-node@v6/);
  assert.match(workflow, /pnpm\/action-setup@v6/);
});

test("cross-platform workflow never performs privileged or paid runtime operations", async () => {
  const workflow = await readFile(workflowUrl, "utf8");

  assert.doesNotMatch(workflow, /smoke:/);
  assert.doesNotMatch(workflow, /host:install/);
  assert.doesNotMatch(workflow, /host:uninstall/);
  assert.doesNotMatch(workflow, /host:(?:eudic|openai|deepseek|compatible):/);
  assert.doesNotMatch(workflow, /secrets\./);
});
