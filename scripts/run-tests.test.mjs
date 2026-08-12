import assert from "node:assert/strict";
import test from "node:test";

import { runRepositoryTests } from "./run-tests.mjs";

test("repository tests run explicit script files before Vitest", async () => {
  const calls = [];

  await runRepositoryTests({
    listTests: async () => ["scripts/a.test.mjs", "scripts/b.test.mjs"],
    platform: "darwin",
    pnpmEntry: "/fixture/pnpm.cjs",
    run: async (step) => calls.push(step),
  });

  assert.deepEqual(calls[0].arguments, ["--test", "scripts/a.test.mjs", "scripts/b.test.mjs"]);
  assert.deepEqual(calls[1].arguments.slice(1), [
    "exec",
    "vitest",
    "run",
    "--config",
    "vitest.config.ts",
    "--passWithNoTests",
  ]);
  assert.equal(calls[0].executable, process.execPath);
  assert.equal(calls[1].executable, process.execPath);
});

test("Windows Vitest disables file parallelism at the CLI boundary", async () => {
  const calls = [];

  await runRepositoryTests({
    listTests: async () => ["scripts/a.test.mjs"],
    mode: "vitest-only",
    platform: "win32",
    pnpmEntry: "/fixture/pnpm.cjs",
    run: async (step) => calls.push(step.arguments),
  });

  assert.deepEqual(
    calls.map((arguments_) => arguments_.slice(-3)),
    [
      ["--passWithNoTests", "--project", "store-domain"],
      ["--passWithNoTests", "--project", "learning-domain"],
      ["--passWithNoTests", "--project", "cloud-contracts"],
      ["--passWithNoTests", "--project", "protocol"],
      ["--project", "native-host", "--no-file-parallelism"],
      ["--passWithNoTests", "--project", "extension"],
      ["--passWithNoTests", "--project", "store-extension"],
    ],
  );
});

test("repository tests stop before Vitest when script tests fail", async () => {
  let calls = 0;

  await assert.rejects(
    runRepositoryTests({
      listTests: async () => ["scripts/a.test.mjs"],
      pnpmEntry: "/fixture/pnpm.cjs",
      run: async () => {
        calls += 1;
        throw new Error("fixture failure");
      },
    }),
    /fixture failure/u,
  );

  assert.equal(calls, 1);
});

test("repository test modes select exactly one reviewed subcheck", async () => {
  for (const [mode, expectedArguments] of [
    ["scripts-only", ["--test", "scripts/a.test.mjs"]],
    [
      "vitest-only",
      [
        "/fixture/pnpm.cjs",
        "exec",
        "vitest",
        "run",
        "--config",
        "vitest.config.ts",
        "--passWithNoTests",
      ],
    ],
  ]) {
    const calls = [];
    await runRepositoryTests({
      listTests: async () => ["scripts/a.test.mjs"],
      mode,
      platform: "darwin",
      pnpmEntry: "/fixture/pnpm.cjs",
      run: async (step) => calls.push(step.arguments),
    });
    assert.deepEqual(calls, [expectedArguments]);
  }
});

test("repository tests reject an unknown mode", async () => {
  await assert.rejects(
    runRepositoryTests({
      listTests: async () => ["scripts/a.test.mjs"],
      mode: "unknown",
      pnpmEntry: "/fixture/pnpm.cjs",
    }),
    /mode is invalid/u,
  );
});

test("repository tests fail closed when no script tests exist", async () => {
  await assert.rejects(
    runRepositoryTests({ listTests: async () => [] }),
    /No script tests were found/u,
  );
});
