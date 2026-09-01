import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  hostedIdentitySnapshotArgument,
  hostedIdentitySnapshotFailureMessage,
  hostedIdentitySnapshotFieldNames,
  parseHostedIdentitySnapshotOutput,
  renderHostedIdentitySnapshot,
  renderHostedIdentitySnapshotPlan,
  renderHostedIdentitySnapshotSql,
  runHostedIdentitySnapshotCli,
  runHostedIdentitySnapshotQuery,
} from "./acceptance-hosted-identity-snapshot.mjs";

const caCertificate =
  "-----BEGIN CERTIFICATE-----\n" + "a".repeat(64) + "\n-----END CERTIFICATE-----\n";

const validSnapshot = Object.freeze({
  ordinary_invitations_total: "2",
  ordinary_available_count: "1",
  ordinary_expired_count: "1",
  ordinary_consumed_count: "0",
  ordinary_revoked_count: "0",
  ordinary_invalid_count: "0",
  latest_invitation_state: "available",
  latest_claim_count: "1",
  latest_claim_state: "bound-active",
  latest_registration_flow_count: "1",
  latest_registration_flow_state: "active",
  subject_auth_user_state: "unconfirmed",
  subject_email_binding_exact: "t",
  subject_auth_identity_count: "1",
  subject_email_identity_exact: "t",
  subject_profile_state: "none",
  subject_password_method_count: "0",
  subject_google_method_count: "0",
  subject_current_quota_count: "0",
  subject_active_web_session_count: "0",
  subject_active_extension_session_count: "0",
  subject_learning_item_count: "0",
  subject_analysis_record_count: "0",
  subject_practice_session_count: "0",
  subject_registration_blocker_count: "0",
  subject_learning_data_present: "f",
  otp_resend_eligible: "t",
  interrupted_resume_eligible: "f",
  account_finalized_exact: "f",
  safe_route_state: "otp-resend",
});

const validOutput = `${Object.entries(validSnapshot)
  .map(([name, value]) => `${name}|${value}`)
  .join("\n")}\n`;

