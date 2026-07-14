import assert from "node:assert/strict";
import test from "node:test";

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
      new URL("../apps/native-host/dist/diagnostics/compare-providers.js", import.meta.url)
        .pathname,
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
