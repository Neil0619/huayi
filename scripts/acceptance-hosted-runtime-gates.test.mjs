import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  hostedRuntimeGatesSnapshotArgument,
  hostedRuntimeSnapshotFieldNames,
  readHostedRuntimeSnapshot,
  renderHostedRuntimeGatesPlan,
  renderHostedRuntimeSnapshot,
  renderHostedRuntimeSnapshotSql,
  runHostedRuntimeGatesCli,
  runHostedRuntimeSnapshotQuery,
} from "./acceptance-hosted-runtime-gates.mjs";
import {
  hostedAcceptancePoolerUrl,
  hostedAcceptancePriceVersionIds,
} from "./acceptance-hosted-foundation.mjs";

const postgresPassword = "fictional-postgres-password";
const rootCertificate =
  "-----BEGIN CERTIFICATE-----\n" + "a".repeat(64) + "\n-----END CERTIFICATE-----\n";

function validSnapshotValues() {
  return {
    cron_acl_exact: "t",
    cron_extensions_exact: "t",
    cron_function_contract_exact: "t",
    cron_jobs_exact: "t",
    cron_vault_names_exact: "t",
    deepseek_analysis_records_total: "1",
    deepseek_analysis_requests_completed: "1",
    deepseek_analysis_requests_failed: "0",
    deepseek_analysis_requests_running: "0",
    deepseek_analysis_requests_total: "1",
    deepseek_analysis_usage_rows_total: "1",
    deepseek_latest_dispatched: "t",
    deepseek_latest_ledger_outcome: "succeeded",
    deepseek_latest_ledger_rows: "1",
    deepseek_latest_model_metadata_reconciled: "t",
    deepseek_latest_present: "t",
    deepseek_latest_price_contract: "t",
    deepseek_latest_price_slot: "off_peak",
    deepseek_latest_reconciled: "t",
    deepseek_latest_reservation_status: "settled",
    deepseek_latest_state: "completed",
    r3c_claimable: "0",
    r3c_contract_exact: "t",
    r3c_dead_letter: "0",
    r3c_failed: "0",
    r3c_max_attempts: "1",
    r3c_overdue_nonterminal: "0",
    r3c_pending: "0",
    r3c_sending: "0",
    r3c_sent: "1",
    r3c_total: "1",
  };
}

function validSnapshotOutput() {
  const values = validSnapshotValues();
  return hostedRuntimeSnapshotFieldNames.map((name) => `${name}|${values[name]}`).join("\n") + "\n";
}

test("hosted runtime gates plan is fixed, secret-free, and performs no database call", async () => {
  let calls = 0;
  let stdout = "";
  let stderr = "";
  const code = await runHostedRuntimeGatesCli({
    arguments_: ["--plan"],
    environment: {
      PGPASSWORD: "must-not-appear",
    },
    runPsql: async () => {
      calls += 1;
      return { code: 0, stdout: "" };
    },
    writeError: (value) => {
      stderr += value;
    },
    writeOutput: (value) => {
      stdout += value;
    },
  });

  assert.equal(code, 0);
  assert.equal(calls, 0);
  assert.equal(stderr, "");
  assert.equal(stdout, renderHostedRuntimeGatesPlan());
  assert.match(stdout, /zero network \/ zero write/u);
  assert.match(stdout, /latest hosted analysis request automatically/u);
  assert.doesNotMatch(stdout, /must-not-appear|password|email|owner|source text|result body/iu);
});

test("package scripts expose the fixed plan and project-pinned snapshot interfaces", async () => {
  const packageDocument = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  assert.equal(
    packageDocument.scripts["acceptance:hosted:runtime:plan"],
    "node scripts/acceptance-hosted-runtime-gates.mjs --plan",
  );
  assert.equal(
    packageDocument.scripts["acceptance:hosted:runtime:snapshot"],
    `node scripts/acceptance-hosted-runtime-gates.mjs ${hostedRuntimeGatesSnapshotArgument}`,
  );
});

