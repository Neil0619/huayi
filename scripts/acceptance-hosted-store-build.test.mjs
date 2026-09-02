import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  hostedAcceptanceStoreApiOrigin,
  hostedAcceptanceStoreExtensionId,
  hostedAcceptanceStoreWebWorkspaceUrl,
  runHostedAcceptanceStoreCli,
} from "./acceptance-hosted-store-build.mjs";

const expectedAuditOptions = {
  expectedCsp:
    "script-src 'self'; object-src 'self'; connect-src https://api.openai.com https://api.deepseek.com https://api.frdic.com https://api.acceptance.seen-said.cn",
  expectedHosts: [
    "https://api.openai.com/*",
    "https://api.deepseek.com/*",
    "https://api.frdic.com/*",
    "https://api.acceptance.seen-said.cn/*",
  ],
  sourceManifestName: "manifest.hosted-acceptance.json",
};

function harness(overrides = {}) {
  const calls = [];
  return {
    calls,
    dependencies: {
      auditStore: async (root, options) => {
        calls.push(["audit", root, options]);
        return [];
      },
      environment: {
        HOME: "/Users/fictional",
        PATH: "/safe/bin",
        VERCEL_TOKEN: "must-not-propagate",
      },
      repositoryRoot: "/repo",
      runBuild: async (request) => {
        calls.push(["build", request]);
        return true;
      },
      ...overrides,
    },
  };
}

test("hosted Store profile freezes one acceptance identity and endpoint pair", () => {
  assert.equal(hostedAcceptanceStoreExtensionId, "hoijjhgcckfhbcefoclgbhkgninnkknd");
  assert.equal(hostedAcceptanceStoreApiOrigin, "https://api.acceptance.seen-said.cn");
  assert.equal(hostedAcceptanceStoreWebWorkspaceUrl, "https://app.acceptance.seen-said.cn/app");
});

test("build passes only a fixed profile to pnpm and audits the separate acceptance manifest", async () => {
  const testHarness = harness();
  const output = [];
  const code = await runHostedAcceptanceStoreCli({
    arguments_: ["build"],
    writeOutput: (value) => output.push(value),
    ...testHarness.dependencies,
  });

  assert.equal(code, 0);
  assert.equal(testHarness.calls[0][0], "build");
  assert.deepEqual(testHarness.calls[0][1].arguments_, [
    "--filter",
    "@huayi/store-extension",
    "build",
  ]);
  assert.equal(testHarness.calls[0][1].environment.HUAYI_STORE_BUILD_PROFILE, "hosted-acceptance");
  assert.equal(
    JSON.stringify(testHarness.calls[0][1].environment).includes("must-not-propagate"),
    false,
  );
  assert.deepEqual(testHarness.calls[1], ["audit", "/repo", expectedAuditOptions]);
  assert.equal(
    output.join(""),
    "Hosted Store acceptance package is ready: apps/store-extension/dist " +
      `(Extension ID ${hostedAcceptanceStoreExtensionId}).\n`,
  );
});

test("status is read-only and fails closed when the exact acceptance package is absent", async () => {
  const errors = [];
  const testHarness = harness({
    auditStore: async (root, options) => {
      testHarness.calls.push(["audit", root, options]);
      return ["private audit detail"];
    },
    runBuild: async () => assert.fail("status must not build"),
  });
  const code = await runHostedAcceptanceStoreCli({
    arguments_: ["status"],
    writeError: (value) => errors.push(value),
    ...testHarness.dependencies,
  });

  assert.equal(code, 1);
  assert.equal(testHarness.calls.length, 1);
  assert.equal(errors.join(""), "Hosted Store acceptance package failed closed.\n");
  assert.doesNotMatch(errors.join(""), /private/u);
});

test("package exposes only fixed hosted Store build and status commands", async () => {
  const packageDocument = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  assert.equal(
    packageDocument.scripts["acceptance:hosted:store:build"],
    "node scripts/acceptance-hosted-store-build.mjs build",
  );
  assert.equal(
    packageDocument.scripts["acceptance:hosted:store:status"],
    "node scripts/acceptance-hosted-store-build.mjs status",
  );
});