async function runCli(overrides = {}) {
  let stderr = "";
  let stdout = "";
  const code = await runHostedIdentitySnapshotCli({
    arguments_: [hostedIdentitySnapshotArgument],
    environment: {},
    fetchCaCertificate: async () => caCertificate,
    readPassword: async () => "fictional-administrator-password",
    runSnapshotQuery: async () => validSnapshot,
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

test("package exposes fixed identity snapshot plan and read-only entrypoints", async () => {
  const packageDocument = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  assert.equal(
    packageDocument.scripts["acceptance:hosted:identity:plan"],
    "node scripts/acceptance-hosted-identity-snapshot.mjs --plan",
  );
  assert.equal(
    packageDocument.scripts["acceptance:hosted:identity:snapshot"],
    `node scripts/acceptance-hosted-identity-snapshot.mjs ${hostedIdentitySnapshotArgument}`,
  );
  assert.equal(
    hostedIdentitySnapshotArgument,
    "--snapshot-hosted-invitation-auth-account-kpadiulxkgckskcfydry",
  );
});

test("identity snapshot field contract is fixed, ordered, and sanitized", () => {
  assert.deepEqual(hostedIdentitySnapshotFieldNames, Object.keys(validSnapshot));
  assert.equal(parseHostedIdentitySnapshotOutput(validOutput)?.safe_route_state, "otp-resend");
  assert.equal(renderHostedIdentitySnapshot(validSnapshot), validOutput);

  const invalidOutputs = [
    "",
    validOutput.trimEnd(),
    validOutput.replace("safe_route_state|otp-resend", "safe_route_state|private-route"),
    validOutput.replace("latest_claim_count|1", "latest_claim_count|-1"),
    validOutput.replace("latest_claim_count|1", "latest_claim_count|9223372036854775808"),
    validOutput.replace("subject_email_binding_exact|t", "subject_email_binding_exact|yes"),
    validOutput.replace(
      "subject_auth_user_state|unconfirmed",
      "subject_auth_user_state|person@example.com",
    ),
    `${validOutput}extra|value\n`,
  ];
  for (const output of invalidOutputs) {
    assert.equal(parseHostedIdentitySnapshotOutput(output), null);
  }
});

test("identity snapshot plan performs zero external work", async () => {
  const calls = [];
  const result = await runCli({
    arguments_: ["--plan"],
    environment: { PGPASSWORD: "must-not-be-read" },
    fetchCaCertificate: async () => calls.push("ca"),
    readPassword: async () => calls.push("password"),
    runSnapshotQuery: async () => calls.push("query"),
  });
  assert.deepEqual(calls, []);
  assert.deepEqual(result, { code: 0, stderr: "", stdout: renderHostedIdentitySnapshotPlan() });
  assert.match(result.stdout, /zero network \/ zero write/u);
  assert.match(result.stdout, /fixed status, boolean, and count fields/u);
});

test("identity snapshot query pins pooler, verify-full CA, timeout, and read-only SQL", async () => {
  let observed;
  const snapshot = await runHostedIdentitySnapshotQuery(
    { administratorPassword: "fictional-administrator-password", caCertificate },
    {
      runPsql: async (options) => {
        observed = options;
        return { code: 0, stderr: "", stdout: validOutput };
      },
    },
  );
  assert.equal(snapshot?.safe_route_state, "otp-resend");
  assert.match(observed.databaseUrl, /:6543\/postgres\?sslmode=verify-full$/u);
  assert.deepEqual(observed.environment, {
    HUAYI_HOSTED_DATABASE_CA_CERTIFICATE: caCertificate,
  });
  assert.equal(observed.password, "fictional-administrator-password");
  assert.equal(observed.captureOutput, true);
  assert.equal(observed.timeoutMilliseconds, 30_000);
  assert.equal(observed.input, renderHostedIdentitySnapshotSql());
});

test("identity snapshot fetches CA before Keychain read and emits only sanitized rows", async () => {
  const calls = [];
  const result = await runCli({
    fetchCaCertificate: async () => {
      calls.push("ca");
      return caCertificate;
    },
    readPassword: async () => {
      calls.push("password");
      return "fictional-administrator-password";
    },
    runSnapshotQuery: async ({ administratorPassword, caCertificate: observedCa }) => {
      calls.push("query");
      assert.equal(administratorPassword, "fictional-administrator-password");
      assert.equal(observedCa, caCertificate);
      return validSnapshot;
    },
  });
  assert.deepEqual(calls, ["ca", "password", "query"]);
  assert.deepEqual(result, { code: 0, stderr: "", stdout: validOutput });
});

test("identity snapshot rejects arguments and inherited passwords before external work", async () => {
  for (const testCase of [
    { arguments_: [], environment: {} },
    { arguments_: [hostedIdentitySnapshotArgument, "extra"], environment: {} },
    { arguments_: [hostedIdentitySnapshotArgument], environment: { PGPASSWORD: "secret" } },
    {
      arguments_: [hostedIdentitySnapshotArgument],
      environment: { SUPABASE_DB_PASSWORD: "secret" },
    },
    {
      arguments_: [hostedIdentitySnapshotArgument],
      environment: { SUPABASE_ACCESS_TOKEN: "secret" },
    },
    {
      arguments_: [hostedIdentitySnapshotArgument],
      environment: { VERCEL_TOKEN: "secret" },
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
      runSnapshotQuery: privateFailure,
    });
    assert.deepEqual(calls, []);
    assert.deepEqual(result, {
      code: 1,
      stderr: `${hostedIdentitySnapshotFailureMessage}\n`,
      stdout: "",
    });
  }
});

test("identity snapshot hides invalid passwords, query failures, and private diagnostics", async () => {
  for (const overrides of [
    { readPassword: async () => "short" },
    { fetchCaCertificate: async () => Promise.reject(new Error("private-ca")) },
    { readPassword: async () => Promise.reject(new Error("private-password")) },
    { runSnapshotQuery: async () => Promise.reject(new Error("private-query")) },
    { runSnapshotQuery: async () => null },
  ]) {
    const result = await runCli(overrides);
    assert.deepEqual(result, {
      code: 1,
      stderr: `${hostedIdentitySnapshotFailureMessage}\n`,
      stdout: "",
    });
    assert.equal(JSON.stringify(result).includes("private-"), false);
  }
});
