import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { access, readFile, realpath } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

async function verifySecurityPatch({ root, manifest, key, lock }) {
  const patchHash = /\(patch_hash=([a-f0-9]{64})\)/u.exec(key)?.[1];
  if (!patchHash) return;
  const identity = snapshotIdentity(key);
  const descriptor = lock.patchedDependencies?.[`${identity.name}@${identity.version}`];
  assert.equal(descriptor?.hash, patchHash, `Missing security patch metadata for ${key}`);
  const patchPath = resolve(root, descriptor.path);
  const patchRelative = relative(root, patchPath);
  assert.ok(!isAbsolute(patchRelative) && !patchRelative.startsWith(".."), "Invalid patch path.");
  const bytes = await readFile(patchPath);
  assert.equal(
    createHash("sha256").update(bytes).digest("hex"),
    patchHash,
    "Security patch hash drift.",
  );
  const packageDirectory = relative(root, dirname(manifest)).replaceAll("\\", "/");
  assert.ok(
    !isAbsolute(packageDirectory) && !packageDirectory.startsWith(".."),
    "Patched package is outside the workspace.",
  );
  try {
    // Read-only reverse applicability proves patch contents, even when versions/metadata match.
    await run(
      "git",
      ["apply", "--reverse", "--check", `--directory=${packageDirectory}`, patchPath],
      {
        cwd: root,
        shell: false,
        windowsHide: true,
        timeout: 10000,
        maxBuffer: 1024 * 1024,
      },
    );
  } catch {
    throw new Error(`Installed package is missing its required security patch: ${identity.name}`);
  }
}

async function findManifest(parent, name) {
  for (const directory of createRequire(parent).resolve.paths("__dependency_lookup__") ?? []) {
    const path = resolve(directory, name, "package.json");
    try {
      await access(path);
      return await realpath(path);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
}

function snapshotIdentity(key) {
  const separator = key.indexOf("@", 1);
  return { name: key.slice(0, separator), version: key.slice(separator + 1).split("(")[0] };
}

export async function inspectDependencyInstallation({ root, lock, installedLock }) {
  root = await realpath(root);
  assert.deepEqual(
    installedLock,
    lock,
    "Installed lock metadata differs; run pnpm install --frozen-lockfile.",
  );
  const queue = Object.entries(lock.importers).map(([name, importer]) => ({
    manifest: resolve(root, name, "package.json"),
    snapshot: importer,
    key: `workspace:${name}`,
    importer: true,
  }));
  const visited = new Set();
  const versions = {};
  let edges = 0;
  let optionalAbsent = 0;
  for (const item of queue) {
    const manifest = await realpath(item.manifest);
    const identity = `${manifest}:${item.key}`;
    if (visited.has(identity)) continue;
    visited.add(identity);
    const actual = JSON.parse(await readFile(manifest, "utf8"));
    if (!item.importer) {
      const expected = snapshotIdentity(item.key);
      assert.equal(actual.name, expected.name, `Unexpected dependency identity at ${manifest}`);
      assert.equal(actual.version, expected.version, `Dependency version drift at ${manifest}`);
      await verifySecurityPatch({ root, manifest, key: item.key, lock });
      versions[actual.name] ??= [];
      if (!versions[actual.name].includes(actual.version))
        versions[actual.name].push(actual.version);
    }
    const dependencies = {
      ...item.snapshot.dependencies,
      ...item.snapshot.optionalDependencies,
      ...(item.importer ? item.snapshot.devDependencies : {}),
    };
    for (const [name, entry] of Object.entries(dependencies)) {
      const reference = typeof entry === "string" ? entry : entry.version;
      const next = await findManifest(manifest, name);
      if (!next && name in (item.snapshot.optionalDependencies ?? {})) {
        optionalAbsent++;
        continue;
      }
      assert.ok(next, `Missing required dependency: ${item.key} -> ${name}`);
      edges++;
      if (reference.startsWith("link:")) {
        const expectedPath = await realpath(
          resolve(root, item.key.slice(10), reference.slice(5), "package.json"),
        );
        assert.equal(next, expectedPath, `Workspace link drift: ${name}`);
        continue;
      }
      const candidate = `${name}@${reference}`;
      const key = Object.hasOwn(lock.snapshots, candidate) ? candidate : reference;
      assert.ok(
        Object.hasOwn(lock.snapshots, key),
        `Missing lock snapshot for ${item.key} -> ${name}`,
      );
      queue.push({ manifest: next, snapshot: lock.snapshots[key], key, importer: false });
    }
  }
  return { versions, checkedContexts: visited.size, edges, optionalAbsent };
}
