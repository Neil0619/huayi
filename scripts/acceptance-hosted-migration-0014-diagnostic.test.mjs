import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  hostedMigration0014DiagnosticArgument,
  runHostedMigration0014ConnectionProbe,
  runHostedMigration0014DiagnosticCli,
} from "./acceptance-hosted-migration-0014-diagnostic.mjs";

const caCertificate =
  "-----BEGIN CERTIFICATE-----\n" + "a".repeat(64) + "\n-----END CERTIFICATE-----\n";
const validDryRun = `DRY RUN: migrations will *not* be pushed to the database.
Connecting to remote database...
Would push these migrations:
 • 20260824010000_password_signup_otp_resend.sql
Finished supabase db push.
`;

test("package exposes one fixed 0014 safe diagnostic entrypoint", async () => {
  const packageDocument = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  assert.equal(
    packageDocument.scripts["acceptance:hosted:migration:0014:diagnose"],
    "node scripts/acceptance-hosted-migration-0014-diagnostic.mjs --diagnose-20260824010000-password-signup-otp-resend-kpadiulxkgckskcfydry",
  );
});

test("0014 diagnostic reports only fixed successful predicates", async () => {
  let stdout = "";
  let stderr = "";
  const code = await runHostedMigration0014DiagnosticCli({
    arguments_: [hostedMigration0014DiagnosticArgument],
    environment: {},
    fetchCaCertificate: async () => caCertificate,
    readPassword: async () => "fictional-password",
    runConnectionProbe: async ({ administratorPassword, caCertificate: certificate }) => {
      assert.equal(administratorPassword, "fictional-password");
      assert.equal(certificate, caCertificate);
      return { code: 0, stderr: "", stdout: "connection_ok|t\n" };
    },
    runDryRun: async () => ({ code: 0, stderr: validDryRun, stdout: "" }),
    writeError: (value) => {
      stderr += value;
    },
    writeOutput: (value) => {
      stdout += value;
    },
  });

  assert.equal(code, 0);
  assert.equal(stderr, "");
  assert.equal(
    stdout,
    `connection_exit_class|ok
connection_output_exact|t
dry_run_exit_class|ok
dry_run_stdout_empty|t
dry_run_transcript_exact|t
`,
  );
  assert.doesNotMatch(stdout, /fictional|postgresql|Connecting/u);
});

test("0014 connection probe pins query and process timeout without exposing the secret", async () => {
  let observed;
  const result = await runHostedMigration0014ConnectionProbe(
    {
      administratorPassword: "fictional-password",
      caCertificate,
    },
    {
      runPsql: async (options) => {
        observed = options;
        return { code: 0, stderr: "", stdout: "connection_ok|t\n" };
      },
    },
  );

  assert.equal(result.code, 0);
  assert.match(observed.databaseUrl, /sslmode=verify-full&connect_timeout=10$/u);
  assert.equal(observed.timeoutMilliseconds, 15_000);
  assert.equal(observed.input, "SELECT 'connection_ok|t';\n");
  assert.equal(observed.environment.PGPASSWORD, "fictional-password");
  assert.equal(JSON.stringify(observed).includes("fictional-password"), true);
  assert.equal(observed.databaseUrl.includes("fictional-password"), false);
});

test("0014 diagnostic stops before Supabase dry-run when the fixed connection probe fails", async () => {
  let dryRunCalls = 0;
  let stdout = "";
  const code = await runHostedMigration0014DiagnosticCli({
    arguments_: [hostedMigration0014DiagnosticArgument],
    environment: {},
    fetchCaCertificate: async () => caCertificate,
    readPassword: async () => "fictional-password",
    runConnectionProbe: async () => ({
      code: 2,
      stderr: "private connection detail",
      stdout: "",
    }),
    runDryRun: async () => {
      dryRunCalls += 1;
      return { code: 0, stderr: validDryRun, stdout: "" };
    },
    writeError: () => assert.fail("must not report infrastructure failure"),
    writeOutput: (value) => {
      stdout += value;
    },
  });

  assert.equal(code, 0);
  assert.equal(dryRunCalls, 0);
  assert.equal(
    stdout,
    `connection_exit_class|connection_error
connection_output_exact|f
dry_run_exit_class|not_run
dry_run_stdout_empty|f
dry_run_transcript_exact|f
`,
  );
  assert.doesNotMatch(stdout, /private|password/u);
});

