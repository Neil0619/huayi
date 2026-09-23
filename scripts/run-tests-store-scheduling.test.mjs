import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { runRepositoryTests } from "./run-tests.mjs";

for (const suite of ["unit", "coverage"]) {
  test(`Windows Store ${suite} scheduling never overlaps real Vitest files`, async (t) => {
    const directory = await mkdtemp(join(tmpdir(), "huayi-store-scheduling-"));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const vitestModule = import.meta.resolve("vitest");
    for (let index = 0; index < 4; index += 1) {
      await writeFile(
        join(directory, `${index}.test.mjs`),
        `import assert from "node:assert/strict";
import { readdir, rm, writeFile } from "node:fs/promises";
import { setTimeout } from "node:timers/promises";
import { it } from ${JSON.stringify(vitestModule)};
it("does not overlap another Store file", async () => {
  const directory = ${JSON.stringify(directory)};
  const marker = ${JSON.stringify(join(directory, `${index}.active`))};
  await writeFile(marker, "active");
  try {
    await setTimeout(1_000);
    const active = (await readdir(directory)).filter(name => name.endsWith(".active"));
    assert.equal(active.length, 1, "Store files must not contend with real Vite builds");
    await writeFile(${JSON.stringify(join(directory, `${index}.completed`))}, "done");
  } finally { await rm(marker); }
});`,
      );
    }
    const configPath = join(directory, "vitest.config.mjs");
    const coverageConfig = new URL("../vitest.store-coverage.config.ts", import.meta.url).href;
    await writeFile(
      configPath,
      suite === "coverage"
        ? `import base from ${JSON.stringify(coverageConfig)};
    export default { ...base, test: { ...base.test, coverage: { enabled: false },
      root: ${JSON.stringify(directory)}, include: ["*.test.mjs"]
    } };`
        : `export default { test: { projects: [{ test: {
      name: "store-extension", environment: "node",
      root: ${JSON.stringify(directory)}, include: ["*.test.mjs"]
    } }] } };`,
    );
    const cliPath = new URL("./vitest.mjs", import.meta.resolve("vitest/package.json"));
    let executed = false;
    await runRepositoryTests({
      mode: "vitest-only",
      platform: "win32",
      pnpmEntry: "/fixture/pnpm.cjs",
      listTests: async () => ["scripts/a.test.mjs"],
      run: async (step) => {
        if (!step.arguments.includes("store-extension")) return;
        executed = true;
        // Keep the runner's actual scheduling arguments; only replace pnpm and the fixture config.
        const arguments_ =
          suite === "coverage"
            ? ["run", "--config", configPath]
            : step.arguments.slice(step.arguments.indexOf("run"));
        arguments_[arguments_.indexOf("--config") + 1] = configPath;
        await new Promise((resolve, reject) => {
          const environment = { ...process.env };
          delete environment.NODE_TEST_CONTEXT;
          const child = spawn(process.execPath, [fileURLToPath(cliPath), ...arguments_], {
            env: environment,
            shell: false,
            stdio: "pipe",
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
    assert.equal(executed, true);
    assert.equal(
      (await readdir(directory)).filter((name) => name.endsWith(".completed")).length,
      4,
    );
  });
}
