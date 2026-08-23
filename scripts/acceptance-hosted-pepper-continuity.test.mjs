import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  pepperContinuityVerificationArgument,
  renderPepperContinuitySql,
  runPepperContinuityVerification,
} from "./acceptance-hosted-pepper-continuity.mjs";

const certificate = `-----BEGIN CERTIFICATE-----
${"A".repeat(80)}
-----END CERTIFICATE-----`;
const environment = {
  HUAYI_BOOTSTRAP_INVITATION_TOKEN: "A".repeat(43),
  HUAYI_HOSTED_DATABASE_CA_CERTIFICATE: certificate,
  HUAYI_SECRET_PEPPER: "p".repeat(48),
  PGPASSWORD: "administrator-password",
};

test("pepper continuity verifies only the live interrupted Bootstrap invitation", async () => {
  const expectedHash = createHash("sha256")
    .update(environment.HUAYI_SECRET_PEPPER)
    .update("\0")
    .update(environment.HUAYI_BOOTSTRAP_INVITATION_TOKEN)
    .digest("base64url");
  const calls = [];
  const result = await runPepperContinuityVerification({
    arguments_: [pepperContinuityVerificationArgument],
    environment,
    runPsql: async (call) => {
      calls.push(call);
      return { code: 0, stderr: "", stdout: "t\n" };
    },
  });

  assert.deepEqual(result, { outcome: "verified" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].captureOutput, true);
  assert.match(calls[0].databaseUrl, /postgres\.kpadiulxkgckskcfydry@/u);
  assert.match(calls[0].input, /BEGIN READ ONLY/u);
  assert.match(calls[0].input, /registration-interrupted/u);
  assert.match(calls[0].input, /bootstrap\.current_invitation_id = invitation\.id/u);
  assert.match(calls[0].input, /invitation\.created_by_kind = 'deployment-bootstrap'/u);
  assert.match(calls[0].input, /invitation\.expires_at > now\(\)/u);
  assert.match(calls[0].input, new RegExp(expectedHash, "u"));
  assert.doesNotMatch(
    calls[0].input,
    new RegExp(environment.HUAYI_BOOTSTRAP_INVITATION_TOKEN, "u"),
  );
  assert.doesNotMatch(calls[0].input, new RegExp(environment.HUAYI_SECRET_PEPPER, "u"));
  assert.equal("HUAYI_BOOTSTRAP_INVITATION_TOKEN" in calls[0].environment, false);
  assert.equal("HUAYI_SECRET_PEPPER" in calls[0].environment, false);
});

test("pepper continuity fails closed without leaking a mismatched secret", async () => {
  const sql = renderPepperContinuitySql("bounded-hash-value");
  assert.match(sql, /token_hash = 'bounded-hash-value'/u);
  assert.doesNotMatch(sql, /SELECT\s+token_hash|token_hash::text/iu);

  for (const databaseResult of [
    { code: 0, stderr: "", stdout: "f\n" },
    { code: 0, stderr: "", stdout: "t\nunexpected\n" },
    { code: 1, stderr: "private database error", stdout: "t\n" },
  ]) {
    await assert.rejects(
      runPepperContinuityVerification({
        arguments_: [pepperContinuityVerificationArgument],
        environment,
        runPsql: async () => databaseResult,
      }),
      /pepper continuity verification failed/u,
    );
  }

  let calls = 0;
  await assert.rejects(
    runPepperContinuityVerification({
      arguments_: ["--wrong-project"],
      environment,
      runPsql: async () => {
        calls += 1;
        return { code: 0, stderr: "", stdout: "t\n" };
      },
    }),
    /arguments are invalid/u,
  );
  await assert.rejects(
    runPepperContinuityVerification({
      arguments_: [pepperContinuityVerificationArgument],
      environment: { ...environment, HUAYI_BOOTSTRAP_INVITATION_TOKEN: "short" },
      runPsql: async () => {
        calls += 1;
        return { code: 0, stderr: "", stdout: "t\n" };
      },
    }),
    /invitation token is unavailable/u,
  );
  assert.equal(calls, 0);
});
