import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  applyHostedCron,
  hostedCronApplyConfirmation,
  hostedCronStatusArgument,
  hostedCronStatusFieldNames,
  readHostedCronStatus,
  renderHostedCronPlan,
  renderHostedCronStatus,
  renderHostedCronStatusSql,
  runHostedCronCli,
} from "./acceptance-hosted-cron.mjs";
import {
  hostedAcceptanceMigrationVersionsThrough0023,
  hostedAcceptancePoolerUrl,
} from "./acceptance-hosted-foundation.mjs";
import {
  applyDependencies,
  credentialDependencies,
  operationsSql,
  postgresPassword,
  rootCertificate,
  safeEnvironment,
  statusOutput,
} from "./acceptance-hosted-cron-test-fixtures.mjs";

test("hosted Cron plan is project-pinned, secret-free, zero-network, and zero-write", async () => {
  let calls = 0;
  let stdout = "";
  let stderr = "";
  const code = await runHostedCronCli({
    arguments_: ["--plan"],
    environment: { PGPASSWORD: "private@example.test" },
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
  assert.equal(stdout, renderHostedCronPlan());
  assert.match(stdout, /zero network \/ zero write/u);
  assert.match(stdout, /fixed operations SQL twice/u);
  assert.match(stdout, /Vercel Sensitive values cannot be read back/u);
  assert.doesNotMatch(stdout, /private@example\.test/u);
});

test("package scripts expose plan, project-pinned status, and confirmation-gated apply", async () => {
  const packageDocument = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  assert.equal(
    packageDocument.scripts["acceptance:hosted:cron:plan"],
    "node scripts/acceptance-hosted-cron.mjs --plan",
  );
  assert.equal(
    packageDocument.scripts["acceptance:hosted:cron:status"],
    `node scripts/acceptance-hosted-cron.mjs status ${hostedCronStatusArgument}`,
  );
  assert.equal(
    packageDocument.scripts["acceptance:hosted:cron:apply"],
    "node scripts/acceptance-hosted-cron.mjs apply",
  );
  assert.match(hostedCronApplyConfirmation, /after-r3c-and-vercel-continuity/u);
});

test("hosted Cron status SQL is one read-only transaction with fixed safe aggregates", () => {
  const sql = renderHostedCronStatusSql();

  assert.match(sql, /^BEGIN READ ONLY;/u);
  assert.match(sql, /ROLLBACK;\s*$/u);
  assert.match(sql, /FROM supabase_migrations\.schema_migrations/u);
  assert.match(sql, /FROM public\.security_notification_outbox/u);
  assert.match(sql, /FROM vault\.secrets/u);
  assert.doesNotMatch(sql, /vault\.decrypted_secrets|decrypted_secret/iu);
  assert.match(sql, /FROM cron\.job/u);
  assert.match(sql, /huayi_private\.invoke_cron_path/u);
  assert.match(sql, /proowner=\(SELECT oid FROM pg_roles WHERE rolname=current_user\)/u);
  assert.match(sql, /schema_acl AS \([\s\S]*SELECT count\(\*\)=4/u);
  assert.match(sql, /count\(\*\) FILTER \(WHERE acl\.is_grantable\)=0/u);
  assert.match(sql, /role\.rolname='huayi_context_setter'[\s\S]*privilege_type='USAGE'/u);
  assert.match(sql, /role\.rolname='huayi_business'[\s\S]*privilege_type='USAGE'/u);
  assert.match(sql, /function_acl\.contract_exact AND schema_acl\.contract_exact/u);
  assert.match(sql, /function_safety\.installable[\s\S]*schema_acl\.contract_exact/u);
  assert.match(sql, /\\if :cron_catalog_ready/u);
  assert.match(sql, /\\if :vault_catalog_ready/u);
  for (const migration of hostedAcceptanceMigrationVersionsThrough0023) {
    assert.match(sql, new RegExp(migration, "u"));
  }
  assert.match(sql, /20260831010000/u);
  for (const name of hostedCronStatusFieldNames) {
    assert.match(sql, new RegExp(`'${name}'`, "u"));
  }
  for (const forbidden of [
    /(?:^|\n)\s*(?:INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|GRANT|REVOKE)\b/iu,
    /Bearer [A-Za-z0-9_-]{32,}/u,
    /auth\.users/iu,
    /owner_user_id/iu,
    /\bemail\b/iu,
    /source_text/iu,
    /source_context/iu,
    /model_metadata/iu,
    /terminal_event/iu,
  ]) {
    assert.doesNotMatch(sql, forbidden);
  }
});

test("hosted Cron status uses one verify-full administrator read and bounded output", async () => {
  const calls = [];
  const status = await readHostedCronStatus({
    arguments_: ["status", hostedCronStatusArgument],
    environment: safeEnvironment,
    ...credentialDependencies,
    runPsql: async (request) => {
      calls.push(request);
      return { code: 0, stdout: statusOutput() };
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].captureOutput, true);
  assert.equal(calls[0].databaseUrl, hostedAcceptancePoolerUrl);
  assert.equal(calls[0].environment.PGPASSWORD, undefined);
  assert.equal(calls[0].password, postgresPassword);
  assert.equal(calls[0].environment.HUAYI_HOSTED_DATABASE_CA_CERTIFICATE, rootCertificate);
  assert.equal(calls[0].timeoutMilliseconds, 30_000);
  assert.equal(renderHostedCronStatus(status), statusOutput());
});

test("hosted Cron status rejects malformed, extra, unsafe, or out-of-range output", async () => {
  const read = (stdout, code = 0) =>
    readHostedCronStatus({
      arguments_: ["status", hostedCronStatusArgument],
      environment: safeEnvironment,
      ...credentialDependencies,
      runPsql: async () => ({ code, stdout }),
    });
  const privateValue = "private@example.test";

  await assert.rejects(
    read(statusOutput().replace("r3c_sent_count|1", `r3c_sent_count|${privateValue}`)),
    /Hosted Supabase Cron status failed/u,
  );
  await assert.rejects(read(`${statusOutput()}unexpected|t\n`), /status failed/u);
  await assert.rejects(
    read(statusOutput().replace("cron_installation_state|absent", "cron_installation_state|other")),
    /status failed/u,
  );
  await assert.rejects(
    read(statusOutput().replace("r3c_sent_count|1", "r3c_sent_count|9223372036854775808")),
    /status failed/u,
  );
  await assert.rejects(read(privateValue, 1), /status failed/u);
});

test("apply rejects wrong confirmation and failed preflight before fixed SQL", async () => {
  let calls = 0;
  await assert.rejects(
    applyHostedCron({
      arguments_: ["apply", "--confirm-wrong-project"],
      environment: safeEnvironment,
      ...applyDependencies,
      loadOperationsSql: async () => operationsSql,
      runPsql: async () => {
        calls += 1;
        return { code: 0, stdout: statusOutput() };
      },
    }),
    /arguments/u,
  );
  assert.equal(calls, 0);

  await assert.rejects(
    applyHostedCron({
      arguments_: ["apply", hostedCronApplyConfirmation],
      environment: safeEnvironment,
      ...applyDependencies,
      loadOperationsSql: async () => operationsSql,
      runPsql: async () => {
        calls += 1;
        return { code: 0, stdout: statusOutput({ ready: false }) };
      },
    }),
    /preflight-contract/u,
  );
  assert.equal(calls, 1);
});

test("apply executes the complete fixed SQL twice then independently verifies exact five jobs", async () => {
  const calls = [];
  const result = await applyHostedCron({
    arguments_: ["apply", hostedCronApplyConfirmation],
    environment: safeEnvironment,
    ...applyDependencies,
    loadOperationsSql: async () => operationsSql,
    runPsql: async (request) => {
      calls.push(request);
      if (calls.length === 1) return { code: 0, stdout: statusOutput() };
      if (calls.length === 4) return { code: 0, stdout: statusOutput({ installed: true }) };
      return { code: 0, stdout: "" };
    },
  });

  assert.deepEqual(result, { outcome: "applied" });
  assert.equal(calls.length, 4);
  assert.equal(calls[0].captureOutput, true);
  assert.equal(calls[0].timeoutMilliseconds, 30_000);
  assert.equal(calls[0].input, renderHostedCronStatusSql());
  assert.equal(calls[1].captureOutput, false);
  assert.equal(calls[1].timeoutMilliseconds, 30_000);
  assert.equal(calls[1].input, operationsSql);
  assert.equal(calls[2].captureOutput, false);
  assert.equal(calls[2].timeoutMilliseconds, 30_000);
  assert.equal(calls[2].input, operationsSql);
  assert.equal(calls[3].captureOutput, true);
  assert.equal(calls[3].timeoutMilliseconds, 30_000);
  assert.equal(calls[3].input, renderHostedCronStatusSql());
});

test("apply rejects a successful postflight read that does not prove the exact installation", async () => {
  let calls = 0;
  await assert.rejects(
    applyHostedCron({
      arguments_: ["apply", hostedCronApplyConfirmation],
      environment: safeEnvironment,
      ...applyDependencies,
      loadOperationsSql: async () => operationsSql,
      runPsql: async () => {
        calls += 1;
        if (calls === 1 || calls === 4) return { code: 0, stdout: statusOutput() };
        return { code: 0, stdout: "" };
      },
    }),
    /postflight-contract/u,
  );
  assert.equal(calls, 4);
});

test("apply stops at the first failed stage and CLI never reflects raw failures", async () => {
  for (const scenario of [
    { failureCall: 2, stage: "first-apply", totalCalls: 2 },
    { failureCall: 3, stage: "second-apply", totalCalls: 3 },
    { failureCall: 4, stage: "postflight-read", totalCalls: 4 },
  ]) {
    let calls = 0;
    await assert.rejects(
      applyHostedCron({
        arguments_: ["apply", hostedCronApplyConfirmation],
        environment: safeEnvironment,
        ...applyDependencies,
        loadOperationsSql: async () => operationsSql,
        runPsql: async () => {
          calls += 1;
          if (calls === scenario.failureCall) {
            return { code: 1, stdout: "private@example.test|Authorization: Bearer private" };
          }
          return { code: 0, stdout: calls === 1 ? statusOutput() : "" };
        },
      }),
      new RegExp(scenario.stage, "u"),
    );
    assert.equal(calls, scenario.totalCalls);
  }

  let stdout = "";
  let stderr = "";
  const code = await runHostedCronCli({
    arguments_: ["apply", hostedCronApplyConfirmation],
    environment: safeEnvironment,
    ...applyDependencies,
    loadOperationsSql: async () => operationsSql,
    runPsql: async () => ({ code: 1, stdout: "private@example.test" }),
    writeError: (value) => {
      stderr += value;
    },
    writeOutput: (value) => {
      stdout += value;
    },
  });
  assert.equal(code, 1);
  assert.equal(stdout, "");
  assert.equal(stderr, "Hosted Supabase Cron operation failed at stage: preflight-read.\n");
  assert.doesNotMatch(stderr, /private@example\.test|Authorization|Bearer/u);

  stderr = "";
  let thrownStdout = "";
  const thrownCode = await runHostedCronCli({
    arguments_: ["apply", hostedCronApplyConfirmation],
    environment: safeEnvironment,
    ...applyDependencies,
    loadOperationsSql: async () => operationsSql,
    runPsql: async () => {
      throw new Error("private@example.test Authorization: Bearer private");
    },
    writeError: (value) => {
      stderr += value;
    },
    writeOutput: (value) => {
      thrownStdout += value;
    },
  });
  assert.equal(thrownCode, 1);
  assert.equal(thrownStdout, "");
  assert.equal(stderr, "Hosted Supabase Cron operation failed at stage: preflight-read.\n");
});
