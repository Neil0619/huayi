import assert from "node:assert/strict";
import { basename } from "node:path";
import test from "node:test";

import { readStoreCloudBuild, storeProfilePaths } from "./store-cloud-build.mjs";

test("all actual Store configurations compile the runtime module with their own endpoints and output", () => {
  for (const [profile, api, web, directory] of [
    ["release", null, null, "dist-release"],
    [
      "hosted-acceptance",
      "https://api.acceptance.seen-said.cn",
      "https://app.acceptance.seen-said.cn",
      "dist",
    ],
    ["production", "https://api.seen-said.cn", "https://app.seen-said.cn", "dist-production"],
  ]) {
    const actual = readStoreCloudBuild(process.cwd(), profile);
    assert.equal(actual.apiOrigin, api);
    assert.equal(actual.webOrigin, web);
    assert.equal(actual.workspaceUrl, web === null ? null : `${web}/app`);
    assert.equal(basename(actual.outDir), directory);
    assert.equal(actual.apiConsumed, true);
    assert.equal(actual.workspaceConsumed, true);
  }
  assert.throws(() => storeProfilePaths("../dist"), {
    message: "Store build configuration is invalid.",
  });
});