test("hosted runtime snapshot SQL is read-only and emits only fixed safe aggregates", () => {
  const sql = renderHostedRuntimeSnapshotSql();

  assert.match(sql, /^BEGIN READ ONLY;/u);
  assert.match(sql, /ROLLBACK;\s*$/u);
  assert.match(sql, /FROM public\.security_notification_outbox/u);
  assert.match(sql, /FROM vault\.secrets/u);
  assert.doesNotMatch(sql, /vault\.decrypted_secrets/u);
  assert.match(sql, /FROM cron\.job/u);
  assert.match(sql, /huayi_private\.invoke_cron_path/u);
  assert.match(sql, /FROM public\.analysis_requests/u);
  assert.match(sql, /(?:FROM|JOIN) public\.quota_reservations/u);
  assert.match(sql, /(?:FROM|JOIN) public\.usage_ledger/u);
  assert.match(sql, /(?:FROM|JOIN) public\.analysis_records/u);
  assert.match(sql, new RegExp(hostedAcceptancePriceVersionIds.legacy, "u"));
  assert.match(sql, new RegExp(hostedAcceptancePriceVersionIds.offPeak, "u"));
  assert.match(sql, new RegExp(hostedAcceptancePriceVersionIds.peak, "u"));
  assert.match(sql, /deepseek-v4-flash/u);
  assert.match(sql, /web-deep-analysis-v2/u);
  assert.match(sql, /model_metadata->'schemaVersion'='2'::jsonb/u);
  assert.match(sql, /count\(\*\) BETWEEN 1 AND 2 AS contract_exact/u);
  assert.match(sql, /lanname='plpgsql'/u);
  assert.match(sql, /2026-08-16T15:59:59Z/u);
  assert.match(sql, /2026-08-16T16:00:00Z/u);
  assert.match(sql, /2026-08-16T16:00:01Z/u);
  assert.match(sql, /acl\.grantee=functions\.proowner/u);
  assert.match(sql, /count\(\*\)=1 FROM pg_namespace WHERE nspname='huayi_private'/u);
  assert.match(sql, /\\if :cron_catalog_ready/u);
  assert.match(sql, /\\if :vault_catalog_ready/u);
  assert.doesNotMatch(sql, /(?:contract_exact|reconciled|EXISTS\([^)]*\))::text/iu);
  assert.match(sql, /CASE WHEN contract_exact THEN 't' ELSE 'f' END/iu);
  for (const name of hostedRuntimeSnapshotFieldNames) {
    assert.match(sql, new RegExp(`'${name}'`, "u"));
  }
  for (const forbidden of [
    /(?:^|\n)\s*(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|GRANT|REVOKE)\b/iu,
    /decrypted_secret/iu,
    /user_profiles/iu,
    /auth\.users/iu,
    /owner_user_id/iu,
    /\bemail\b/iu,
    /source_text/iu,
    /source_context/iu,
    /\bresult\b/iu,
  ]) {
    assert.doesNotMatch(sql, forbidden);
  }
});

test("hosted runtime snapshot uses one verify-full admin read and normalizes bounded output", async () => {
  const calls = [];
  const snapshot = await readHostedRuntimeSnapshot({
    arguments_: [hostedRuntimeGatesSnapshotArgument],
    environment: {},
    fetchCaCertificate: async () => {
      calls.push("ca");
      return rootCertificate;
    },
    readPassword: async () => {
      calls.push("password");
      return postgresPassword;
    },
    runPsql: async (request) => {
      calls.push(request);
      return { code: 0, stdout: validSnapshotOutput() };
    },
  });

  assert.equal(calls.length, 3);
  assert.deepEqual(calls.slice(0, 2), ["ca", "password"]);
  assert.equal(calls[2].captureOutput, true);
  assert.equal(calls[2].databaseUrl, hostedAcceptancePoolerUrl);
  assert.equal(calls[2].environment.PGPASSWORD, undefined);
  assert.equal(calls[2].password, postgresPassword);
  assert.equal(calls[2].environment.HUAYI_HOSTED_DATABASE_CA_CERTIFICATE, rootCertificate);
  assert.equal(calls[2].timeoutMilliseconds, 30_000);
  assert.equal(renderHostedRuntimeSnapshot(snapshot), validSnapshotOutput());
});

test("hosted runtime query always pins a finite timeout", async () => {
  let observed;
  await runHostedRuntimeSnapshotQuery(
    { administratorPassword: postgresPassword, caCertificate: rootCertificate },
    {
      runPsql: async (request) => {
        observed = request;
        return { code: 0, stdout: validSnapshotOutput() };
      },
    },
  );
  assert.equal(observed.timeoutMilliseconds, 30_000);
});

