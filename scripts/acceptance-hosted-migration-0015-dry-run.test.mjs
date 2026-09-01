import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";

import {
  classifyHostedMigration0015DryRunTranscript,
  hasExactHostedMigration0015DryRunTranscript,
  hostedMigration0015DryRunArgument,
  hostedMigration0015Filename,
  hostedMigration0015SuccessMessage,
  parseHostedMigration0015DryRunOutput,
  runHostedMigration0015DryRunCli,
  runHostedMigration0015DryRunProcess,
} from "./acceptance-hosted-migration-0015-dry-run.mjs";

const caCertificate =
  "-----BEGIN CERTIFICATE-----\n" + "a".repeat(64) + "\n-----END CERTIFICATE-----\n";
const validOutput = `DRY RUN: migrations will *not* be pushed to the database.
Connecting to remote database...
Would push these migrations:
 • 20260825010000_public_function_acl_hardening.sql
Finished supabase db push.
`;

function createChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdout.setEncoding = () => undefined;
  child.stderr.setEncoding = () => undefined;
  child.kill = () => true;
  return child;
}

async function runCli(overrides = {}) {
  let stderr = "";
  let stdout = "";
  const code = await runHostedMigration0015DryRunCli({
    arguments_: [hostedMigration0015DryRunArgument],
    environment: {},
    fetchCaCertificate: async () => caCertificate,
    readPassword: async () => "fictional-administrator-password",
    runSupabase: async () => ({ code: 0, stderr: validOutput, stdout: "" }),
    writeError: (value) => {
      stderr += value;
    },
    writeOutput: (value) => {
      stdout += value;
    },
    ...overrides,
  });
  return { code, stderr, stdout };
}

test("package exposes one exact pinned 0015 dry-run entrypoint", async () => {
  const packageDocument = JSON.parse(
    await (await import("node:fs/promises")).readFile(new URL("../package.json", import.meta.url)),
  );
  assert.equal(
    packageDocument.scripts["acceptance:hosted:migration:0015:dry-run"],
    `node scripts/acceptance-hosted-migration-0015-dry-run.mjs ${hostedMigration0015DryRunArgument}`,
  );
  assert.equal(hostedMigration0015Filename, "20260825010000_public_function_acl_hardening.sql");
  assert.equal(
    hostedMigration0015DryRunArgument,
    "--confirm-dry-run-20260825010000-public-function-acl-hardening-kpadiulxkgckskcfydry",
  );
});

test("0015 dry-run parser accepts only one exact non-mutating transcript", () => {
  assert.equal(parseHostedMigration0015DryRunOutput(validOutput), true);
  assert.equal(parseHostedMigration0015DryRunOutput(validOutput.replace(" • ", "• ")), true);
  assert.equal(
    hasExactHostedMigration0015DryRunTranscript({ stderr: "", stdout: validOutput }),
    true,
  );
  const split = validOutput.indexOf("Would push these migrations:");
  assert.equal(
    hasExactHostedMigration0015DryRunTranscript({
      stderr: validOutput.slice(0, split),
      stdout: validOutput.slice(split),
    }),
    true,
  );
  for (const transcript of [
    validOutput.replace(` • ${hostedMigration0015Filename}\n`, ""),
    validOutput.replace(hostedMigration0015Filename, "extra.sql"),
    `${validOutput}unexpected\n`,
    validOutput.replace("Finished supabase db push.\n", ""),
  ]) {
    assert.equal(parseHostedMigration0015DryRunOutput(transcript), false);
  }
  assert.deepEqual(
    classifyHostedMigration0015DryRunTranscript({ stderr: "private\n", stdout: validOutput }),
    {
      channelRelativeOrderExact: false,
      lineMultisetExact: false,
      stderrLinesAllowlisted: false,
      stdoutLinesAllowlisted: true,
      transcriptExact: false,
    },
  );
});

