import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { LOCAL_DEPLOY_CONFIRMATION, deployAcceptanceLocal } from "./acceptance-local-deploy.mjs";

const repositoryRoot = new URL("../", import.meta.url);

function dependencyHarness({ failAt } = {}) {
  const events = [];
  const resultFor = (name, success) => async () => {
    events.push(name);
    if (name === failAt) return success === 0 ? 1 : false;
    return success;
  };
  return {
    dependencies: {
      build: resultFor("build", 0),
      startDev: resultFor("start", true),
      stopDev: resultFor("stop", true),
      verifyRuntime: resultFor("verify", true),
    },
    events,
  };
}

test("local deployment rejects every non-exact downtime confirmation before side effects", async () => {
  for (const arguments_ of [
    [],
    ["--wrong"],
    [LOCAL_DEPLOY_CONFIRMATION, "extra"],
    ["--confirm-local-data-loss"],
  ]) {
    const harness = dependencyHarness();
    assert.equal(
      await deployAcceptanceLocal({ arguments_, ...harness.dependencies }),
      "confirmation-required",
    );
    assert.deepEqual(harness.events, []);
  }
});

test("local deployment runs only the fixed non-destructive cutover sequence", async () => {
  const harness = dependencyHarness();
  assert.equal(
    await deployAcceptanceLocal({
      arguments_: [LOCAL_DEPLOY_CONFIRMATION],
      ...harness.dependencies,
    }),
    "succeeded",
  );
  assert.deepEqual(harness.events, ["verify", "stop", "build", "start"]);
});

test("local deployment stops at every failed stage and never serves a partial bundle", async (context) => {
  for (const [failedStage, expected] of [
    ["verify", ["verify"]],
    ["stop", ["verify", "stop"]],
    ["build", ["verify", "stop", "build"]],
    ["start", ["verify", "stop", "build", "start"]],
  ]) {
    await context.test(failedStage, async () => {
      const harness = dependencyHarness({ failAt: failedStage });
      assert.equal(
        await deployAcceptanceLocal({
          arguments_: [LOCAL_DEPLOY_CONFIRMATION],
          ...harness.dependencies,
        }),
        "failed",
      );
      assert.deepEqual(harness.events, expected);
    });
  }
});

test("local deployment normalizes an unexpected stage exception without continuing", async () => {
  const events = [];
  assert.equal(
    await deployAcceptanceLocal({
      arguments_: [LOCAL_DEPLOY_CONFIRMATION],
      build: async () => {
        events.push("build");
        throw new Error("private build failure");
      },
      startDev: async () => {
        events.push("start");
        return true;
      },
      stopDev: async () => {
        events.push("stop");
        return true;
      },
      verifyRuntime: async () => {
        events.push("verify");
        return true;
      },
    }),
    "failed",
  );
  assert.deepEqual(events, ["verify", "stop", "build"]);
});

test("workspace exposes only the confirmed local deployment entrypoint", async () => {
  const packageDocument = JSON.parse(
    await readFile(new URL("package.json", repositoryRoot), "utf8"),
  );
  assert.equal(
    packageDocument.scripts["acceptance:local:deploy"],
    "node scripts/acceptance-local-deploy.mjs",
  );
});
