import assert from "node:assert/strict";
import test from "node:test";

import { productionStoreExtensionId, runProductionStoreCli } from "./production-store-build.mjs";

test("production build selects a fixed profile without passing credentials and then audits the result", async () => {
  const events = [];
  const code = await runProductionStoreCli({
    arguments_: ["build"],
    repositoryRoot: "/repo",
    environment: {
      npm_execpath: "/pnpm.cjs",
      HUAYI_STORE_BUILD_PROFILE: "hosted-acceptance",
      VERCEL_TOKEN: "fictional-secret",
    },
    runBuild: async (request) => {
      events.push(request);
      return true;
    },
    audit: async (root) => {
      events.push(root);
      return [];
    },
    writeOutput: (text) => events.push(text),
  });
  assert.equal(code, 0);
  assert.equal(events[0].environment.HUAYI_STORE_BUILD_PROFILE, "production");
  assert.equal(events[0].environment.npm_execpath, "/pnpm.cjs");
  assert.equal(JSON.stringify(events).includes("fictional-secret"), false);
  assert.equal(events[1], "/repo");
  assert.equal(productionStoreExtensionId, "enlolhfodncfnleiihkjanhmnfbgeggh");
});

test("production status cannot build and audit failures are not reported as ready", async () => {
  const output = [];
  assert.equal(
    await runProductionStoreCli({
      arguments_: ["status"],
      runBuild: async () => assert.fail("status must not build"),
      audit: async () => ["private failure detail"],
      writeOutput: (value) => output.push(value),
      writeError: (value) => output.push(value),
    }),
    1,
  );
  assert.deepEqual(output, ["Production Store package failed verification.\n"]);
});

test("a failed production build never runs the package audit or claims readiness", async () => {
  const output = [];
  assert.equal(
    await runProductionStoreCli({
      arguments_: ["build"],
      environment: {},
      runBuild: async () => false,
      audit: async () => assert.fail("failed build cannot be audited as ready"),
      writeOutput: (value) => output.push(value),
      writeError: (value) => output.push(value),
    }),
    1,
  );
  assert.deepEqual(output, ["Production Store package failed verification.\n"]);
});
