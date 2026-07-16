import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { runCompatibleSmokeWrapper } from "./smoke-compatible.mjs";

test("compatible smoke wrapper rejects every argument without echoing it", () => {
  const lines = [];
  let spawned = false;
  const exitCode = runCompatibleSmokeWrapper({
    arguments: ["--prompt", "private-selection", "--key", "secret-key"],
    existsSync: () => true,
    spawnSync: () => {
      spawned = true;
      return { status: 0 };
    },
    writeError: (line) => lines.push(line),
  });

  assert.equal(exitCode, 1);
  assert.equal(spawned, false);
  assert.match(lines.join(""), /does not accept arguments/i);
  assert.doesNotMatch(lines.join(""), /private-selection|secret-key/);
});

test("compatible smoke wrapper requires the built diagnostic", () => {
  const lines = [];
  const exitCode = runCompatibleSmokeWrapper({
    arguments: [],
    existsSync: () => false,
    spawnSync: () => ({ status: 0 }),
    writeError: (line) => lines.push(line),
  });

  assert.equal(exitCode, 1);
  assert.match(lines.join(""), /diagnostic build is missing/i);
  assert.match(lines.join(""), /pnpm build/i);
});

test("compatible smoke warns before inheriting stdio for the fixed entrypoint", () => {
  const events = [];
  const exitCode = runCompatibleSmokeWrapper({
    arguments: [],
    existsSync: () => true,
    spawnSync: (executable, arguments_, options) => {
      events.push({ arguments: arguments_, executable, options, type: "spawn" });
      return { status: 0 };
    },
    writeError: (line) => events.push({ line, type: "warning" }),
  });

  assert.equal(exitCode, 0);
  assert.equal(events[0]?.type, "warning");
  assert.match(events[0]?.line, /plaintext HTTP/i);
  assert.match(events[0]?.line, /charges/i);
  assert.deepEqual(events[1], {
    arguments: [
      new URL("../apps/native-host/dist/diagnostics/run-compatible-smoke.js", import.meta.url)
        .pathname,
    ],
    executable: process.execPath,
    options: { stdio: "inherit" },
    type: "spawn",
  });
});

test("workspace exposes compatible configuration and smoke lifecycle commands", async () => {
  const rootPackage = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  const hostPackage = JSON.parse(
    await readFile(new URL("../apps/native-host/package.json", import.meta.url), "utf8"),
  );

  assert.equal(
    rootPackage.scripts["host:compatible:config:set"],
    "node apps/native-host/dist/install/cli.js compatible-config-set",
  );
  assert.equal(
    rootPackage.scripts["host:compatible:config:status"],
    "node apps/native-host/dist/install/cli.js compatible-config-status",
  );
  assert.equal(
    rootPackage.scripts["host:compatible:config:remove"],
    "node apps/native-host/dist/install/cli.js compatible-config-remove",
  );
  assert.equal(rootPackage.scripts["smoke:compatible"], "node scripts/smoke-compatible.mjs");
  assert.match(hostPackage.scripts.build, /--mode compatible-smoke/);
});

test("compatible and provider documentation does not pass a literal pnpm separator", async () => {
  const documentedFiles = [
    "../AGENTS.md",
    "../README.md",
    "../docs/security.md",
    "../docs/setup-macos.md",
    "../docs/superpowers/specs/2026-07-14-openai-responses-provider-design.md",
    "../docs/superpowers/specs/2026-07-15-openai-compatible-http-provider-design.md",
    "../docs/superpowers/plans/2026-07-14-openai-responses-provider.md",
    "../docs/superpowers/plans/2026-07-15-openai-compatible-http-provider.md",
  ];

  for (const path of documentedFiles) {
    const contents = await readFile(new URL(path, import.meta.url), "utf8");
    assert.doesNotMatch(
      contents,
      /pnpm (?:host:compatible:[^\n]+|host:provider:set) --(?: | \\\n)/u,
      `${path} must pass lifecycle CLI options directly`,
    );
  }
});
