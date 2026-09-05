import assert from "node:assert/strict";
import test from "node:test";

import { runWorkspaceBuilds, workspaceBuildDirectories } from "./run-workspace-builds.mjs";

test("workspace builds run serially in dependency order", async () => {
  const calls = [];
  let active = 0;

  await runWorkspaceBuilds(async (directory) => {
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
  assert.deepEqual(calls, [...workspaceBuildDirectories]);
});

test("workspace builds stop at the first failure", async () => {
  const calls = [];

  await assert.rejects(
    runWorkspaceBuilds(async (directory) => {
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

test("ordinary workspace builds cannot inherit the installed hosted profile", async () => {
  const environment = { HUAYI_STORE_BUILD_PROFILE: "hosted-acceptance", PATH: "/fixture/bin" };
  const calls = [];
  await runWorkspaceBuilds(async (directory, buildEnvironment) => {
    calls.push({ directory, environment: buildEnvironment });
  }, environment);
  assert.deepEqual(
    calls.find(({ directory }) => directory === "apps/store-extension")?.environment,
    { ...environment, HUAYI_STORE_BUILD_PROFILE: "release" },
  );
  assert.equal(environment.HUAYI_STORE_BUILD_PROFILE, "hosted-acceptance");
});
