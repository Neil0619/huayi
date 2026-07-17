import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { runDeepSeekSmokeWrapper } from "./smoke-deepseek.mjs";

test("DeepSeek smoke rejects arguments without echoing possible secrets", () => {
  const lines = [];
  let spawned = false;
  const result = runDeepSeekSmokeWrapper({
    arguments: ["--key", "secret"],
    existsSync: () => true,
    spawnSync: () => {
      spawned = true;
      return { status: 0 };
    },
    writeError: (line) => lines.push(line),
  });

  assert.equal(result, 1);
  assert.equal(spawned, false);
  assert.doesNotMatch(lines.join(""), /secret/);
});

test("DeepSeek smoke requires its build and warns before external work", () => {
  const missing = [];
  assert.equal(
    runDeepSeekSmokeWrapper({
      arguments: [],
      existsSync: () => false,
      spawnSync: () => ({ status: 0 }),
      writeError: (line) => missing.push(line),
    }),
    1,
  );
  assert.match(missing.join(""), /pnpm build/i);

  const events = [];
  assert.equal(
    runDeepSeekSmokeWrapper({
      arguments: [],
      existsSync: () => true,
      spawnSync: (executable, arguments_, options) => {
        events.push({ arguments: arguments_, executable, options, type: "spawn" });
        return { status: 0 };
      },
      writeError: (line) => events.push({ line, type: "warning" }),
    }),
    0,
  );
  assert.equal(events[0]?.type, "warning");
  assert.match(events[0]?.line, /official DeepSeek API/i);
  assert.match(events[0]?.line, /charges/i);
});

test("workspace exposes the DeepSeek lifecycle commands", async () => {
  const rootPackage = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  const hostPackage = JSON.parse(
    await readFile(new URL("../apps/native-host/package.json", import.meta.url), "utf8"),
  );

  assert.equal(
    rootPackage.scripts["host:deepseek:configure"],
    "node apps/native-host/dist/install/cli.js deepseek-configure",
  );
  assert.equal(
    rootPackage.scripts["host:deepseek:remove"],
    "node apps/native-host/dist/install/cli.js deepseek-remove",
  );
  assert.equal(rootPackage.scripts["smoke:deepseek"], "node scripts/smoke-deepseek.mjs");
  assert.match(hostPackage.scripts.build, /--mode deepseek-smoke/);
});