test("0014 diagnostic separates CLI failure, output channel drift, and transcript drift", async () => {
  const scenarios = [
    {
      expected: ["command_error", "t", "f"],
      result: { code: 1, stderr: "private database error", stdout: "" },
    },
    {
      expected: ["ok", "f", "t"],
      result: { code: 0, stderr: validDryRun, stdout: "unexpected private output" },
    },
    {
      expected: ["ok", "t", "f"],
      result: { code: 0, stderr: "private transcript drift", stdout: "" },
    },
  ];
  for (const scenario of scenarios) {
    let stdout = "";
    const code = await runHostedMigration0014DiagnosticCli({
      arguments_: [hostedMigration0014DiagnosticArgument],
      environment: {},
      fetchCaCertificate: async () => caCertificate,
      readPassword: async () => "fictional-password",
      runConnectionProbe: async () => ({ code: 0, stderr: "", stdout: "connection_ok|t\n" }),
      runDryRun: async () => scenario.result,
      writeError: () => assert.fail("must not report infrastructure failure"),
      writeOutput: (value) => {
        stdout += value;
      },
    });

    assert.equal(code, 0);
    const lines = stdout.trimEnd().split("\n");
    assert.deepEqual(lines.slice(2), [
      `dry_run_exit_class|${scenario.expected[0]}`,
      `dry_run_stdout_empty|${scenario.expected[1]}`,
      `dry_run_transcript_exact|${scenario.expected[2]}`,
    ]);
    assert.doesNotMatch(stdout, /private|unexpected/u);
  }
});

test("0014 diagnostic rejects inherited secrets or wrong arguments before external work", async () => {
  for (const testCase of [
    { arguments_: [], environment: {} },
    { arguments_: ["--wrong"], environment: {} },
    { arguments_: [hostedMigration0014DiagnosticArgument], environment: { PGPASSWORD: "secret" } },
    {
      arguments_: [hostedMigration0014DiagnosticArgument],
      environment: { SUPABASE_DB_PASSWORD: "secret" },
    },
  ]) {
    let calls = 0;
    let stderr = "";
    const code = await runHostedMigration0014DiagnosticCli({
      ...testCase,
      fetchCaCertificate: async () => {
        calls += 1;
        return caCertificate;
      },
      readPassword: async () => {
        calls += 1;
        return "must-not-run";
      },
      runConnectionProbe: async () => {
        calls += 1;
        return { code: 0, stderr: "", stdout: "connection_ok|t\n" };
      },
      runDryRun: async () => {
        calls += 1;
        return { code: 0, stderr: validDryRun, stdout: "" };
      },
      writeError: (value) => {
        stderr += value;
      },
      writeOutput: () => assert.fail("must not write diagnostic predicates"),
    });

    assert.equal(code, 1);
    assert.equal(calls, 0);
    assert.equal(
      stderr,
      "Hosted 0014 migration safe diagnostic failed at allowlisted stage arguments.\n",
    );
    assert.doesNotMatch(stderr, /secret/u);
  }
});

test("0014 diagnostic reports only the fixed stage for thrown private errors", async () => {
  const stages = [
    {
      expected: "ca-fetch",
      fetchCaCertificate: async () => {
        throw new Error("private CA detail");
      },
    },
    {
      expected: "password-prompt",
      readPassword: async () => {
        throw new Error("private prompt detail");
      },
    },
    {
      expected: "password-validation",
      readPassword: async () => "",
    },
    {
      expected: "connection-probe",
      runConnectionProbe: async () => {
        throw new Error("private connection detail");
      },
    },
    {
      expected: "dry-run-process",
      runDryRun: async () => {
        throw new Error("private CLI detail");
      },
    },
  ];
  for (const scenario of stages) {
    let stderr = "";
    const code = await runHostedMigration0014DiagnosticCli({
      arguments_: [hostedMigration0014DiagnosticArgument],
      environment: {},
      fetchCaCertificate: async () => caCertificate,
      readPassword: async () => "fictional-password",
      runConnectionProbe: async () => ({ code: 0, stderr: "", stdout: "connection_ok|t\n" }),
      runDryRun: async () => ({ code: 0, stderr: validDryRun, stdout: "" }),
      writeError: (value) => {
        stderr += value;
      },
      writeOutput: () => assert.fail("must not write predicates after thrown failure"),
      ...scenario,
    });

    assert.equal(code, 1);
    assert.equal(
      stderr,
      `Hosted 0014 migration safe diagnostic failed at allowlisted stage ${scenario.expected}.\n`,
    );
    assert.doesNotMatch(stderr, /private|fictional/u);
  }
});
