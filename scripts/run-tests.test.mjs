import assert from "node:assert/strict";
import test from "node:test";

import { runRepositoryTests } from "./run-tests.mjs";

test("repository tests run explicit script files before two bounded Vitest batches", async () => {
  const calls = [];

  await runRepositoryTests({
    listTests: async () => ["scripts/a.test.mjs", "scripts/b.test.mjs"],
    platform: "darwin",
    pnpmEntry: "/fixture/pnpm.cjs",
    run: async (step) => calls.push(step),
  });

  assert.deepEqual(calls[0].arguments, [
    "/fixture/pnpm.cjs",
    "--filter",
    "@huayi/learning-domain",
    "--filter",
    "@huayi/cloud-contracts",
    "build",
  ]);
  assert.deepEqual(calls[1].arguments, ["--test", "scripts/a.test.mjs", "scripts/b.test.mjs"]);
  assert.deepEqual(calls[2].arguments.slice(1), [
    "exec",
    "vitest",
    "run",
    "--config",
    "vitest.config.ts",
    "--passWithNoTests",
    "--project",
    "!api",
    "--maxWorkers",
    "4",
  ]);
  assert.deepEqual(calls[3].arguments.slice(1), [
    "exec",
    "vitest",
    "run",
    "--config",
    "vitest.config.ts",
    "--passWithNoTests",
    "--project",
    "api",
    "--maxWorkers",
    "2",
    "--testTimeout",
    "15000",
    "--hookTimeout",
    "15000",
  ]);
  assert.equal(calls[0].executable, process.execPath);
  assert.equal(calls[1].executable, process.execPath);
  assert.equal(calls[2].executable, process.execPath);
  assert.equal(calls[3].executable, process.execPath);
});

test("Windows Vitest sharding remains unchanged and disables native-host file parallelism", async () => {
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
  assert.doesNotMatch(calls.flat().join(" "), /(?:^|\s)(?:api|web)(?:\s|$)/u);
});

test("repository tests stop before script tests when dependency builds fail", async () => {
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

test("repository tests stop before Vitest when script tests fail", async () => {
  let calls = 0;

  await assert.rejects(
    runRepositoryTests({
      listTests: async () => ["scripts/a.test.mjs"],
      pnpmEntry: "/fixture/pnpm.cjs",
      run: async () => {
        calls += 1;
        if (calls === 2) throw new Error("fixture failure");
      },
    }),
    /fixture failure/u,
  );

  assert.equal(calls, 2);
});

test("repository test modes select their reviewed step groups", async () => {
  for (const [mode, expectedArguments] of [
    [
      "scripts-only",
      [
        [
          "/fixture/pnpm.cjs",
          "--filter",
          "@huayi/learning-domain",
          "--filter",
          "@huayi/cloud-contracts",
          "build",
        ],
        ["--test", "scripts/a.test.mjs"],
      ],
    ],
    [
      "vitest-only",
      [
        [
          "/fixture/pnpm.cjs",
          "exec",
          "vitest",
          "run",
          "--config",
          "vitest.config.ts",
          "--passWithNoTests",
          "--project",
          "!api",
          "--maxWorkers",
          "4",
        ],
        [
          "/fixture/pnpm.cjs",
          "exec",
          "vitest",
          "run",
          "--config",
          "vitest.config.ts",
          "--passWithNoTests",
          "--project",
          "api",
          "--maxWorkers",
          "2",
          "--testTimeout",
          "15000",
          "--hookTimeout",
          "15000",
        ],
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
    assert.deepEqual(calls, expectedArguments);
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