test("hosted runtime rejects arguments and inherited passwords before external work", async () => {
  for (const testCase of [
    { arguments_: [], environment: {} },
    { arguments_: [hostedRuntimeGatesSnapshotArgument, "extra"], environment: {} },
    { arguments_: [hostedRuntimeGatesSnapshotArgument], environment: { PGPASSWORD: "secret" } },
    {
      arguments_: [hostedRuntimeGatesSnapshotArgument],
      environment: { SUPABASE_DB_PASSWORD: "secret" },
    },
  ]) {
    const calls = [];
    const external = async () => {
      calls.push("external");
      throw new Error("private-detail");
    };
    let stderr = "";
    let stdout = "";
    const code = await runHostedRuntimeGatesCli({
      ...testCase,
      fetchCaCertificate: external,
      readPassword: external,
      runPsql: external,
      writeError: (value) => {
        stderr += value;
      },
      writeOutput: (value) => {
        stdout += value;
      },
    });
    assert.deepEqual(calls, []);
    assert.deepEqual(
      { code, stderr, stdout },
      {
        code: 1,
        stderr: "Hosted runtime snapshot failed.\n",
        stdout: "",
      },
    );
  }
});

test("hosted runtime validates hidden password bytes and reflects no private failure", async () => {
  for (const password of [
    "short",
    "a".repeat(513),
    "valid-prefix\0suffix",
    "valid-prefix\rsuffix",
    "valid-prefix\nsuffix",
  ]) {
    let databaseCalls = 0;
    let stderr = "";
    const code = await runHostedRuntimeGatesCli({
      arguments_: [hostedRuntimeGatesSnapshotArgument],
      environment: {},
      fetchCaCertificate: async () => rootCertificate,
      readPassword: async () => password,
      runPsql: async () => {
        databaseCalls += 1;
        throw new Error("private-database-detail");
      },
      writeError: (value) => {
        stderr += value;
      },
      writeOutput: () => undefined,
    });
    assert.equal(code, 1);
    assert.equal(databaseCalls, 0);
    assert.equal(stderr, "Hosted runtime snapshot failed.\n");
    assert.doesNotMatch(stderr, /private|valid-prefix/u);
  }
});

test("hosted runtime snapshot rejects malformed or unexpected database output without reflection", async () => {
  const secret = "private@example.test";
  const run = (stdout) =>
    readHostedRuntimeSnapshot({
      arguments_: [hostedRuntimeGatesSnapshotArgument],
      environment: {},
      fetchCaCertificate: async () => rootCertificate,
      readPassword: async () => postgresPassword,
      runPsql: async () => ({ code: 0, stdout }),
    });

  await assert.rejects(run(validSnapshotOutput().replace("r3c_total|1", `r3c_total|${secret}`)), {
    message: "Hosted runtime snapshot failed.",
  });
  await assert.rejects(run(`${validSnapshotOutput()}unexpected|${secret}\n`), {
    message: "Hosted runtime snapshot failed.",
  });
  await assert.rejects(
    run(
      validSnapshotOutput().replace(
        "deepseek_latest_state|completed",
        "deepseek_latest_state|unknown",
      ),
    ),
    { message: "Hosted runtime snapshot failed." },
  );
  await assert.rejects(
    run(validSnapshotOutput().replace("r3c_total|1", "r3c_total|9223372036854775808")),
    { message: "Hosted runtime snapshot failed." },
  );
  await assert.rejects(
    readHostedRuntimeSnapshot({
      arguments_: [hostedRuntimeGatesSnapshotArgument],
      environment: {},
      fetchCaCertificate: async () => rootCertificate,
      readPassword: async () => postgresPassword,
      runPsql: async () => ({ code: 1, stdout: secret }),
    }),
    { message: "Hosted runtime snapshot failed." },
  );

  let stdout = "";
  let stderr = "";
  const code = await runHostedRuntimeGatesCli({
    arguments_: [hostedRuntimeGatesSnapshotArgument],
    environment: {},
    fetchCaCertificate: async () => rootCertificate,
    readPassword: async () => postgresPassword,
    runPsql: async () => ({ code: 0, stdout: `${secret}\n` }),
    writeError: (value) => {
      stderr += value;
    },
    writeOutput: (value) => {
      stdout += value;
    },
  });
  assert.equal(code, 1);
  assert.equal(stdout, "");
  assert.equal(stderr, "Hosted runtime snapshot failed.\n");
  assert.doesNotMatch(stderr, new RegExp(secret, "u"));
});
