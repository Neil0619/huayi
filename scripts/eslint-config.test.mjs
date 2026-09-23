import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { ESLint } from "eslint";

import eslintConfig, { filenamePlugin } from "../eslint.config.mjs";

function reportsFor(filename) {
  const reports = [];
  const visitor = filenamePlugin.rules["kebab-case"].create({
    filename,
    report: (report) => reports.push(report),
  });
  visitor.Program({});
  return reports;
}

test("accepts kebab-case TypeScript filenames on Windows and POSIX", () => {
  assert.deepEqual(reportsFor("C:\\repo\\src\\windows-eudic-credential.test.ts"), []);
  assert.deepEqual(reportsFor("/repo/src/windows-eudic-credential.test.ts"), []);
});

test("rejects a non-kebab-case filename", () => {
  assert.equal(reportsFor("C:\\repo\\src\\WindowsEudicCredential.ts").length, 1);
});

test("ignores both Store build outputs while continuing to lint handwritten source", async () => {
  const eslint = new ESLint();
  assert.equal(await eslint.isPathIgnored("apps/store-extension/dist/service-worker.js"), true);
  assert.equal(
    await eslint.isPathIgnored("apps/store-extension/dist-release/service-worker.js"),
    true,
  );
  assert.equal(
    await eslint.isPathIgnored("apps/store-extension/src/service-worker/service-worker.ts"),
    false,
  );
});

test("ignores generated asbplayer and Store browser artifacts without hiding source", async () => {
  const eslint = new ESLint();
  for (const path of [
    "artifacts/asbplayer-m0-probe/probe.js",
    "artifacts/store-parity-builds/release/content-script.js",
  ]) {
    assert.equal(await eslint.isPathIgnored(path), true, path);
  }
  assert.equal(await eslint.isPathIgnored("artifacts/reviewed-source.mjs"), false);
  assert.equal(await eslint.isPathIgnored("scripts/verify-asbplayer-store-browser.mjs"), false);
});

test("excludes only reviewed external and generated subtrees from product quality gates", async () => {
  const prettierIgnore = await readFile(new URL("../.prettierignore", import.meta.url), "utf8");
  const eslintReviewedIgnores = eslintConfig
    .flatMap((config) => config.ignores ?? [])
    .filter((pattern) => pattern.startsWith(".agents") || pattern.startsWith("supabase"));

  assert.equal(
    prettierIgnore.trim(),
    ".agents/skills/**\nsupabase/.temp/**\nartifacts/hosted-important-batch-backups/**\nartifacts/hosted-important-batch-backup-history/**\nartifacts/hosted-vercel-one-shot/**\nartifacts/hosted-release/**\nartifacts/query-learning-refinement-20260905/popup-latency.json\nartifacts/query-learning-refinement-20260905/query-latency.json\nartifacts/asbplayer-m0-probe/**\nartifacts/asbplayer-store-browser-receipt.json\nartifacts/store-parity-builds/**",
  );
  assert.equal(prettierIgnore.includes("artifacts/**"), false);
  assert.deepEqual(eslintReviewedIgnores, [".agents/skills/**", "supabase/.temp/**"]);
  assert.equal(eslintReviewedIgnores.includes(".agents/**"), false);
  assert.equal(eslintReviewedIgnores.includes("supabase/**"), false);
});
