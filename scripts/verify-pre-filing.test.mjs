import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { collectPreFilingInputs, executeValidationSteps } from "./verify-pre-filing.mjs";

test("stops at the first failed command and preserves its failure receipt", async () => {
  const calls = [];
  const receipts = [];
  const result = await executeValidationSteps({
    steps: [{ id: "first" }, { id: "broken" }, { id: "must-not-run" }],
    run: async ({ id }) => {
      calls.push(id);
      if (id === "broken") throw new Error("exit 7");
    },
    snapshot: async () => "same-inputs",
    save: async (receipt) => receipts.push(structuredClone(receipt)),
  });
  assert.deepEqual(calls, ["first", "broken"]);
  assert.equal(result.status, "failed");
  assert.equal(result.failedStep, "broken");
  assert.equal(result.steps[1].error, "exit 7");
  assert.equal(receipts.at(-1).status, "failed");
});

test("does not certify or run further checks after the input snapshot changes", async () => {
  let inputs = "before";
  const calls = [];
  const result = await executeValidationSteps({
    steps: [{ id: "first" }, { id: "later" }],
    run: async ({ id }) => {
      calls.push(id);
      inputs = "after";
    },
    snapshot: async () => inputs,
    save: async () => undefined,
  });
  assert.deepEqual(calls, ["first"]);
  assert.equal(result.status, "failed");
  assert.equal(result.failedStep, "input-snapshot");
});

test("marks completion only after all successful steps and the final input check", async () => {
  const result = await executeValidationSteps({
    steps: [{ id: "one" }, { id: "two" }],
    run: async () => undefined,
    snapshot: async () => "stable",
    save: async () => undefined,
  });
  assert.equal(result.status, "passed");
  assert.deepEqual(
    result.steps.map(({ status }) => status),
    ["passed", "passed"],
  );
});

test("rejects a changed manifest before executing even the first command", async () => {
  const calls = [];
  const result = await executeValidationSteps({
    steps: [{ id: "first" }],
    initialSnapshot: "recorded-manifest",
    snapshot: async () => "changed-before-start",
    run: async (step) => calls.push(step.id),
    save: async () => undefined,
  });
  assert.deepEqual(calls, []);
  assert.equal(result.status, "failed");
  assert.equal(result.failedStep, "input-snapshot");
});

for (const dependency of ["scripts/vitest-browser-storage-setup.ts", ".prettierignore"]) {
  test(`actual input collection detects changes to ${dependency}`, async () => {
    const repository = await mkdtemp(join(tmpdir(), "seen-said-pre-filing-"));
    try {
      await promisify(execFile)("git", ["init", "--quiet", repository]);
      const file = join(repository, dependency);
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, "before\n");
      const before = await collectPreFilingInputs(repository);
      assert.equal(
        typeof before[dependency],
        "string",
        "The direct verification dependency must be recorded.",
      );
      await writeFile(file, "after\n");
      const after = await collectPreFilingInputs(repository);
      assert.notEqual(after[dependency], before[dependency]);
    } finally {
      await rm(repository, { force: true, recursive: true });
    }
  });
}
