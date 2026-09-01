import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  hostedPhase93RecoveryReadinessArgument,
  hostedPhase93RecoveryReadinessFailureMessage,
  hostedPhase93RecoveryReadinessFieldNames,
  parseHostedPhase93RecoveryReadinessOutput,
  renderHostedPhase93RecoveryReadinessPlan,
  renderHostedPhase93RecoveryReadinessSql,
  runHostedPhase93RecoveryReadinessCli,
  runHostedPhase93RecoveryReadinessQuery,
} from "./acceptance-hosted-phase-93-recovery-readiness.mjs";

const caCertificate =
  "-----BEGIN CERTIFICATE-----\n" + "a".repeat(64) + "\n-----END CERTIFICATE-----\n";

const exactReadiness = Object.freeze(
  Object.fromEntries([
    ...[
      "ordinary_invitation_unique",
      "invitation_contract_exact",
      "invitation_token_hash_valid",
      "invitation_claim_unique",
      "claim_contract_exact",
      "bound_user_claim_unique",
      "registration_flow_unique",
      "registration_flow_contract_exact",
      "auth_user_unique",
      "auth_email_contract_exact",
      "auth_email_unique",
      "auth_identity_unique_email",
      "previous_recovery_audit_absent",
      "user_profiles_absent",
      "account_sign_in_methods_absent",
      "password_recovery_flows_absent",
      "security_notification_outbox_absent",
      "web_sessions_absent",
      "account_data_export_jobs_absent",
      "account_deletion_jobs_absent",
      "extension_sessions_absent",
      "extension_pairings_absent",
      "admin_roles_absent",
      "subject_audit_events_absent",
      "study_captures_absent",
      "analysis_records_absent",
      "learning_items_absent",
      "word_entries_absent",
      "practice_sessions_absent",
      "quota_grants_absent",
      "quota_reservations_absent",
      "usage_ledger_absent",
      "model_rate_limit_events_absent",
      "mutation_preconditions_exact",
    ].map((name) => [name, "t"]),
    ["eligible_verdict", "eligible"],
  ]),
);

const exactOutput = `${Object.entries(exactReadiness)
  .map(([name, value]) => `${name}|${value}`)
  .join("\n")}\n`;

async function runCli(overrides = {}) {
  let stderr = "";
  let stdout = "";
  const code = await runHostedPhase93RecoveryReadinessCli({
    arguments_: [hostedPhase93RecoveryReadinessArgument],
    environment: {},
    fetchCaCertificate: async () => caCertificate,
    readPassword: async () => "fictional-administrator-password",
    runReadinessQuery: async () => exactReadiness,
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

test("package exposes fixed Phase 93 recovery plan and read-only diagnostic", async () => {
  const packageDocument = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  assert.equal(
    packageDocument.scripts["acceptance:hosted:phase93:recovery:plan"],
    "node scripts/acceptance-hosted-phase-93-recovery-readiness.mjs --plan",
  );
  assert.equal(
    packageDocument.scripts["acceptance:hosted:phase93:recovery:readiness"],
    `node scripts/acceptance-hosted-phase-93-recovery-readiness.mjs ${hostedPhase93RecoveryReadinessArgument}`,
  );
});

test("readiness fields are fixed, ordered, sanitized, and exact-only eligible", () => {
  assert.deepEqual(hostedPhase93RecoveryReadinessFieldNames, Object.keys(exactReadiness));
  assert.deepEqual(parseHostedPhase93RecoveryReadinessOutput(exactOutput), exactReadiness);
  for (const invalid of [
    exactOutput.trimEnd(),
    exactOutput.replace("claim_contract_exact|t", "claim_contract_exact|f"),
    exactOutput.replace("eligible_verdict|eligible", "eligible_verdict|person@example.com"),
    `${exactOutput}private|value\n`,
  ]) {
    assert.equal(parseHostedPhase93RecoveryReadinessOutput(invalid), null);
  }
});

test("readiness plan is zero-I/O and accepts no identity or token input", async () => {
  const calls = [];
  const result = await runCli({
    arguments_: ["--plan"],
    environment: { PGPASSWORD: "must-not-be-read" },
    fetchCaCertificate: async () => calls.push("ca"),
    readPassword: async () => calls.push("password"),
    runReadinessQuery: async () => calls.push("query"),
  });
  assert.deepEqual(calls, []);
  assert.deepEqual(result, {
    code: 0,
    stderr: "",
    stdout: renderHostedPhase93RecoveryReadinessPlan(),
  });
  assert.match(result.stdout, /zero network \/ zero write/u);
  assert.match(result.stdout, /no email, UUID, invitation ID, or token input/u);
});

test("readiness query pins verify-full, timeout, and one read-only transaction", async () => {
  let observed;
  const result = await runHostedPhase93RecoveryReadinessQuery(
    { administratorPassword: "fictional-administrator-password", caCertificate },
    {
      runPsql: async (options) => {
        observed = options;
        return { code: 0, stderr: "", stdout: exactOutput };
      },
    },
  );
  assert.deepEqual(result, exactReadiness);
  assert.match(observed.databaseUrl, /:6543\/postgres\?sslmode=verify-full$/u);
  assert.equal(observed.timeoutMilliseconds, 30_000);
  assert.equal(observed.input, renderHostedPhase93RecoveryReadinessSql());
  assert.match(observed.input, /^BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;\n/u);
  assert.match(observed.input, /ROLLBACK;\n$/u);
});

test("CLI rejects caller identity, token, and inherited passwords before external work", async () => {
  for (const testCase of [
    { arguments_: [], environment: {} },
    { arguments_: [hostedPhase93RecoveryReadinessArgument, "email@example.com"], environment: {} },
    { arguments_: [hostedPhase93RecoveryReadinessArgument], environment: { PGPASSWORD: "secret" } },
    {
      arguments_: [hostedPhase93RecoveryReadinessArgument],
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
      runReadinessQuery: privateFailure,
    });
    assert.deepEqual(calls, []);
    assert.deepEqual(result, {
      code: 1,
      stderr: `${hostedPhase93RecoveryReadinessFailureMessage}\n`,
      stdout: "",
    });
  }
});

test("CLI emits only allowlisted rows and hides every private failure", async () => {
  const success = await runCli();
  assert.deepEqual(success, { code: 0, stderr: "", stdout: exactOutput });
  for (const overrides of [
    { readPassword: async () => "short" },
    { fetchCaCertificate: async () => Promise.reject(new Error("private-ca")) },
    { runReadinessQuery: async () => Promise.reject(new Error("private-query")) },
    { runReadinessQuery: async () => null },
  ]) {
    assert.deepEqual(await runCli(overrides), {
      code: 1,
      stderr: `${hostedPhase93RecoveryReadinessFailureMessage}\n`,
      stdout: "",
    });
  }
});
