import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runHostedAcceptanceStoreCli } from "./acceptance-hosted-store-build.mjs";

async function fixture(context, source) {
  const directory = await mkdtemp(join(tmpdir(), "huayi-hosted-store-process-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const entry = join(directory, "pnpm entry & (fixture).cjs");
  await writeFile(entry, source);
  return {
    directory,
    environment: {
      npm_execpath: entry,
      PATH: join(directory, "empty-bin"),
      SystemRoot: process.env.SystemRoot ?? "/fictional-system",
      WINDIR: process.env.WINDIR ?? "/fictional-windows",
      TEMP: directory,
      TMP: directory,
      HUAYI_STORE_BUILD_PROFILE: "production",
      VERCEL_TOKEN: "fictional-secret-must-not-propagate",
      NODE_OPTIONS: "--invalid-option-must-not-propagate",
    },
  };
}

test("hosted CLI launches its pnpm JavaScript entrypoint and filters the real child environment", async (context) => {
  const input = await fixture(
    context,
    `require("node:fs").writeFileSync("receipt.json", JSON.stringify({
      arguments: process.argv.slice(2), environment: process.env
    }));`,
  );
  const output = [];
  let receipt;
  const code = await runHostedAcceptanceStoreCli({
    arguments_: ["build"],
    environment: input.environment,
    repositoryRoot: input.directory,
    auditStore: async () => {
      receipt = JSON.parse(await readFile(join(input.directory, "receipt.json"), "utf8"));
      return [];
    },
    writeOutput: (value) => output.push(value),
    writeError: (value) => output.push(value),
  });

  assert.equal(code, 0, "the configured pnpm entrypoint must run without a PATH executable");
  assert.deepEqual(receipt.arguments, ["--filter", "@huayi/store-extension", "build"]);
  assert.equal(receipt.environment.HUAYI_STORE_BUILD_PROFILE, "hosted-acceptance");
  for (const name of ["SystemRoot", "WINDIR", "TEMP", "TMP", "PATH"]) {
    assert.equal(receipt.environment[name], input.environment[name]);
  }
  for (const name of ["npm_execpath", "VERCEL_TOKEN", "NODE_OPTIONS"]) {
    assert.equal(receipt.environment[name], undefined);
  }
  assert.match(output.join(""), /Hosted Store acceptance package is ready:/u);
});

test("hosted CLI does not audit or claim readiness after a real build process fails", async (context) => {
  const input = await fixture(
    context,
    'require("node:fs").writeFileSync("started", "yes"); process.exitCode = 7;',
  );
  const output = [];
  let auditCalls = 0;
  const code = await runHostedAcceptanceStoreCli({
    arguments_: ["build"],
    environment: input.environment,
    repositoryRoot: input.directory,
    auditStore: async () => {
      auditCalls += 1;
      return [];
    },
    writeOutput: (value) => output.push(value),
    writeError: (value) => output.push(value),
  });

  assert.equal(await readFile(join(input.directory, "started"), "utf8"), "yes");
  assert.equal(code, 1);
  assert.equal(auditCalls, 0);
  assert.deepEqual(output, ["Hosted Store acceptance package failed closed.\n"]);
});

test("hosted CLI fails closed without a configured pnpm entrypoint", async () => {
  const output = [];
  let auditCalls = 0;
  const code = await runHostedAcceptanceStoreCli({
    arguments_: ["build"],
    environment: { PATH: "" },
    repositoryRoot: tmpdir(),
    auditStore: async () => {
      auditCalls += 1;
      return [];
    },
    writeOutput: (value) => output.push(value),
    writeError: (value) => output.push(value),
  });
  assert.equal(code, 1);
  assert.equal(auditCalls, 0);
  assert.deepEqual(output, ["Hosted Store acceptance package failed closed.\n"]);
});
