import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import assert from "node:assert/strict";

const rootDirectory = fileURLToPath(new URL("../", import.meta.url));

async function readJson(path) {
  return JSON.parse(await readFile(resolve(rootDirectory, path), "utf8"));
}

test("workspace packages and Chrome manifest share the release version", async () => {
  const rootPackage = await readJson("package.json");
  const releaseFiles = [
    "apps/extension/package.json",
    "apps/extension/manifest.json",
    "apps/native-host/package.json",
    "packages/protocol/package.json",
  ];
  const versions = await Promise.all(
    releaseFiles.map(async (path) => ({ path, version: (await readJson(path)).version })),
  );

  assert.equal(rootPackage.version, "0.2.0");
  for (const release of versions) {
    assert.equal(release.version, rootPackage.version, `${release.path} version must match root`);
  }
});