test("0015 dry-run rejects arguments and inherited password variables before external work", async () => {
  for (const testCase of [
    { arguments_: [], environment: {} },
    { arguments_: [hostedMigration0015DryRunArgument, "extra"], environment: {} },
    { arguments_: [hostedMigration0015DryRunArgument], environment: { PGPASSWORD: "secret" } },
    {
      arguments_: [hostedMigration0015DryRunArgument],
      environment: { SUPABASE_DB_PASSWORD: "secret" },
    },
  ]) {
    let calls = 0;
    const external = async () => {
      calls += 1;
      throw new Error("private");
    };
    const result = await runCli({
      ...testCase,
      fetchCaCertificate: external,
      readPassword: external,
      runSupabase: external,
    });
    assert.equal(calls, 0);
    assert.equal(result.code, 1);
    assert.equal(result.stdout, "");
    assert.equal(
      result.stderr,
      "Hosted 0015 migration dry-run failed closed; database was not modified.\n",
    );
  }
});

test("0015 dry-run process pins exact CLI, verify-full CA, bounds output, and cleans CA", async () => {
  const child = createChild();
  let observed;
  const resultPromise = runHostedMigration0015DryRunProcess(
    { administratorPassword: "fictional-secret", caCertificate },
    {
      spawnProcess(command, arguments_, options) {
        observed = { arguments_, command, options };
        return child;
      },
    },
  );
  while (observed === undefined) await new Promise((resolveWait) => setImmediate(resolveWait));
  assert.match(observed.command, /[\\/]node_modules[\\/]\.bin[\\/]supabase$/u);
  assert.deepEqual(observed.arguments_, [
    "db",
    "push",
    "--dry-run",
    "--skip-vault",
    "--db-url",
    "postgresql://postgres.kpadiulxkgckskcfydry@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres?sslmode=verify-full",
  ]);
  assert.equal(observed.options.env.PGPASSWORD, undefined);
  const passwordPath = observed.options.env.PGPASSFILE;
  assert.equal((await stat(passwordPath)).mode & 0o777, 0o600);
  assert.equal(
    await readFile(passwordPath, "utf8"),
    "aws-0-ap-southeast-1.pooler.supabase.com:6543:postgres:postgres.kpadiulxkgckskcfydry:fictional-secret\n",
  );
  assert.equal(observed.options.env.PGSSLMODE, "verify-full");
  assert.equal(observed.options.shell, false);
  assert.deepEqual(observed.options.stdio, ["ignore", "pipe", "pipe"]);
  const caPath = observed.options.env.PGSSLROOTCERT;
  if (process.platform !== "win32") assert.equal((await stat(caPath)).mode & 0o777, 0o600);
  child.stderr.emit("data", validOutput);
  child.emit("close", 0, null);
  assert.deepEqual(await resultPromise, { code: 0, stderr: validOutput, stdout: "" });
  await assert.rejects(stat(caPath), { code: "ENOENT" });
  await assert.rejects(stat(passwordPath), { code: "ENOENT" });
});

test("0015 dry-run CLI emits one fixed success and hides every failure", async () => {
  assert.deepEqual(await runCli(), {
    code: 0,
    stderr: "",
    stdout: `${hostedMigration0015SuccessMessage}\n`,
  });
  for (const overrides of [
    { fetchCaCertificate: async () => Promise.reject(new Error("private-ca")) },
    { readPassword: async () => Promise.reject(new Error("private-password")) },
    { readPassword: async () => "" },
    { runSupabase: async () => ({ code: 1, stderr: "private", stdout: "" }) },
    { runSupabase: async () => ({ code: 0, stderr: validOutput, stdout: "unexpected" }) },
  ]) {
    const result = await runCli(overrides);
    assert.deepEqual(result, {
      code: 1,
      stderr: "Hosted 0015 migration dry-run failed closed; database was not modified.\n",
      stdout: "",
    });
    assert.equal(JSON.stringify(result).includes("private-"), false);
  }
});
