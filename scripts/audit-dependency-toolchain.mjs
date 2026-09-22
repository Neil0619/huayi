import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parse } from "yaml";

import { inspectDependencyInstallation } from "./dependency-installation.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export async function auditInstalledToolchain({
  pnpmEntry = process.env.npm_execpath,
  fetcher = fetch,
} = {}) {
  assert.ok(pnpmEntry, "Run through pnpm audit:toolchain to verify the actual package manager.");
  const manifest = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
  const pnpm = JSON.parse(await readFile(resolve(dirname(pnpmEntry), "../package.json"), "utf8"));
  assert.equal(pnpm.name, "pnpm", "Unexpected package manager executable.");
  assert.equal(
    `pnpm@${pnpm.version}`,
    manifest.packageManager,
    "Package manager version differs from project pin.",
  );
  const [lock, installedLock] = await Promise.all(
    ["pnpm-lock.yaml", "node_modules/.pnpm/lock.yaml"].map(async (file) =>
      parse(await readFile(resolve(root, file), "utf8")),
    ),
  );
  const graph = await inspectDependencyInstallation({ root, lock, installedLock });
  const response = await fetcher("https://registry.npmjs.org/-/npm/v1/security/advisories/bulk", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...graph.versions, pnpm: [pnpm.version] }),
    signal: AbortSignal.timeout(30000),
  });
  assert.ok(response.ok, `Security registry query failed (${response.status}).`);
  const advisories = await response.json();
  assert.ok(advisories && typeof advisories === "object" && !Array.isArray(advisories));
  const findings = Object.entries(advisories).flatMap(([name, entries]) => {
    assert.ok(Array.isArray(entries), "Unexpected security registry response.");
    return entries.map((item) => ({ name, severity: item.severity, url: item.url }));
  });
  const report = {
    pnpm: pnpm.version,
    checkedContexts: graph.checkedContexts,
    edges: graph.edges,
    optionalAbsent: graph.optionalAbsent,
    findings,
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  assert.equal(
    findings.length,
    0,
    "Installed dependency graph or pnpm has known security advisories.",
  );
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  auditInstalledToolchain().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
