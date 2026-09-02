import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { renderHostedReleasePlan, runHostedReleaseCli } from "./acceptance-hosted-release.mjs";

test("release plan is zero-I/O and distinguishes deployment from independent business gates", async () => {
  let output = "";
  const code = await runHostedReleaseCli({
    arguments_: ["plan"],
    createProduction: () => {
      throw new Error("must not instantiate");
    },
    environment: { VERCEL_TOKEN: "must-not-read" },
    writeOutput: (value) => {
      output += value;
    },
  });

  assert.equal(code, 0);
  assert.equal(output, renderHostedReleasePlan());
  assert.match(output, /exact candidate SHA/u);
  assert.match(output, /API then Web/u);
  assert.match(output, /does not run migrations, Cron, DeepSeek, or Chrome journeys/u);
  assert.doesNotMatch(output, /must-not-read/u);
});

test("release mutation requires the exact confirmation and delegates no caller-supplied SHA", async () => {
  const calls = [];
  const createProduction = async () => ({
    candidateSha: "2".repeat(40),
    run: async (mode) => calls.push(mode),
  });
  for (const [arguments_, expected] of [
    [["advance", "--confirm-hosted-acceptance-release"], "advance"],
    [["recover", "--confirm-hosted-acceptance-release"], "recover"],
  ]) {
    assert.equal(await runHostedReleaseCli({ arguments_, createProduction, environment: {} }), 0);
    assert.equal(calls.at(-1), expected);
  }
  assert.equal(
    await runHostedReleaseCli({
      arguments_: ["advance", "2".repeat(40), "--confirm-hosted-acceptance-release"],
      createProduction,
      environment: {},
      writeError: () => undefined,
    }),
    1,
  );
});

test("package exposes one release entry plus safe convenience commands", async () => {
  const packageDocument = JSON.parse(await readFile(new URL("../package.json", import.meta.url)));
  assert.equal(
    packageDocument.scripts["acceptance:hosted:release"],
    "node scripts/acceptance-hosted-release.mjs",
  );
  assert.equal(
    packageDocument.scripts["acceptance:hosted:release:plan"],
    "node scripts/acceptance-hosted-release.mjs plan",
  );
  assert.equal(
    packageDocument.scripts["acceptance:hosted:release:status"],
    "node scripts/acceptance-hosted-release.mjs status",
  );
  assert.equal(
    packageDocument.scripts["acceptance:hosted:release:advance"],
    "node scripts/acceptance-hosted-release.mjs advance --confirm-hosted-acceptance-release",
  );
  assert.equal(
    packageDocument.scripts["acceptance:hosted:release:recover"],
    "node scripts/acceptance-hosted-release.mjs recover --confirm-hosted-acceptance-release",
  );
});
