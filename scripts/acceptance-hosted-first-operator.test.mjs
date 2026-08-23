import assert from "node:assert/strict";
import test from "node:test";

import {
  firstOperatorCompleteConfirmation,
  firstOperatorInviteConfirmation,
  firstOperatorReplaceConfirmation,
  firstOperatorStatusArgument,
  firstOperatorVerifyArgument,
  hostedFirstOperatorInvitationUrl,
  renderFirstOperatorStatusSql,
  renderFirstOperatorVerificationSql,
  runHostedFirstOperator,
} from "./acceptance-hosted-first-operator.mjs";

const certificate = `-----BEGIN CERTIFICATE-----
${"A".repeat(80)}
-----END CERTIFICATE-----`;
const environment = {
  HUAYI_HOSTED_DATABASE_CA_CERTIFICATE: certificate,
  HUAYI_SECRET_PEPPER: "p".repeat(48),
  PGPASSWORD: "administrator-password",
};

test("first Operator plan is side-effect free", async () => {
  let calls = 0;
  const result = await runHostedFirstOperator({
    arguments_: ["--plan"],
    runPsql: async () => {
      calls += 1;
      return { code: 0, stderr: "", stdout: "" };
    },
  });

  assert.deepEqual(result, { outcome: "planned" });
  assert.equal(calls, 0);
});

test("first Operator status is read-only and returns only a bounded state", async () => {
  const calls = [];
  const result = await runHostedFirstOperator({
    arguments_: ["status", firstOperatorStatusArgument],
    environment,
    runPsql: async (call) => {
      calls.push(call);
      return { code: 0, stderr: "", stdout: "registered\n" };
    },
  });

  assert.deepEqual(result, { outcome: "status", status: "registered" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].captureOutput, true);
  assert.match(calls[0].input, /first_operator_bootstrap/u);
  assert.doesNotMatch(calls[0].input, /token_hash|operator_user_id::text/u);
});

test("first Operator status distinguishes the recoverable interrupted registration", () => {
  const sql = renderFirstOperatorStatusSql();
  const interruptedEnd = sql.indexOf("THEN 'registration-interrupted'");
  const interruptedStart = sql.lastIndexOf("WHEN ", interruptedEnd);
  const interruptedBranch = sql.slice(interruptedStart, interruptedEnd);
  assert.match(sql, /THEN 'registration-interrupted'/u);
  assert.match(interruptedBranch, /claim\.bound_user_id IS NOT NULL/u);
  assert.match(interruptedBranch, /claim\.finalized_user_id IS NULL/u);
  assert.match(interruptedBranch, /identity\.provider = 'email'/u);
  assert.match(interruptedBranch, /auth_flow\.expires_at <= now\(\)/u);
  assert.match(interruptedBranch, /bootstrap\.current_invitation_id = invitation\.id/u);
  assert.match(interruptedBranch, /invitation\.created_by_kind = 'deployment-bootstrap'/u);
  assert.match(interruptedBranch, /invitation\.created_by IS NULL/u);
  assert.match(interruptedBranch, /invitation\.expires_at > now\(\)/u);
  assert.match(interruptedBranch, /invitation\.consumed_at IS NULL/u);
  assert.match(interruptedBranch, /invitation\.revoked_at IS NULL/u);
});

test("completed first Operator verification checks the bound account without exposing identity", async () => {
  const sql = renderFirstOperatorVerificationSql();
  assert.match(sql, /BEGIN READ ONLY/u);
  assert.match(sql, /state = 'completed'/u);
  assert.match(sql, /current_invitation_id/u);
  assert.match(sql, /bound_user_id = bootstrap\.operator_user_id/u);
  assert.match(sql, /source = 'default'/u);
  assert.match(sql, /limit_micro_usd = 1000000/u);
  assert.match(sql, /method = 'password'/u);
  assert.match(sql, /email_confirmed_at IS NOT NULL/u);
  assert.match(sql, /access_scope = 'full'/u);
  assert.match(sql, /reauthenticated_method IS NULL/u);
  assert.match(sql, /kind = 'invite-registration'/u);
  assert.match(sql, /name = 'model_kill_switch' AND runtime_control\.enabled/u);
  assert.match(sql, /model_rate_limit_events/u);
  assert.match(sql, /role = 'operator'/u);
  assert.doesNotMatch(sql, /SELECT\s+email|operator_user_id::text|finalized_user_id::text/iu);

  const calls = [];
  const result = await runHostedFirstOperator({
    arguments_: ["verify", firstOperatorVerifyArgument],
    environment,
    runPsql: async (call) => {
      calls.push(call);
      return { code: 0, stderr: "", stdout: "t\n" };
    },
  });
  assert.deepEqual(result, { outcome: "verified" });
  assert.equal(calls[0].captureOutput, true);
});

