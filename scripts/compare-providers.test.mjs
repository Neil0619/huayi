import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { build } from "vite";

import { runComparisonWrapper } from "./compare-providers.mjs";

test("comparison wrapper refuses to run without the diagnostic build", () => {
  const lines = [];
  let spawned = false;

  const exitCode = runComparisonWrapper({
    arguments: [],
    existsSync: () => false,
    spawnSync: () => {
      spawned = true;
      return { status: 0 };
    },
    writeError: (line) => lines.push(line),
  });

  assert.equal(exitCode, 1);
  assert.equal(spawned, false);
  assert.match(lines.join(""), /diagnostic build is missing/i);
  assert.match(lines.join(""), /pnpm build/);
});

test("comparison wrapper warns about both quota systems before the exact fixed entrypoint", () => {
  const events = [];

  const exitCode = runComparisonWrapper({
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
  assert.match(events[0]?.line, /ChatGPT\/Codex quota/);
  assert.match(events[0]?.line, /OpenAI API charges/);
  assert.deepEqual(events[1], {
    arguments: [
      fileURLToPath(
        new URL("../apps/native-host/dist/diagnostics/compare-providers.js", import.meta.url),
      ),
    ],
    executable: process.execPath,
    options: { stdio: "inherit" },
    type: "spawn",
  });
});

test("comparison wrapper forbids arbitrary profile and prompt arguments", () => {
  const lines = [];
  let spawned = false;

  const exitCode = runComparisonWrapper({
    arguments: ["--model", "arbitrary", "--prompt", "private"],
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
  assert.doesNotMatch(lines.join(""), /arbitrary|private/);
});

test("built comparison argument rejection cannot enter Native Messaging startup", async () => {
  await build({
    configFile: fileURLToPath(new URL("../apps/native-host/vite.config.ts", import.meta.url)),
    logLevel: "silent",
    mode: "diagnostics",
    resolve: {
      alias: {
        "@huayi/protocol": fileURLToPath(
          new URL("../packages/protocol/src/index.ts", import.meta.url),
        ),
      },
    },
  });
  const entrypoint = fileURLToPath(
    new URL("../apps/native-host/dist/diagnostics/compare-providers.js", import.meta.url),
  );
  const result = spawnSync(process.execPath, [entrypoint, "--probe"], {
    encoding: "utf8",
    env: { PATH: process.env.PATH },
  });

  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.deepEqual(result.stderr.trim().split("\n"), [
    "Provider comparison does not accept arguments; it uses fixed profiles and cases.",
  ]);
});
