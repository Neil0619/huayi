import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  hostedMigration0022ApplyArgument,
  hostedMigration0022ApplySuccessMessage,
  runHostedMigration0022ApplyCli,
  runHostedMigration0022Preflight,
  verifyHostedMigration0022RepositoryIdentity,
} from "./acceptance-hosted-migration-0022-apply.mjs";
import {
  hasExactHostedMigration0022DryRunTranscript,
  hostedMigration0022DryRunArgument,
  hostedMigration0022Filename,
  runHostedMigration0022DryRunCli,
} from "./acceptance-hosted-migration-0022-dry-run.mjs";
import { hostedMigration0022StatusArgument } from "./acceptance-hosted-migration-0022-status.mjs";

const caCertificate =
  "-----BEGIN CERTIFICATE-----\n" + "a".repeat(64) + "\n-----END CERTIFICATE-----\n";
const validDryRunOutput = `DRY RUN: migrations will *not* be pushed to the database.
Connecting to remote database...
Would push these migrations:
 • 20260828010000_password_signup_expired_invitation_recovery.sql
Finished supabase db push.
`;

test("0022 commands pin one fixed migration and package surface", async () => {
  assert.equal(
    hostedMigration0022Filename,
    "20260828010000_password_signup_expired_invitation_recovery.sql",
  );
  assert.notEqual(hostedMigration0022DryRunArgument, hostedMigration0022ApplyArgument);
  assert.match(hostedMigration0022StatusArgument, /20260828010000/u);
  assert.match(hostedMigration0022ApplySuccessMessage, /20260828010000/u);

  const packageDocument = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  for (const [operation, argument] of [
    ["status", hostedMigration0022StatusArgument],
    ["dry-run", hostedMigration0022DryRunArgument],
    ["apply", hostedMigration0022ApplyArgument],
  ]) {
    assert.equal(
      packageDocument.scripts[`acceptance:hosted:migration:0022:${operation}`],
      `node scripts/acceptance-hosted-migration-0022-${operation}.mjs ${argument}`,
    );
  }
});

test("0022 dry-run accepts only the exact one-file transcript", () => {
  assert.equal(
    hasExactHostedMigration0022DryRunTranscript({ stderr: validDryRunOutput, stdout: "" }),
    true,
  );
  for (const transcript of [
    validDryRunOutput.replace(` • ${hostedMigration0022Filename}\n`, ""),
    validDryRunOutput.replace(hostedMigration0022Filename, "unexpected.sql"),
    `${validDryRunOutput}private-detail\n`,
    validDryRunOutput.replace("Would push these migrations:\n", ""),
  ]) {
    assert.equal(
      hasExactHostedMigration0022DryRunTranscript({ stderr: transcript, stdout: "" }),
      false,
    );
  }
});

test("0022 apply pins byte-identical mirrors and a fixed source hash", async () => {
  await assert.doesNotReject(verifyHostedMigration0022RepositoryIdentity());
  let reads = 0;
  await assert.rejects(
    verifyHostedMigration0022RepositoryIdentity({
      readMigrationFile: async () => {
        reads += 1;
        return Buffer.from(reads === 1 ? "one" : "two");
      },
    }),
    /repository identity is invalid/u,
  );
});

test("0022 apply orders immutable evidence around exact remote state", async () => {
  const calls = [];
  let stdout = "";
  const code = await runHostedMigration0022ApplyCli({
    arguments_: [hostedMigration0022ApplyArgument],
    environment: {},
    fetchCaCertificate: async () => {
      calls.push("fetch-ca");
      return caCertificate;
    },
    readPassword: async () => {
      calls.push("password");
      return "fictional-administrator-password";
    },
    runApply: async () => {
      calls.push("apply");
      return { code: 0 };
    },
    runDryRun: async () => {
      calls.push("dry-run");
      return { code: 0, stderr: validDryRunOutput, stdout: "" };
    },
    runPostflight: async () => {
      calls.push("postflight");
      return true;
    },
    runPreflight: async () => {
      calls.push("preflight");
      return true;
    },
    runStatus: async () => {
      calls.push("status");
      return "pending_exact";
    },
    writeOutput: (value) => {
      stdout += value;
    },
  });
  assert.equal(code, 0);
  assert.deepEqual(calls, [
    "preflight",
    "fetch-ca",
    "password",
    "dry-run",
    "preflight",
    "status",
    "apply",
    "postflight",
  ]);
  assert.equal(stdout, `${hostedMigration0022ApplySuccessMessage}\n`);
});