test("completed first Operator verification fails closed on any non-true result", async () => {
  for (const result of [
    { code: 0, stderr: "", stdout: "f\n" },
    { code: 0, stderr: "", stdout: "t\nunexpected\n" },
    { code: 1, stderr: "private database error", stdout: "t\n" },
  ]) {
    await assert.rejects(
      runHostedFirstOperator({
        arguments_: ["verify", firstOperatorVerifyArgument],
        environment,
        runPsql: async () => result,
      }),
      /verification failed/u,
    );
  }
});

test("first Operator invite stores only a keyed hash and returns the fragment URL once", async () => {
  const calls = [];
  const result = await runHostedFirstOperator({
    arguments_: ["invite", firstOperatorInviteConfirmation],
    environment,
    now: () => new Date("2026-08-22T08:00:00.000Z"),
    randomBytes_: () => Buffer.alloc(32, 7),
    randomUuid: () => "41000000-0000-4000-8000-000000000001",
    runPsql: async (call) => {
      calls.push(call);
      return { code: 0, stderr: "", stdout: "" };
    },
  });

  assert.equal(result.outcome, "invited");
  const token = result.invitationUrl.split("#")[1];
  assert.equal(result.invitationUrl, hostedFirstOperatorInvitationUrl(token));
  assert.equal(calls.length, 1);
  assert.match(calls[0].input, /issue_first_operator_invitation/u);
  assert.doesNotMatch(calls[0].input, new RegExp(token, "u"));
  assert.doesNotMatch(JSON.stringify(calls[0].environment), /pppppppp/u);
});

test("replacement and completion use separate exact confirmations without a candidate id", async () => {
  const calls = [];
  await runHostedFirstOperator({
    arguments_: ["replace", firstOperatorReplaceConfirmation],
    environment,
    now: () => new Date("2026-08-22T09:00:00.000Z"),
    randomBytes_: () => Buffer.alloc(32, 8),
    randomUuid: () => "41000000-0000-4000-8000-000000000002",
    runPsql: async (call) => {
      calls.push(call);
      return { code: 0, stderr: "", stdout: "" };
    },
  });
  const completed = await runHostedFirstOperator({
    arguments_: ["complete", firstOperatorCompleteConfirmation],
    environment,
    now: () => new Date("2026-08-22T10:00:00.000Z"),
    runPsql: async (call) => {
      calls.push(call);
      return { code: 0, stderr: "", stdout: "" };
    },
  });

  assert.match(calls[0].input, /replace_first_operator_invitation/u);
  assert.match(calls[1].input, /complete_first_operator_bootstrap/u);
  assert.doesNotMatch(calls[1].input, /user_id|email|admin_roles/u);
  assert.deepEqual(completed, { outcome: "completed" });
});

test("first Operator writes fail before database access when confirmation or pepper is invalid", async () => {
  let calls = 0;
  const runPsql = async () => {
    calls += 1;
    return { code: 0, stderr: "", stdout: "" };
  };

  await assert.rejects(
    runHostedFirstOperator({ arguments_: ["invite", "--wrong"], environment, runPsql }),
    /arguments are invalid/u,
  );
  await assert.rejects(
    runHostedFirstOperator({
      arguments_: ["invite", firstOperatorInviteConfirmation],
      environment: { ...environment, HUAYI_SECRET_PEPPER: "short" },
      runPsql,
    }),
    /pepper is unavailable/u,
  );
  assert.equal(calls, 0);
});
