import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

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

test("excludes only the external agent skill subtree from product quality gates", async () => {
  const prettierIgnore = await readFile(new URL("../.prettierignore", import.meta.url), "utf8");
  const eslintAgentIgnores = eslintConfig
    .flatMap((config) => config.ignores ?? [])
    .filter((pattern) => pattern.startsWith(".agents"));

  assert.equal(prettierIgnore.trim(), ".agents/skills/**");
  assert.deepEqual(eslintAgentIgnores, [".agents/skills/**"]);
  assert.equal(eslintAgentIgnores.includes(".agents/**"), false);
});
