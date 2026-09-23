import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runRepositoryTests } from "./run-tests.mjs";

test("Windows script batches keep at most four real test processes active", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "huayi-script-concurrency-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const fixtures = await Promise.all(
    Array.from({ length: 8 }, async (_, index) => {
      const path = join(directory, `${index}.test.mjs`);
      await writeFile(
        path,
        `import assert from "node:assert/strict";
import { readdir, rm, writeFile } from "node:fs/promises";
import { setTimeout } from "node:timers/promises";
import { test } from "node:test";
test("bounded script process", async () => {
  const directory = ${JSON.stringify(directory)};
  const marker = ${JSON.stringify(join(directory, `${index}.active`))};
  await writeFile(marker, "active");
  try {
    await setTimeout(200);
    const active = (await readdir(directory)).filter(name => name.endsWith(".active"));
    assert.ok(active.length <= 4, "Script process concurrency exceeded four");
    await writeFile(${JSON.stringify(join(directory, `${index}.completed`))}, "done");
  } finally { await rm(marker); }
});`,
      );
      return path;
    }),
  );
  await runRepositoryTests({
    listTests: async () => fixtures,
    mode: "scripts-only",
    platform: "win32",
    pnpmEntry: "/fixture/pnpm.cjs",
    run: async (step) => {
      // This probe has no package dependencies; execute the real Node test batch.
      if (!step.arguments.includes("--test")) return;
      await new Promise((resolve, reject) => {
        const environment = { ...process.env };
        delete environment.NODE_TEST_CONTEXT;
        const child = spawn(step.executable, step.arguments, {
          env: environment,
          stdio: "pipe",
          shell: false,
        });
        let output = "";
        child.stdout.on("data", (chunk) => (output += chunk));
        child.stderr.on("data", (chunk) => (output += chunk));
        child.once("error", reject);
        child.once("close", (code) => {
          if (code === 0) resolve();
          else reject(new Error(output));
        });
      });
    },
  });
  assert.equal((await readdir(directory)).filter((name) => name.endsWith(".completed")).length, 8);
});

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

test("Windows bounds Web/API workers and serializes Store/native-host files", async () => {
  const calls = [];

  await runRepositoryTests({
    listTests: async () => ["scripts/a.test.mjs"],
    mode: "vitest-only",
    platform: "win32",
    pnpmEntry: "/fixture/pnpm.cjs",
    run: async (step) => calls.push(step.arguments),
  });

  assert.deepEqual(
    calls.map((arguments_) => arguments_.slice(arguments_.indexOf("--project") + 1)),
    [
      ["store-domain"],
      ["learning-domain"],
      ["cloud-contracts"],
      ["protocol"],
      ["native-host", "--no-file-parallelism"],
      ["extension"],
      ["store-extension", "--no-file-parallelism"],
      ["web", "--maxWorkers", "4"],
      ["api", "--maxWorkers", "2", "--testTimeout", "15000", "--hookTimeout", "15000"],
    ],
  );
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
