import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

test("M0 probe builds MAIN document_start capture without Store permissions or remote code", async () => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const manifests = [
    "manifest.json",
    "manifest.hosted-acceptance.json",
    "manifest.production.json",
  ];
  const readStoreManifests = () =>
    Promise.all(
      manifests.map((name) =>
        readFile(new URL(`../apps/store-extension/${name}`, import.meta.url), "utf8"),
      ),
    );
  const before = await readStoreManifests();
  execFileSync(process.execPath, ["scripts/build-asbplayer-m0-probe.mjs"], {
    cwd: root,
    stdio: "pipe",
  });
  const manifest = JSON.parse(
    await readFile(
      new URL("../artifacts/asbplayer-m0-probe/manifest.json", import.meta.url),
      "utf8",
    ),
  );
  assert.deepEqual(manifest.content_scripts, [
    {
      matches: ["https://app.asbplayer.dev/*"],
      js: ["probe.js"],
      run_at: "document_start",
      all_frames: true,
      world: "MAIN",
    },
  ]);
  for (const forbidden of [
    "permissions",
    "host_permissions",
    "background",
    "externally_connectable",
    "web_accessible_resources",
  ])
    assert.equal(Object.hasOwn(manifest, forbidden), false);
  const bundle = await readFile(
    new URL("../artifacts/asbplayer-m0-probe/probe.js", import.meta.url),
    "utf8",
  );
  assert.ok(bundle.length > 0 && Buffer.byteLength(bundle) < 32 * 1024);
  assert.doesNotMatch(
    bundle,
    /\b(?:fetch|XMLHttpRequest|WebSocket|postMessage)\b|chrome\.(?:runtime|storage)|sourceMappingURL/u,
  );
  assert.deepEqual(await readStoreManifests(), before);
});
