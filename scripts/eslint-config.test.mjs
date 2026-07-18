import assert from "node:assert/strict";
import test from "node:test";

import { filenamePlugin } from "../eslint.config.mjs";

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
