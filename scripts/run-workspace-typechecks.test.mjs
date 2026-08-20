import assert from "node:assert/strict";
import test from "node:test";

import {
  runWorkspaceTypechecks,
  workspaceTypecheckDirectories,
} from "./run-workspace-typechecks.mjs";

test("workspace typechecks run serially in dependency order", async () => {
  const calls = [];
  let active = 0;

  await runWorkspaceTypechecks(async (directory) => {
    assert.equal(active, 0);
    active += 1;
    calls.push(directory);
    await Promise.resolve();
    active -= 1;
  });

  assert.deepEqual(calls, [
    "packages/learning-domain",
    "packages/cloud-contracts",
    "packages/protocol",
    "packages/store-domain",
    "apps/api",
    "apps/web",
    "apps/extension",
    "apps/native-host",
    "apps/store-extension",
  ]);
  assert.deepEqual(calls, [...workspaceTypecheckDirectories]);
});

test("workspace typechecks stop at the first failure", async () => {
  const calls = [];

  await assert.rejects(
    runWorkspaceTypechecks(async (directory) => {
      calls.push(directory);
      if (directory === "apps/extension") throw new Error("fixture failure");
    }),
    /fixture failure/u,
  );

  assert.deepEqual(calls, [
    "packages/learning-domain",
    "packages/cloud-contracts",
    "packages/protocol",
    "packages/store-domain",
    "apps/api",
    "apps/web",
    "apps/extension",
  ]);
});