test("0022 commands fail before secrets on invalid arguments, evidence, or inherited password", async () => {
  for (const runCli of [runHostedMigration0022DryRunCli, runHostedMigration0022ApplyCli]) {
    let calls = 0;
    const external = async () => {
      calls += 1;
      throw new Error("private-detail");
    };
    const code = await runCli({
      arguments_: [],
      environment: { PGPASSWORD: "secret" },
      fetchCaCertificate: external,
      readPassword: external,
      runApply: external,
      runPreflight: external,
      runStatus: external,
      runSupabase: external,
      writeError: () => undefined,
      writeOutput: () => undefined,
    });
    assert.equal(code, 1);
    assert.equal(calls, 0);
  }

  const calls = [];
  assert.equal(
    await runHostedMigration0022Preflight({
      runBackupCli: async () => {
        calls.push("evidence");
        return 0;
      },
      verifyRepositoryIdentity: async () => {
        calls.push("repository");
        return true;
      },
      verifySupabaseCli: async () => {
        calls.push("supabase-cli");
        return true;
      },
    }),
    true,
  );
  assert.deepEqual(calls, ["evidence", "repository", "supabase-cli"]);
});

test("0022 apply proves zero mutation unless every immediate gate is exact", async () => {
  let secretCalls = 0;
  let applyCalls = 0;
  assert.equal(
    await runHostedMigration0022ApplyCli({
      arguments_: [hostedMigration0022ApplyArgument],
      environment: {},
      fetchCaCertificate: async () => {
        secretCalls += 1;
        return caCertificate;
      },
      readPassword: async () => {
        secretCalls += 1;
        return "fictional-administrator-password";
      },
      runApply: async () => {
        applyCalls += 1;
        return { code: 0 };
      },
      runPreflight: async () => false,
      writeError: () => undefined,
    }),
    1,
  );
  assert.equal(secretCalls, 0);
  assert.equal(applyCalls, 0);

  for (const { dryRun, preflightResults, status } of [
    {
      dryRun: { code: 0, stderr: `${validDryRunOutput}unexpected\n`, stdout: "" },
      preflightResults: [true],
      status: "pending_exact",
    },
    {
      dryRun: { code: 0, stderr: validDryRunOutput, stdout: "" },
      preflightResults: [true, false],
      status: "pending_exact",
    },
    {
      dryRun: { code: 0, stderr: validDryRunOutput, stdout: "" },
      preflightResults: [true, true],
      status: "applied_exact",
    },
    {
      dryRun: { code: 0, stderr: validDryRunOutput, stdout: "" },
      preflightResults: [true, true],
      status: "uncertain",
    },
  ]) {
    let preflightCalls = 0;
    let statusCalls = 0;
    applyCalls = 0;
    const code = await runHostedMigration0022ApplyCli({
      arguments_: [hostedMigration0022ApplyArgument],
      environment: {},
      fetchCaCertificate: async () => caCertificate,
      readPassword: async () => "fictional-administrator-password",
      runApply: async () => {
        applyCalls += 1;
        return { code: 0 };
      },
      runDryRun: async () => dryRun,
      runPreflight: async () => preflightResults[preflightCalls++],
      runStatus: async () => {
        statusCalls += 1;
        return status;
      },
      writeError: () => undefined,
    });
    assert.equal(code, 1);
    assert.equal(applyCalls, 0);
    assert.equal(statusCalls, preflightResults.length === 2 && preflightResults[1] ? 1 : 0);
  }
});

test("0022 apply hides mutation and postflight failures", async () => {
  for (const { applyResult, postflightResult } of [
    { applyResult: { code: 1 }, postflightResult: true },
    { applyResult: { code: 0 }, postflightResult: false },
  ]) {
    let stderr = "";
    let stdout = "";
    const code = await runHostedMigration0022ApplyCli({
      arguments_: [hostedMigration0022ApplyArgument],
      environment: {},
      fetchCaCertificate: async () => caCertificate,
      readPassword: async () => "fictional-administrator-password",
      runApply: async () => applyResult,
      runDryRun: async () => ({ code: 0, stderr: validDryRunOutput, stdout: "" }),
      runPostflight: async () => postflightResult,
      runPreflight: async () => true,
      runStatus: async () => "pending_exact",
      writeError: (value) => {
        stderr += value;
      },
      writeOutput: (value) => {
        stdout += value;
      },
    });
    assert.equal(code, 1);
    assert.equal(stdout, "");
    assert.match(stderr, /^Hosted 0022 migration apply did not produce/u);
    assert.doesNotMatch(stderr, /private|password|certificate/u);
  }
});
