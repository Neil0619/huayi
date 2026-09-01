import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  hostedPostReloginSessionDiagnosticArgument,
  hostedPostReloginSessionDiagnosticFailureMessage,
  hostedPostReloginSessionDiagnosticFieldNames,
  parseHostedPostReloginSessionDiagnosticOutput,
  renderHostedPostReloginSessionDiagnostic,
  renderHostedPostReloginSessionDiagnosticPlan,
  renderHostedPostReloginSessionDiagnosticSql,
  runHostedPostReloginSessionDiagnosticCli,
  runHostedPostReloginSessionDiagnosticQuery,
} from "./acceptance-hosted-post-relogin-session-diagnostic.mjs";

const caCertificate =
  "-----BEGIN CERTIFICATE-----\n" + "a".repeat(64) + "\n-----END CERTIFICATE-----\n";

const otherActiveDiagnostic = Object.freeze({
  migration_0023_applied: "t",
  ordinary_invitation_unique: "t",
  subject_account_exact: "t",
  session_owner_contract_exact: "t",
  all_web_session_count: "2",
  all_active_web_session_count: "1",
  subject_web_session_count: "1",
  subject_active_web_session_count: "0",
  subject_active_full_session_count: "0",
  subject_active_nonfull_session_count: "0",
  subject_revoked_web_session_count: "1",
  subject_expired_web_session_count: "0",
  other_active_web_session_count: "1",
  other_active_operator_session_count: "1",
  other_active_non_operator_session_count: "0",
  subject_session_partition_exact: "t",
  active_session_partition_exact: "t",
  subject_latest_session_state: "revoked",
  diagnostic_verdict: "other-active-only",
});

const otherActiveOutput = `${Object.entries(otherActiveDiagnostic)
  .map(([name, value]) => `${name}|${value}`)
  .join("\n")}\n`;

