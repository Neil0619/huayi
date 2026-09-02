import assert from "node:assert/strict";
import test from "node:test";

import {
  hostedPasswordRecoveryBootstrapSnapshotFields,
  renderHostedPasswordRecoveryBootstrapSnapshotSql,
  runHostedPasswordRecoveryBootstrapSnapshotQuery,
} from "./acceptance-hosted-password-recovery-bootstrap-state.mjs";
import { hostedAcceptancePoolerUrl } from "./acceptance-hosted-foundation.mjs";

const administratorPassword = "administrator-password";
const caCertificate = `-----BEGIN CERTIFICATE-----
${"A".repeat(80)}
-----END CERTIFICATE-----`;

function validOutput(overrides = {}) {
  const values = {
    password_recovery_ambiguous: "0",
    password_recovery_claimable: "1",
    password_recovery_open_total: "1",
    password_recovery_sent: "0",
    ...overrides,
  };
  return (
    hostedPasswordRecoveryBootstrapSnapshotFields
      .map((name) => `${name}|${values[name]}`)
      .join("\n") + "\n"
  );
}

test("password-recovery bootstrap SQL is read-only and emits only fixed aggregates", () => {
  const sql = renderHostedPasswordRecoveryBootstrapSnapshotSql();

  assert.match(sql, /^BEGIN READ ONLY;/u);
  assert.match(sql, /ROLLBACK;\s*$/u);
  assert.match(sql, /FROM public\.password_recovery_flows/u);
  assert.match(sql, /profiles\.status='active'/u);
  assert.match(sql, /methods\.method='password'/u);
  for (const field of hostedPasswordRecoveryBootstrapSnapshotFields) {
    assert.match(sql, new RegExp(`'${field}'`, "u"));
  }
  for (const forbidden of [
    /(?:^|\n)\s*(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|GRANT|REVOKE)\b/iu,
    /callback_flow_ciphertext/iu,
    /provider_state_ciphertext/iu,
    /recovery_session_hash/iu,
    /csrf_hash/iu,
    /\bemail\b/iu,
    /SELECT\s+(?:flows\.)?(?:flow_hash|owner_user_id)\b/iu,
  ]) {
    assert.doesNotMatch(sql, forbidden);
  }
});

test("password-recovery bootstrap snapshot uses one bounded verify-full admin read", async () => {
  let observed;
  const snapshot = await runHostedPasswordRecoveryBootstrapSnapshotQuery(
    { administratorPassword, caCertificate },
    {
      runPsql: async (request) => {
        observed = request;
        return { code: 0, stderr: "", stdout: validOutput() };
      },
    },
  );

  assert.deepEqual(snapshot, {
    password_recovery_ambiguous: "0",
    password_recovery_claimable: "1",
    password_recovery_open_total: "1",
    password_recovery_sent: "0",
  });
  assert.equal(observed.captureOutput, true);
  assert.equal(observed.databaseUrl, hostedAcceptancePoolerUrl);
  assert.equal(observed.password, administratorPassword);
  assert.equal(observed.environment.HUAYI_HOSTED_DATABASE_CA_CERTIFICATE, caCertificate);
  assert.equal(observed.timeoutMilliseconds, 30_000);
});

test("password-recovery bootstrap snapshot rejects malformed output without reflection", async () => {
  for (const stdout of [
    "",
    validOutput().replace("claimable|1", "claimable|-1"),
    validOutput().replace("sent|0", "sent|0\nprivate|value"),
    validOutput().replace(/\n$/u, ""),
    `${"x".repeat(1_025)}\n`,
  ]) {
    const snapshot = await runHostedPasswordRecoveryBootstrapSnapshotQuery(
      { administratorPassword, caCertificate },
      { runPsql: async () => ({ code: 0, stderr: "private", stdout }) },
    );
    assert.equal(snapshot, null);
  }

  const failed = await runHostedPasswordRecoveryBootstrapSnapshotQuery(
    { administratorPassword, caCertificate },
    { runPsql: async () => ({ code: 1, stderr: "private", stdout: validOutput() }) },
  );
  assert.equal(failed, null);
});
