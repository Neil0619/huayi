import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  hostedMigration0023ApplyArgument,
  hostedMigration0023ApplySuccessMessage,
  runHostedMigration0023ApplyCli,
  runHostedMigration0023Preflight,
  verifyHostedMigration0023RepositoryIdentity,
} from "./acceptance-hosted-migration-0023-apply.mjs";
import {
  hasExactHostedMigration0023DryRunTranscript,
  hostedMigration0023DryRunArgument,
  hostedMigration0023Filename,
  runHostedMigration0023DryRunCli,
} from "./acceptance-hosted-migration-0023-dry-run.mjs";
import {
  hostedMigration0023StatusDiagnosticArgument,
  hostedMigration0023StatusDiagnosticPredicateNames,
  parseHostedMigration0023StatusDiagnosticOutput,
} from "./acceptance-hosted-migration-0023-status-diagnostic.mjs";
import {
  hostedMigration0023StatusArgument,
  parseHostedMigration0023StatusOutput,
  renderHostedMigration0023StatusSql,
} from "./acceptance-hosted-migration-0023-status.mjs";

const caCertificate =
  "-----BEGIN CERTIFICATE-----\n" + "a".repeat(64) + "\n-----END CERTIFICATE-----\n";
const validTranscript = `DRY RUN: migrations will *not* be pushed to the database.
Connecting to remote database...
Would push these migrations:
 • 20260831010000_invitation_token_recovery.sql
Finished supabase db push.
`;

test("0023 commands pin one migration and complete package surface", async () => {
  assert.equal(hostedMigration0023Filename, "20260831010000_invitation_token_recovery.sql");
  assert.notEqual(hostedMigration0023DryRunArgument, hostedMigration0023ApplyArgument);
  assert.match(hostedMigration0023StatusArgument, /20260831010000/u);
  const packageDocument = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  for (const [operation, argument] of [
    ["status", hostedMigration0023StatusArgument],
    ["dry-run", hostedMigration0023DryRunArgument],
    ["apply", hostedMigration0023ApplyArgument],
    ["status:diagnose", hostedMigration0023StatusDiagnosticArgument],
  ]) {
    const filename = operation === "status:diagnose" ? "status-diagnostic" : operation;
    assert.equal(
      packageDocument.scripts[`acceptance:hosted:migration:0023:${operation}`],
      `node scripts/acceptance-hosted-migration-0023-${filename}.mjs ${argument}`,
    );
  }
});

test("0023 dry-run accepts only its exact one-file transcript", () => {
  assert.equal(
    hasExactHostedMigration0023DryRunTranscript({ stderr: validTranscript, stdout: "" }),
    true,
  );
  for (const transcript of [
    validTranscript.replace(` • ${hostedMigration0023Filename}\n`, ""),
    validTranscript.replace(hostedMigration0023Filename, "unexpected.sql"),
    `${validTranscript}private-detail\n`,
  ]) {
    assert.equal(
      hasExactHostedMigration0023DryRunTranscript({ stderr: transcript, stdout: "" }),
      false,
    );
  }
});

test("0023 repository identity pins byte-identical mirrors and source hash", async () => {
  await assert.doesNotReject(verifyHostedMigration0023RepositoryIdentity());
  let reads = 0;
  await assert.rejects(
    verifyHostedMigration0023RepositoryIdentity({
      readMigrationFile: async () => Buffer.from(++reads === 1 ? "one" : "two"),
    }),
    /repository identity is invalid/u,
  );
});

test("0023 status and diagnostic remain read-only, exact, and redacted", () => {
  assert.match(renderHostedMigration0023StatusSql(), /BEGIN READ ONLY/iu);
  assert.match(renderHostedMigration0023StatusSql(), /ROLLBACK/iu);
  assert.equal(parseHostedMigration0023StatusOutput("pending_exact\n"), "pending_exact");
  assert.equal(parseHostedMigration0023StatusOutput("private\n"), null);
  const lines = hostedMigration0023StatusDiagnosticPredicateNames.map(
    (name) => `${name}|${name === "pending_state_exact" ? "t" : "f"}`,
  );
  assert.equal(
    parseHostedMigration0023StatusDiagnosticOutput(`${lines.join("\n")}\n`)?.finalStatus,
    "pending_exact",
  );
  assert.equal(parseHostedMigration0023StatusDiagnosticOutput("token_hash|private\n"), null);
});

test("0023 apply orders evidence, dry-run, pending state, apply, and postflight", async () => {
  const calls = [];
  let output = "";
  const code = await runHostedMigration0023ApplyCli({
    arguments_: [hostedMigration0023ApplyArgument],
    environment: {},
    fetchCaCertificate: async () => {
      calls.push("ca");
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
      return { code: 0, stderr: validTranscript, stdout: "" };
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
      output += value;
    },
  });
  assert.equal(code, 0);
  assert.deepEqual(calls, [
    "preflight",
    "ca",
    "password",
    "dry-run",
    "preflight",
    "status",
    "apply",
    "postflight",
  ]);
  assert.equal(output, `${hostedMigration0023ApplySuccessMessage}\n`);
});

test("0023 controls fail before secrets or mutation when gates are not exact", async () => {
  for (const runCli of [runHostedMigration0023DryRunCli, runHostedMigration0023ApplyCli]) {
    let calls = 0;
    const external = async () => {
      calls += 1;
      throw new Error("private");
    };
    assert.equal(
      await runCli({
        arguments_: [],
        environment: { PGPASSWORD: "private" },
        fetchCaCertificate: external,
        readPassword: external,
        runApply: external,
        runPreflight: external,
        runStatus: external,
        runSupabase: external,
        writeError: () => undefined,
      }),
      1,
    );
    assert.equal(calls, 0);
  }
  const order = [];
  assert.equal(
    await runHostedMigration0023Preflight({
      runBackupCli: async () => {
        order.push("evidence");
        return 0;
      },
      verifyRepositoryIdentity: async () => {
        order.push("repository");
        return true;
      },
      verifySupabaseCli: async () => {
        order.push("cli");
        return true;
      },
    }),
    true,
  );
  assert.deepEqual(order, ["evidence", "repository", "cli"]);
});
