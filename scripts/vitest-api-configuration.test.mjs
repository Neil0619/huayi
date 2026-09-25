import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createVitest, parseCLI } from "vitest/node";

import { runRepositoryTests } from "./run-tests.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("the real API project receives the repository runner's database hook budget", async () => {
  let apiArguments;
  await runRepositoryTests({
    listTests: async () => ["scripts/fixture.test.mjs"],
    mode: "vitest-only",
    platform: "win32",
    pnpmEntry: "/fixture/pnpm.cjs",
    run: async (step) => {
      if (step.arguments.includes("api"))
        apiArguments = step.arguments.slice(step.arguments.indexOf("vitest"));
    },
  });
  assert.ok(apiArguments);
  const { options } = parseCLI(apiArguments);
  const context = await createVitest("test", { ...options, root: repositoryRoot, watch: false });
  try {
    assert.equal(context.config.hookTimeout, 15000);
    assert.equal(context.projects.length, 1);
    const [project] = context.projects;
    assert.equal(project.name, "api");
    assert.equal(project.config.hookTimeout, context.config.hookTimeout);
    assert.equal(project.config.testTimeout, context.config.testTimeout);
  } finally {
    await context.close();
  }
});
