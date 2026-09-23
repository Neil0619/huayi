import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";

import { inspectDependencyInstallation } from "./dependency-installation.mjs";

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "huayi-dependency-graph-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  async function packageAt(path, name, version) {
    const file = join(root, path, "package.json");
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify({ name, version }));
  }
  await packageAt(".", "workspace", "1.0.0");
  await packageAt("node_modules/consumer", "consumer", "1.0.0");
  await packageAt("node_modules/consumer/node_modules/alias", "parser", "2.0.0");
  const lock = {
    importers: { ".": { devDependencies: { consumer: { version: "1.0.0" } } } },
    snapshots: {
      "consumer@1.0.0": {
        dependencies: { alias: "parser@2.0.0" },
        optionalDependencies: { platform: "1.0.0" },
      },
      "parser@2.0.0": {},
      "platform@1.0.0": {},
    },
  };
  return { root, lock, installedLock: structuredClone(lock), packageAt };
}

test("installation inspection follows actual parent resolution and npm aliases", async (t) => {
  const data = await fixture(t);
  const report = await inspectDependencyInstallation(data);
  assert.deepEqual(report.versions, { consumer: ["1.0.0"], parser: ["2.0.0"] });
  assert.equal(report.optionalAbsent, 1);
});

test("installed metadata cannot hide a stale dependency link", async (t) => {
  const data = await fixture(t);
  await data.packageAt("node_modules/consumer/node_modules/alias", "parser", "1.0.0");
  await assert.rejects(inspectDependencyInstallation(data), /version drift/u);
});

test("installation inspection rejects stale lock metadata and missing required packages", async (t) => {
  const data = await fixture(t);
  await assert.rejects(
    inspectDependencyInstallation({ ...data, installedLock: {} }),
    /lock metadata/u,
  );
  await rm(join(data.root, "node_modules/consumer"), { recursive: true });
  await assert.rejects(inspectDependencyInstallation(data), /Missing required dependency/u);
});

test("same-version packages must contain the exact required security patch", async (t) => {
  const data = await fixture(t);
  const patch = [
    "diff --git a/index.js b/index.js",
    "--- a/index.js",
    "+++ b/index.js",
    "@@ -1 +1 @@",
    '-module.exports = "old";',
    '+module.exports = "fixed";',
    "",
  ].join("\n");
  const hash = createHash("sha256").update(patch).digest("hex");
  await mkdir(join(data.root, "patches"));
  await writeFile(join(data.root, "patches/consumer.patch"), patch);
  const key = `consumer@1.0.0(patch_hash=${hash})`;
  data.lock.snapshots[key] = data.lock.snapshots["consumer@1.0.0"];
  delete data.lock.snapshots["consumer@1.0.0"];
  data.lock.importers["."].devDependencies.consumer.version = `1.0.0(patch_hash=${hash})`;
  data.lock.patchedDependencies = {
    "consumer@1.0.0": { hash, path: "patches/consumer.patch" },
  };
  data.installedLock = structuredClone(data.lock);
  const source = join(data.root, "node_modules/consumer/index.js");
  await writeFile(source, 'module.exports = "old";\n');
  await assert.rejects(inspectDependencyInstallation(data), /security patch/u);
  await writeFile(source, 'module.exports = "fixed";\n');
  await inspectDependencyInstallation(data);
  await writeFile(join(data.root, "patches/consumer.patch"), `${patch}\n`);
  await assert.rejects(inspectDependencyInstallation(data), /patch hash/u);
});
