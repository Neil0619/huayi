import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import { PassThrough } from "node:stream";
import test from "node:test";

import {
  hostedMigration0014DryRunArgument,
  hostedMigration0014Filename,
  hostedMigration0014SuccessMessage,
  parseHostedMigration0014DryRunOutput,
  runHostedMigration0014DryRunCli,
  runHostedMigration0014DryRunProcess,
} from "./acceptance-hosted-migration-0014-dry-run.mjs";

const validOutput = `DRY RUN: migrations will *not* be pushed to the database.
Connecting to remote database...
Would push these migrations:
 • 20260824010000_password_signup_otp_resend.sql
Finished supabase db push.
`;

test("package exposes only the exact pinned 0014 dry-run entrypoint", async () => {
  const packageDocument = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  assert.equal(
    packageDocument.scripts["acceptance:hosted:migration:0014:dry-run"],
    "node scripts/acceptance-hosted-migration-0014-dry-run.mjs --confirm-dry-run-20260824010000-password-signup-otp-resend-kpadiulxkgckskcfydry",
  );
  const implementation = await readFile(
    new URL("./acceptance-hosted-migration-0014-dry-run.mjs", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(implementation, /node:fs|writeFile|PGPASSFILE/u);
});

test("0014 dry-run parser accepts only the exact non-mutating single migration transcript", () => {
  assert.equal(parseHostedMigration0014DryRunOutput(validOutput), true);
  assert.equal(parseHostedMigration0014DryRunOutput(validOutput.replace(" • ", "• ")), true);

  for (const output of [
    validOutput.replace(" • ", " • 20260823010000_old.sql\n • "),
    validOutput.replace(` • ${hostedMigration0014Filename}\n`, ""),
    validOutput.replace("DRY RUN: migrations will *not* be pushed", "Applying migration"),
    validOutput.replace("Finished supabase db push.\n", ""),
    `${validOutput}unexpected private text\n`,
    validOutput.replace(" • ", "  • "),
  ]) {
    assert.equal(parseHostedMigration0014DryRunOutput(output), false);
  }
});

test("0014 dry-run process uses the pinned local CLI, fixed args, and process-only password", async () => {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.kill = () => true;
  let observed;
  const resultPromise = runHostedMigration0014DryRunProcess("fictional-secret", {
    spawnProcess(command, arguments_, options) {
      observed = { arguments_, command, options };
      queueMicrotask(() => {
        child.stdout.end(validOutput);
        child.emit("close", 0, null);
      });
      return child;
    },
  });

  assert.deepEqual(await resultPromise, { code: 0, stdout: validOutput });
  assert.match(observed.command, /\/node_modules\/\.bin\/supabase$/u);
  assert.deepEqual(observed.arguments_, [
    "db",
    "push",
    "--dry-run",
    "--skip-vault",
    "--db-url",
    "postgresql://postgres.kpadiulxkgckskcfydry@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres",
  ]);
  assert.deepEqual(observed.options.env, {
    LANG: "C",
    LC_ALL: "C",
    PGPASSWORD: "fictional-secret",
  });
  assert.equal(observed.options.shell, false);
  assert.deepEqual(observed.options.stdio, ["ignore", "pipe", "ignore"]);
  assert.equal(JSON.stringify(observed).includes("fictional-secret"), true);
  assert.equal(JSON.stringify(observed.arguments_).includes("fictional-secret"), false);
});

test("0014 dry-run process suppresses overflow and waits for a timed-out child to close", async () => {
  const overflowChild = new EventEmitter();
  overflowChild.stdout = new PassThrough();
  overflowChild.kill = () => true;
  const overflowPromise = runHostedMigration0014DryRunProcess("fictional-secret", {
    maxOutputBytes: 8,
    spawnProcess: () => overflowChild,
  });
  overflowChild.stdout.write("123456789");
  overflowChild.emit("close", null, "SIGKILL");
  assert.deepEqual(await overflowPromise, { code: null, stdout: "" });

  const timeoutChild = new EventEmitter();
  timeoutChild.stdout = new PassThrough();
  let killed = false;
  timeoutChild.kill = () => {
    killed = true;
    return true;
  };
  let resolved = false;
  const timeoutPromise = runHostedMigration0014DryRunProcess("fictional-secret", {
    spawnProcess: () => timeoutChild,
    timeoutMilliseconds: 1,
  }).then((result) => {
    resolved = true;
    return result;
  });
  await new Promise((resolveWait) => setTimeout(resolveWait, 10));
  assert.equal(killed, true);
  assert.equal(resolved, false);
  timeoutChild.emit("close", null, "SIGKILL");
  assert.deepEqual(await timeoutPromise, { code: null, stdout: "" });
});

test("0014 dry-run CLI rejects inherited password variables and invalid confirmation before TTY input", async () => {
  for (const testCase of [
    { arguments_: [hostedMigration0014DryRunArgument], environment: { PGPASSWORD: "secret" } },
    {
      arguments_: [hostedMigration0014DryRunArgument],
      environment: { SUPABASE_DB_PASSWORD: "secret" },
    },
    { arguments_: ["--confirm-wrong-project"], environment: {} },
    { arguments_: [], environment: {} },
  ]) {
    let passwordReads = 0;
    let processRuns = 0;
    let stderr = "";
    const code = await runHostedMigration0014DryRunCli({
      ...testCase,
      readPassword: async () => {
        passwordReads += 1;
        return "must-not-run";
      },
      runSupabase: async () => {
        processRuns += 1;
        return { code: 0, stdout: validOutput };
      },
      writeError: (value) => {
        stderr += value;
      },
      writeOutput: () => assert.fail("must not write stdout"),
    });
    assert.equal(code, 1);
    assert.equal(passwordReads, 0);
    assert.equal(processRuns, 0);
    assert.equal(
      stderr,
      "Hosted 0014 migration dry-run failed closed; database was not modified.\n",
    );
    assert.equal(stderr.includes("secret"), false);
  }
});

test("0014 dry-run CLI reports one fixed success and never reflects process output or password", async () => {
  let stdout = "";
  let stderr = "";
  const password = "fictional-secret";
  const code = await runHostedMigration0014DryRunCli({
    arguments_: [hostedMigration0014DryRunArgument],
    environment: {},
    readPassword: async () => password,
    runSupabase: async (receivedPassword) => {
      assert.equal(receivedPassword, password);
      return { code: 0, stdout: validOutput };
    },
    writeError: (value) => {
      stderr += value;
    },
    writeOutput: (value) => {
      stdout += value;
    },
  });

  assert.equal(code, 0);
  assert.equal(stdout, `${hostedMigration0014SuccessMessage}\n`);
  assert.equal(stderr, "");
  assert.equal(stdout.includes(password), false);
  assert.equal(stdout.includes("Connecting"), false);
});

test("0014 dry-run CLI fails closed on invalid secret or every untrusted process result", async () => {
  const failures = [
    { password: "", result: { code: 0, stdout: validOutput } },
    { password: "x".repeat(513), result: { code: 0, stdout: validOutput } },
    { password: "bad\nsecret", result: { code: 0, stdout: validOutput } },
    { password: "valid", result: { code: 1, stdout: validOutput } },
    { password: "valid", result: { code: null, stdout: "" } },
    { password: "valid", result: { code: 0, stdout: `${validOutput}secret-output\n` } },
  ];
  for (const { password, result } of failures) {
    let processRuns = 0;
    let stderr = "";
    const code = await runHostedMigration0014DryRunCli({
      arguments_: [hostedMigration0014DryRunArgument],
      environment: {},
      readPassword: async () => password,
      runSupabase: async () => {
        processRuns += 1;
        return result;
      },
      writeError: (value) => {
        stderr += value;
      },
      writeOutput: () => assert.fail("must not write stdout"),
    });
    assert.equal(code, 1);
    assert.equal(processRuns, password === "valid" ? 1 : 0);
    assert.equal(
      stderr,
      "Hosted 0014 migration dry-run failed closed; database was not modified.\n",
    );
    assert.equal(stderr.includes("secret"), false);
  }
});
