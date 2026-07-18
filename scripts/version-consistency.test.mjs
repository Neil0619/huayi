import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import assert from "node:assert/strict";

const rootDirectory = fileURLToPath(new URL("../", import.meta.url));
const releaseVersion = "0.9.0";

async function readJson(path) {
  return JSON.parse(await readFile(resolve(rootDirectory, path), "utf8"));
}

async function readText(path) {
  return readFile(resolve(rootDirectory, path), "utf8");
}

test("packages, Manifest, and runtime identities share the release version", async () => {
  const rootPackage = await readJson("package.json");
  const extensionManifest = await readJson("apps/extension/manifest.json");
  const releaseFiles = [
    "apps/extension/package.json",
    "apps/extension/manifest.json",
    "apps/native-host/package.json",
    "packages/protocol/package.json",
  ];
  const versions = await Promise.all(
    releaseFiles.map(async (path) => ({ path, version: (await readJson(path)).version })),
  );
  const runtimeIdentities = [
    {
      path: "apps/native-host/src/protocol/dispatcher.ts",
      pattern: /const HOST_VERSION = "([^"]+)";/u,
    },
    {
      path: "apps/native-host/src/runtime/codex-app-server-protocol.ts",
      pattern: /clientInfo: \{ name: "huayi", title: "Huayi Native Host", version: "([^"]+)" \}/u,
    },
    {
      path: "apps/native-host/src/wordbook/eudic-client.ts",
      pattern: /"User-Agent": "Huayi\/([^"]+)"/u,
    },
  ];

  assert.equal(rootPackage.version, releaseVersion);
  assert.equal(extensionManifest.version, releaseVersion);
  assert.deepEqual(extensionManifest.permissions, ["nativeMessaging"]);
  assert.equal("host_permissions" in extensionManifest, false);
  for (const release of versions) {
    assert.equal(release.version, rootPackage.version, `${release.path} version must match root`);
  }
  for (const identity of runtimeIdentities) {
    const match = identity.pattern.exec(await readText(identity.path));
    assert.ok(match, `${identity.path} must declare its runtime identity`);
    assert.equal(match[1], releaseVersion, `${identity.path} version must match release`);
  }

  const protocolLimits = await readText("packages/protocol/src/limits.ts");
  assert.match(protocolLimits, /export const SCHEMA_VERSION = 5;/u);
});
