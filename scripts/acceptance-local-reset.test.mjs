import assert from "node:assert/strict";
import test from "node:test";

import {
  LOCAL_RESET_CONFIRMATION,
  resetAcceptanceLocal,
  resetLocalDatabase,
} from "./acceptance-local-reset.mjs";

function dependencyHarness({ failAt } = {}) {
  const events = [];
  let verificationCount = 0;
  const resultFor = (name, success) => async () => {
    events.push(name);
    if (name === "verify") verificationCount += 1;
    if (name === failAt || `${name}:${verificationCount}` === failAt) {
      return success === 0 ? 1 : false;
    }
    return success;
  };
  return {
    dependencies: {
      bootstrap: resultFor("bootstrap", true),
      build: resultFor("build", 0),
      resetDatabase: resultFor("reset", true),
      startDev: resultFor("start", true),
      stopDev: resultFor("stop", true),
      verifyRuntime: resultFor("verify", true),
    },
    events,
  };
}

test("local reset rejects every non-exact confirmation before any side effect", async () => {
  for (const arguments_ of [[], ["--wrong"], [LOCAL_RESET_CONFIRMATION, "extra"]]) {
    const harness = dependencyHarness();
    assert.equal(
      await resetAcceptanceLocal({ arguments_, ...harness.dependencies }),
      "confirmation-required",
    );
    assert.deepEqual(harness.events, []);
  }
});

test("local reset runs the fixed destructive rebuild sequence", async () => {
  const harness = dependencyHarness();
  assert.equal(
    await resetAcceptanceLocal({
      arguments_: [LOCAL_RESET_CONFIRMATION],
      ...harness.dependencies,
    }),
    "succeeded",
  );
  assert.deepEqual(harness.events, [
    "verify",
    "stop",
    "reset",
    "verify",
    "bootstrap",
    "build",
    "start",
  ]);
});

test("local reset stops at every failed stage and never resumes a partial environment", async (context) => {
  for (const expected of [
    ["verify", ["verify"]],
    ["stop", ["verify", "stop"]],
    ["reset", ["verify", "stop", "reset"]],
    ["verify:2", ["verify", "stop", "reset", "verify"]],
    ["bootstrap", ["verify", "stop", "reset", "verify", "bootstrap"]],
    ["build", ["verify", "stop", "reset", "verify", "bootstrap", "build"]],
    ["start", ["verify", "stop", "reset", "verify", "bootstrap", "build", "start"]],
  ]) {
    await context.test(expected[0], async () => {
      const harness = dependencyHarness({ failAt: expected[0] });
      assert.equal(
        await resetAcceptanceLocal({
          arguments_: [LOCAL_RESET_CONFIRMATION],
          ...harness.dependencies,
        }),
        "failed",
      );
      assert.deepEqual(harness.events, expected[1]);
    });
  }
});

test("local reset invokes only the pinned local CLI with the repository seed", async () => {
  const calls = [];
  assert.equal(
    await resetLocalDatabase({
      run: async (command, arguments_) => {
        calls.push({ arguments_, command });
        return { code: 0, stdout: "private CLI output" };
      },
    }),
    true,
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, process.execPath);
  assert.match(calls[0].arguments_[0], /node_modules[\\/]supabase[\\/]dist[\\/]supabase\.js$/u);
  assert.deepEqual(calls[0].arguments_.slice(1), [
    "db",
    "reset",
    "--local",
    "--yes",
    "--sql-paths",
    "seed.sql",
    "--network-id",
    "seen-said-local-acceptance",
    "--output",
    "json",
  ]);
  assert.doesNotMatch(calls[0].arguments_.join(" "), /--db-url|--linked|--project-ref/u);
});