async function runCli(overrides = {}) {
  let stderr = "";
  let stdout = "";
  const code = await runHostedPostReloginSessionDiagnosticCli({
    arguments_: [hostedPostReloginSessionDiagnosticArgument],
    environment: {},
    fetchCaCertificate: async () => caCertificate,
    readPassword: async () => "fictional-administrator-password",
    runDiagnosticQuery: async () => otherActiveDiagnostic,
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

test("package exposes fixed post-relogin session plan and diagnostic entrypoints", async () => {
  const packageDocument = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  assert.equal(
    packageDocument.scripts["acceptance:hosted:identity:post-relogin:diagnose:plan"],
    "node scripts/acceptance-hosted-post-relogin-session-diagnostic.mjs --plan",
  );
  assert.equal(
    packageDocument.scripts["acceptance:hosted:identity:post-relogin:diagnose"],
    `node scripts/acceptance-hosted-post-relogin-session-diagnostic.mjs ${hostedPostReloginSessionDiagnosticArgument}`,
  );
});

test("diagnostic output is fixed, ordered, sanitized, and cross-field exact", () => {
  assert.deepEqual(
    hostedPostReloginSessionDiagnosticFieldNames,
    Object.keys(otherActiveDiagnostic),
  );
  assert.deepEqual(
    parseHostedPostReloginSessionDiagnosticOutput(otherActiveOutput),
    otherActiveDiagnostic,
  );
  assert.equal(renderHostedPostReloginSessionDiagnostic(otherActiveDiagnostic), otherActiveOutput);

  for (const invalid of [
    otherActiveOutput.trimEnd(),
    otherActiveOutput.replace("all_web_session_count|2", "all_web_session_count|0"),
    otherActiveOutput.replace("all_active_web_session_count|1", "all_active_web_session_count|2"),
    otherActiveOutput.replace(
      "other_active_operator_session_count|1",
      "other_active_operator_session_count|0",
    ),
    otherActiveOutput.replace("diagnostic_verdict|other-active-only", "diagnostic_verdict|email"),
    otherActiveOutput.replace(
      "subject_latest_session_state|revoked",
      "subject_latest_session_state|private",
    ),
    `${otherActiveOutput}private|value\n`,
  ]) {
    assert.equal(parseHostedPostReloginSessionDiagnosticOutput(invalid), null);
  }
});

test("plan is zero-I/O and accepts no identity, session, or token input", async () => {
  const calls = [];
  const result = await runCli({
    arguments_: ["--plan"],
    environment: { PGPASSWORD: "must-not-be-read" },
    fetchCaCertificate: async () => calls.push("ca"),
    readPassword: async () => calls.push("password"),
    runDiagnosticQuery: async () => calls.push("query"),
  });
  assert.deepEqual(calls, []);
  assert.deepEqual(result, {
    code: 0,
    stderr: "",
    stdout: renderHostedPostReloginSessionDiagnosticPlan(),
  });
  assert.match(result.stdout, /zero network \/ zero write/u);
  assert.match(result.stdout, /no email, UUID, Cookie, session token, or invitation token input/u);
});

test("query pins verify-full, timeout, and one repeatable-read read-only transaction", async () => {
  let observed;
  const diagnostic = await runHostedPostReloginSessionDiagnosticQuery(
    { administratorPassword: "fictional-administrator-password", caCertificate },
    {
      runPsql: async (options) => {
        observed = options;
        return { code: 0, stderr: "", stdout: otherActiveOutput };
      },
    },
  );
  assert.deepEqual(diagnostic, otherActiveDiagnostic);
  assert.match(observed.databaseUrl, /:6543\/postgres\?sslmode=verify-full$/u);
  assert.deepEqual(observed.environment, {
    HUAYI_HOSTED_DATABASE_CA_CERTIFICATE: caCertificate,
    PGPASSWORD: "fictional-administrator-password",
  });
  assert.equal(observed.captureOutput, true);
  assert.equal(observed.timeoutMilliseconds, 30_000);
  assert.equal(observed.input, renderHostedPostReloginSessionDiagnosticSql());
  assert.match(observed.input, /^BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;\n/u);
  assert.match(observed.input, /ROLLBACK;\n$/u);
});

test("CLI rejects caller identity, session material, and inherited passwords before I/O", async () => {
  for (const testCase of [
    { arguments_: [], environment: {} },
    { arguments_: [hostedPostReloginSessionDiagnosticArgument, "extra"], environment: {} },
    {
      arguments_: [hostedPostReloginSessionDiagnosticArgument],
      environment: { PGPASSWORD: "secret" },
    },
    {
      arguments_: [hostedPostReloginSessionDiagnosticArgument],
      environment: { SUPABASE_DB_PASSWORD: "secret" },
    },
  ]) {
    const calls = [];
    const privateFailure = async () => {
      calls.push("external");
      throw new Error("private-detail");
    };
    const result = await runCli({
      ...testCase,
      fetchCaCertificate: privateFailure,
      readPassword: privateFailure,
      runDiagnosticQuery: privateFailure,
    });
    assert.deepEqual(calls, []);
    assert.deepEqual(result, {
      code: 1,
      stderr: `${hostedPostReloginSessionDiagnosticFailureMessage}\n`,
      stdout: "",
    });
  }
});

test("CLI emits well-formed verdicts and hides private failures", async () => {
  assert.deepEqual(await runCli(), { code: 0, stderr: "", stdout: otherActiveOutput });

  const noActiveDiagnostic = {
    ...otherActiveDiagnostic,
    all_active_web_session_count: "0",
    other_active_web_session_count: "0",
    other_active_operator_session_count: "0",
    diagnostic_verdict: "no-active-session",
  };
  const noActiveOutput = renderHostedPostReloginSessionDiagnostic(noActiveDiagnostic);
  assert.deepEqual(await runCli({ runDiagnosticQuery: async () => noActiveDiagnostic }), {
    code: 0,
    stderr: "",
    stdout: noActiveOutput,
  });

  const driftDiagnostic = {
    ...otherActiveDiagnostic,
    session_owner_contract_exact: "f",
    diagnostic_verdict: "session-contract-drift",
  };
  const driftOutput = renderHostedPostReloginSessionDiagnostic(driftDiagnostic);
  assert.deepEqual(await runCli({ runDiagnosticQuery: async () => driftDiagnostic }), {
    code: 0,
    stderr: "",
    stdout: driftOutput,
  });

  for (const overrides of [
    { readPassword: async () => "short" },
    { fetchCaCertificate: async () => Promise.reject(new Error("private-ca")) },
    { runDiagnosticQuery: async () => Promise.reject(new Error("private-query")) },
    { runDiagnosticQuery: async () => null },
  ]) {
    const result = await runCli(overrides);
    assert.deepEqual(result, {
      code: 1,
      stderr: `${hostedPostReloginSessionDiagnosticFailureMessage}\n`,
      stdout: "",
    });
    assert.equal(JSON.stringify(result).includes("private-"), false);
  }
});
