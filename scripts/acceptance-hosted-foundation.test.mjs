import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  bootstrapHostedAcceptance,
  hostedBootstrapConfirmation,
  renderHostedBootstrapSql,
} from "./acceptance-hosted-bootstrap.mjs";
import {
  hostedApplicationVerificationArgument,
  parseHostedApplicationContextOutput,
  parseHostedApplicationContractOutput,
  renderHostedApplicationContextSql,
  renderHostedApplicationContractSql,
  verifyHostedApplicationLogin,
} from "./acceptance-hosted-application-verify.mjs";
import {
  classifyHostedPsqlExitCode,
  diagnoseHostedApplicationLogin,
  hostedApplicationDiagnosticArgument,
  hostedApplicationDiagnosticPredicateNames,
} from "./acceptance-hosted-application-diagnose.mjs";
import {
  diagnoseHostedAcceptance,
  hostedDiagnosticArgument,
  hostedDiagnosticPredicateNames,
  renderHostedDiagnosticSql,
} from "./acceptance-hosted-diagnose.mjs";
import {
  createHostedPsqlProcessEnvironment,
  hostedAcceptanceApplicationSessionPoolerUrl,
  hostedAcceptanceMigrationVersions,
  hostedAcceptanceMigrationVersionsThrough0014,
  hostedAcceptancePoolerUrl,
  hostedAcceptancePriceVersionIds,
  hostedAcceptanceProjectRef,
} from "./acceptance-hosted-foundation.mjs";
import { renderHostedRoleMembershipContractSql } from "./acceptance-hosted-role-memberships.mjs";
import {
  renderHostedVerificationSql,
  verifyHostedAcceptance,
} from "./acceptance-hosted-verify.mjs";

const applicationPassword = "app-password-".padEnd(40, "a");
const postgresPassword = "postgres-password";
const rootCertificate =
  "-----BEGIN CERTIFICATE-----\n" + "a".repeat(64) + "\n-----END CERTIFICATE-----\n";

function runCommand(command, arguments_) {
  return new Promise((resolveResult) => {
    let stdout = "";
    let stderr = "";
    const child = spawn(command, arguments_, {
      cwd: new URL("..", import.meta.url),
      env: { PATH: process.env.PATH ?? "" },
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", () => resolveResult({ code: null, stderr: "", stdout: "" }));
    child.once("exit", (code, signal) =>
      resolveResult({ code: signal === null ? code : null, stderr, stdout }),
    );
  });
}

test("hosted foundation is pinned to the Singapore acceptance project and public price ids", () => {
  assert.equal(hostedAcceptanceProjectRef, "kpadiulxkgckskcfydry");
  assert.equal(
    hostedAcceptancePoolerUrl,
    "postgresql://postgres.kpadiulxkgckskcfydry@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres?sslmode=verify-full",
  );
  assert.equal(
    hostedAcceptanceApplicationSessionPoolerUrl,
    "postgresql://huayi_hosted_acceptance_login.kpadiulxkgckskcfydry@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres?sslmode=verify-full",
  );
  assert.deepEqual(hostedAcceptancePriceVersionIds, {
    legacy: "8a7c5397-dbba-4e28-bc0d-107c4d04c3c3",
    offPeak: "dad0deb1-cbdc-4311-b3ad-b492c7ece757",
    peak: "e4479ddf-f4da-4a75-825a-2b25c1a145cf",
  });
  assert.equal(new Set(Object.values(hostedAcceptancePriceVersionIds)).size, 3);
  assert.equal(hostedAcceptanceMigrationVersionsThrough0014.at(-1), "20260824010000");
  assert.equal(hostedAcceptanceMigrationVersionsThrough0014.length, 14);
  assert.equal(hostedAcceptanceMigrationVersions.at(-1), "20260825010000");
  assert.equal(hostedAcceptanceMigrationVersions.length, 15);
});

test("hosted psql always pins verify-full and the temporary CA path", () => {
  assert.deepEqual(
    createHostedPsqlProcessEnvironment({
      callerEnvironment: {
        PGPASSWORD: postgresPassword,
        PGSSLMODE: "disable",
        PGSSLROOTCERT: "/untrusted/root.crt",
      },
      processEnvironment: {
        LANG: "C.UTF-8",
        LC_ALL: "C.UTF-8",
        PATH: "/usr/bin",
      },
      rootCertificate: "/private/temporary/root.crt",
    }),
    {
      LANG: "C.UTF-8",
      LC_ALL: "C.UTF-8",
      PATH: "/usr/bin",
      PGPASSWORD: postgresPassword,
      PGSSLMODE: "verify-full",
      PGSSLROOTCERT: "/private/temporary/root.crt",
    },
  );
});

test("hosted bootstrap plan is side-effect free and apply requires the exact confirmation", async () => {
  let calls = 0;
  const runPsql = async () => {
    calls += 1;
    return { code: 0, stdout: "" };
  };

  await assert.rejects(
    bootstrapHostedAcceptance({ arguments_: [], environment: {}, runPsql }),
    /Hosted acceptance bootstrap arguments are invalid\./u,
  );
  await assert.rejects(
    bootstrapHostedAcceptance({
      arguments_: ["--confirm-hosted-foundation"],
      environment: {},
      runPsql,
    }),
    /Hosted acceptance bootstrap arguments are invalid\./u,
  );
  await assert.doesNotReject(
    bootstrapHostedAcceptance({ arguments_: ["--plan"], environment: {}, runPsql }),
  );
  assert.equal(calls, 0);
  assert.equal(hostedBootstrapConfirmation, "--confirm-hosted-foundation-kpadiulxkgckskcfydry");
});

test("hosted bootstrap consumes secrets only from the environment and sends fixed SQL over stdin", async () => {
  const calls = [];
  const runPsql = async (request) => {
    calls.push(request);
    return { code: 0, stdout: "" };
  };

  await bootstrapHostedAcceptance({
    arguments_: [hostedBootstrapConfirmation],
    environment: {
      HUAYI_HOSTED_APP_DATABASE_PASSWORD: applicationPassword,
      HUAYI_HOSTED_DATABASE_CA_CERTIFICATE: rootCertificate,
      PGPASSWORD: postgresPassword,
    },
    runPsql,
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].databaseUrl, hostedAcceptancePoolerUrl);
  assert.equal(calls[0].environment.PGPASSWORD, postgresPassword);
  assert.equal(calls[0].environment.HUAYI_HOSTED_DATABASE_CA_CERTIFICATE, rootCertificate);
  assert.equal(calls[0].captureOutput, false);
  assert.match(calls[0].input, /CREATE ROLE huayi_hosted_acceptance_login/u);
  assert.match(calls[0].input, /LOGIN NOINHERIT NOBYPASSRLS/u);
  assert.match(calls[0].input, /GRANT huayi_runtime TO huayi_hosted_acceptance_login/u);
  assert.match(calls[0].input, /VALUES \('model_kill_switch', true\)/u);
  assert.doesNotMatch(calls[0].input, /VALUES \('model_kill_switch', false\)/u);
  assert.match(calls[0].input, /account-exports-acceptance/u);
  assert.doesNotMatch(calls[0].input, /local-acceptance-operator|seen-said\.localhost/u);
  assert.match(calls[0].input, new RegExp(hostedAcceptancePriceVersionIds.legacy, "u"));
  assert.match(calls[0].input, new RegExp(hostedAcceptancePriceVersionIds.offPeak, "u"));
  assert.match(calls[0].input, new RegExp(hostedAcceptancePriceVersionIds.peak, "u"));
});

test("hosted bootstrap SQL fails closed on populated identity state and mismatched foundation rows", () => {
  const sql = renderHostedBootstrapSql(applicationPassword);

  assert.match(sql, /SELECT count\(\*\) FROM auth\.users/u);
  assert.match(sql, /SELECT count\(\*\) FROM public\.user_profiles/u);
  assert.match(sql, /SELECT count\(\*\) FROM public\.admin_roles/u);
  assert.match(sql, /SELECT count\(\*\) FROM public\.invitations/u);
  assert.match(sql, /first_operator_bootstrap/u);
  assert.match(sql, /supabase_migrations\.schema_migrations/u);
  assert.match(sql, /current_user <> 'postgres'/u);
  assert.match(sql, /rolcreaterole/u);
  assert.match(sql, /rolreplication/u);
  assert.doesNotMatch(sql, /current_setting\('is_superuser'\)/u);
  assert.match(sql, /require_model_price_version/u);
  assert.match(sql, /FROM pg_auth_members memberships/u);
  assert.match(sql, /memberships\.admin_option/u);
  assert.match(sql, /OR granted_role\.rolname = ANY/u);
  assert.match(sql, /Hosted acceptance role memberships conflict with the contract\./u);
  assert.match(sql, /Foundation bucket conflicts with the hosted acceptance contract\./u);
  assert.match(sql, /SELECT count\(\*\) FROM storage\.buckets\) = 0/u);
  assert.match(sql, /SELECT count\(\*\) FROM storage\.buckets\) = 1/u);
  assert.match(sql, /SELECT count\(\*\) FROM public\.runtime_controls\) <> 1/u);
  assert.doesNotMatch(sql, /ON CONFLICT \(name\) DO UPDATE SET enabled/u);
  assert.doesNotMatch(sql, /ALTER ROLE huayi_hosted_acceptance_login PASSWORD/u);
});

test("hosted role membership contract matches PostgreSQL 17 NOINHERIT and creator grants", () => {
  const contract = renderHostedRoleMembershipContractSql();

  assert.match(contract, /required_product_memberships/u);
  assert.match(contract, /HAVING count\(matching_memberships\.grantor\) <> 1/u);
  assert.match(contract, /membership\.admin_option IS FALSE/u);
  assert.match(contract, /membership\.inherit_option IS FALSE/u);
  assert.match(contract, /membership\.set_option IS TRUE/u);
  assert.match(contract, /member_role = 'postgres'/u);
  assert.match(contract, /membership\.admin_option IS TRUE/u);
  assert.match(contract, /membership\.set_option IS FALSE/u);
  assert.doesNotMatch(contract, /FROM pg_auth_members[\s\S]*\) = 3/u);

  const hostedSqls = [
    renderHostedBootstrapSql(applicationPassword),
    renderHostedVerificationSql(),
    renderHostedDiagnosticSql(),
  ];
  for (const sql of hostedSqls) {
    assert.ok(sql.includes(contract));
    assert.doesNotMatch(
      sql,
      /WHERE NOT memberships\.admin_option\s+AND memberships\.inherit_option/u,
    );
    assert.doesNotMatch(sql, /OR granted_role\.rolname IN[\s\S]*\)\) (?:=|<>) 3/u);
  }
});

test("hosted verification checks migration, roles, forced RLS, prices, bucket and empty identities", async () => {
  const sql = renderHostedVerificationSql();
  assert.match(sql, /supabase_migrations\.schema_migrations/u);
  assert.match(sql, /rolsuper/u);
  assert.match(sql, /rolinherit/u);
  assert.match(sql, /rolbypassrls/u);
  assert.match(sql, /relrowsecurity/u);
  assert.match(sql, /relforcerowsecurity/u);
  assert.match(sql, /polname = c\.relname \|\| '_owner'/u);
  assert.match(sql, /storage\.buckets/u);
  assert.match(sql, /storage\.objects/u);
  assert.match(sql, /auth\.users/u);
  assert.match(sql, /public\.admin_roles/u);
  assert.match(sql, /first_operator_bootstrap/u);
  assert.match(sql, /FROM pg_auth_members memberships/u);
  assert.match(sql, /memberships\.admin_option/u);
  assert.match(sql, /OR granted_role\.rolname = ANY/u);
  assert.match(sql, /'2026-08-16T15:59:59Z'::timestamptz/u);
  assert.match(sql, /SELECT count\(\*\) FROM public\.model_price_versions\) = 3/u);
  assert.match(sql, /SELECT count\(\*\) FROM storage\.buckets\) = 1/u);
  assert.match(sql, /SELECT count\(\*\) FROM storage\.objects\) = 0/u);

  const calls = [];
  await verifyHostedAcceptance({
    arguments_: ["--verify-hosted-foundation-kpadiulxkgckskcfydry"],
    environment: {
      HUAYI_HOSTED_DATABASE_CA_CERTIFICATE: rootCertificate,
      PGPASSWORD: postgresPassword,
    },
    runPsql: async (request) => {
      calls.push(request);
      return { code: 0, stdout: "t\n" };
    },
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].captureOutput, true);
  assert.equal(calls[0].databaseUrl, hostedAcceptancePoolerUrl);
  assert.equal(calls[0].environment.HUAYI_HOSTED_DATABASE_CA_CERTIFICATE, rootCertificate);

  await assert.rejects(
    verifyHostedAcceptance({
      arguments_: ["--verify-hosted-foundation-kpadiulxkgckskcfydry"],
      environment: {
        HUAYI_HOSTED_DATABASE_CA_CERTIFICATE: rootCertificate,
        PGPASSWORD: postgresPassword,
      },
      runPsql: async () => ({ code: 0, stdout: "f\n" }),
    }),
    /Hosted acceptance foundation verification failed\./u,
  );
});

test("hosted diagnostic reports only fixed read-only predicate verdicts", async () => {
  const sql = renderHostedDiagnosticSql();
  assert.match(sql, /BEGIN READ ONLY;/u);
  assert.match(sql, /ROLLBACK;/u);
  assert.match(sql, /migration_chain/u);
  assert.match(sql, /membership_contract_exact/u);
  assert.match(sql, /first_operator_empty/u);
  assert.match(sql, /migration_0012_trigger/u);
  assert.match(sql, /migration_0013_recovery_function/u);
  assert.match(sql, /resume_interrupted_password_registration/u);
  assert.match(sql, /migration_0014_bound_identity/u);
  assert.match(sql, /bound_email/u);
  assert.match(sql, /migration_0014_resend_function/u);
  assert.match(sql, /renew_interrupted_password_confirmation/u);

  const stdout = hostedDiagnosticPredicateNames.map((name) => `${name}|t`).join("\n") + "\n";
  const calls = [];
  const result = await diagnoseHostedAcceptance({
    arguments_: [hostedDiagnosticArgument],
    environment: {
      HUAYI_HOSTED_DATABASE_CA_CERTIFICATE: rootCertificate,
      PGPASSWORD: postgresPassword,
    },
    runPsql: async (request) => {
      calls.push(request);
      return { code: 0, stdout };
    },
  });
  assert.deepEqual(result, stdout.trim().split("\n"));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].captureOutput, true);
  assert.equal(calls[0].databaseUrl, hostedAcceptancePoolerUrl);

  await assert.rejects(
    diagnoseHostedAcceptance({
      arguments_: [hostedDiagnosticArgument],
      environment: {
        HUAYI_HOSTED_DATABASE_CA_CERTIFICATE: rootCertificate,
        PGPASSWORD: postgresPassword,
      },
      runPsql: async () => ({ code: 0, stdout: "migration_chain|t\nunexpected|f\n" }),
    }),
    /Hosted acceptance foundation diagnostic failed\./u,
  );
});

test("hosted application login verifies privileges and context isolation across transactions", async () => {
  const contractSql = renderHostedApplicationContractSql();
  const contextSql = renderHostedApplicationContextSql();
  assert.match(contractSql, /BEGIN READ ONLY/u);
  assert.match(contractSql, /session_user = 'huayi_hosted_acceptance_login'/u);
  assert.doesNotMatch(contractSql, /pg_stat_ssl/u);
  assert.match(contractSql, /has_schema_privilege\(session_user, 'public', 'CREATE'\)/u);
  assert.match(contractSql, /has_function_privilege/u);
  assert.doesNotMatch(
    contractSql,
    /has_function_privilege\(\s*session_user,\s*'huayi_private\.set_owner_context\(uuid\)'/u,
  );
  assert.match(contractSql, /JOIN pg_namespace/u);
  assert.match(contractSql, /procedures\.proargtypes\[0\] = 'uuid'::regtype/u);
  assert.match(contractSql, /pg_has_role\(session_user, 'postgres', 'SET'\)/u);
  assert.match(contextSql, /SET LOCAL ROLE huayi_context_setter/u);
  assert.match(contextSql, /set_owner_context/u);
  assert.match(contextSql, /SET LOCAL ROLE huayi_business/u);
  assert.match(contextSql, /current_owner_user_id\(\) IS NULL/u);
  assert.equal(contextSql.match(/COMMIT;/gu)?.length, 2);
  assert.equal(
    hostedApplicationVerificationArgument,
    "--verify-hosted-application-login-kpadiulxkgckskcfydry",
  );

  const calls = [];
  await verifyHostedApplicationLogin({
    arguments_: [hostedApplicationVerificationArgument],
    environment: {
      HUAYI_HOSTED_DATABASE_CA_CERTIFICATE: rootCertificate,
      PGPASSWORD: applicationPassword,
    },
    runPsql: async (request) => {
      calls.push(request);
      if (calls.length === 1) return { code: 0, stdout: "t|t|t|t|t|t\n" };
      if (calls.length === 2) return { code: 0, stdout: "t|123\nt\nt|123\n" };
      return { code: 3, stderr: "ERROR:  42501\n", stdout: "" };
    },
  });
  assert.equal(calls.length, 3);
  assert.equal(calls[0].captureOutput, true);
  assert.equal(calls[0].databaseUrl, hostedAcceptanceApplicationSessionPoolerUrl);
  assert.equal(calls[0].input, contractSql);
  assert.equal(calls[0].environment.PGPASSWORD, applicationPassword);
  assert.equal(calls[0].environment.HUAYI_HOSTED_DATABASE_CA_CERTIFICATE, rootCertificate);
  assert.equal(calls[1].input, contextSql);
  assert.match(calls[2].input, /SET LOCAL ROLE postgres/u);
  assert.equal(calls[2].captureErrorCode, true);

  await assert.rejects(
    verifyHostedApplicationLogin({
      arguments_: [hostedApplicationVerificationArgument],
      environment: {
        HUAYI_HOSTED_DATABASE_CA_CERTIFICATE: rootCertificate,
        PGPASSWORD: applicationPassword,
      },
      runPsql: async () => ({ code: 0, stdout: "t|t|t|t|t|f\n" }),
    }),
    /Hosted acceptance application login verification failed\./u,
  );

  let mismatchedBackendCalls = 0;
  await assert.rejects(
    verifyHostedApplicationLogin({
      arguments_: [hostedApplicationVerificationArgument],
      environment: {
        HUAYI_HOSTED_DATABASE_CA_CERTIFICATE: rootCertificate,
        PGPASSWORD: applicationPassword,
      },
      runPsql: async () => {
        mismatchedBackendCalls += 1;
        return mismatchedBackendCalls === 1
          ? { code: 0, stdout: "t|t|t|t|t|t\n" }
          : { code: 0, stdout: "t|123\nt\nt|456\n" };
      },
    }),
    /Hosted acceptance application login verification failed\./u,
  );
  assert.equal(mismatchedBackendCalls, 2);

  await assert.rejects(
    verifyHostedApplicationLogin({
      arguments_: [hostedApplicationVerificationArgument],
      environment: {
        HUAYI_HOSTED_DATABASE_CA_CERTIFICATE: rootCertificate,
        PGPASSWORD: applicationPassword,
      },
      runPsql: async () => ({ code: 1, stderr: "ERROR:  42501\n", stdout: "" }),
    }),
    /Hosted acceptance application login verification failed\./u,
  );
});

test("hosted application output parsers accept only the fixed split contracts", () => {
  assert.deepEqual(parseHostedApplicationContractOutput("t|t|t|f|t|t\r\n"), [
    true,
    true,
    true,
    false,
    true,
    true,
  ]);
  assert.deepEqual(parseHostedApplicationContextOutput("t|123\r\nt\r\nt|123\r\n"), {
    contextCleared: true,
    contextSet: true,
    contextVisible: true,
    firstBackendPid: "123",
    secondBackendPid: "123",
  });
  for (const malformed of [
    "",
    "t|t|t|t|t\n",
    "t|t|t|t|t|t|t\n",
    "true|t|t|t|t|t\n",
    "t|t|t|t|t|t\nextra\n",
  ]) {
    assert.equal(parseHostedApplicationContractOutput(malformed), null);
  }
  for (const malformed of [
    "",
    "t|not-a-pid\nt\nt|123\n",
    "t|123\nt\nt|123\nextra\n",
    "t|123\ntrue\nt|123\n",
  ]) {
    assert.equal(parseHostedApplicationContextOutput(malformed), null);
  }
});

test("hosted application diagnostic reports only fixed stage predicates", async () => {
  const calls = [];
  const results = await diagnoseHostedApplicationLogin({
    arguments_: [hostedApplicationDiagnosticArgument],
    environment: {
      HUAYI_HOSTED_DATABASE_CA_CERTIFICATE: rootCertificate,
      PGPASSWORD: applicationPassword,
    },
    runPsql: async (request) => {
      calls.push(request);
      if (calls.length === 1) return { code: 0, stderr: "", stdout: "t\n" };
      if (calls.length === 2) return { code: 0, stderr: "", stdout: "t|t|t|f|t|t\n" };
      if (calls.length === 3) return { code: 0, stderr: "", stdout: "t|123\nt\nt|123\n" };
      return { code: 3, stderr: "ERROR:  42501\n", stdout: "" };
    },
  });
  assert.deepEqual(results, [
    "connection_exit_class|ok",
    "psql_connection_ok|t",
    "client_tls_verified|t",
    "contract_exit_class|ok",
    "contract_execution_completed|t",
    "contract_output_valid|t",
    "session_user_exact|t",
    "current_user_exact|t",
    "runtime_member|t",
    "postgres_not_settable|f",
    "public_create_denied|t",
    "context_function_denied|t",
    "application_contract|f",
    "context_exit_class|ok",
    "context_execution_completed|t",
    "context_output_valid|t",
    "context_set|t",
    "context_visible|t",
    "context_cleared|t",
    "backend_reused|t",
    "postgres_switch_exit_class|script_error",
    "postgres_switch_denied|t",
  ]);
  assert.deepEqual(
    hostedApplicationDiagnosticPredicateNames,
    results.map((result) => result.split("|")[0]),
  );
  assert.equal(calls[0].databaseUrl, hostedAcceptanceApplicationSessionPoolerUrl);
  assert.equal(calls[0].input, "SELECT true;\n");
  assert.equal(calls[1].input, renderHostedApplicationContractSql());
  assert.equal(calls[2].input, renderHostedApplicationContextSql());
  assert.equal(calls[3].captureErrorCode, true);

  for (const scenario of [
    {
      code: null,
      stages: [false, false],
      stdout: "",
    },
    {
      code: 2,
      stages: [false, false],
      stdout: "",
    },
    {
      code: 3,
      stages: [false, false],
      stdout: "",
    },
  ]) {
    let failedCalls = 0;
    const failed = await diagnoseHostedApplicationLogin({
      arguments_: [hostedApplicationDiagnosticArgument],
      environment: {
        HUAYI_HOSTED_DATABASE_CA_CERTIFICATE: rootCertificate,
        PGPASSWORD: applicationPassword,
      },
      runPsql: async () => {
        failedCalls += 1;
        return { code: scenario.code, stderr: "", stdout: scenario.stdout };
      },
    });
    assert.deepEqual(failed.slice(0, 3), [
      `connection_exit_class|${classifyHostedPsqlExitCode(scenario.code)}`,
      `psql_connection_ok|${scenario.stages[0] ? "t" : "f"}`,
      `client_tls_verified|${scenario.stages[1] ? "t" : "f"}`,
    ]);
    assert.deepEqual(
      failed.slice(3),
      hostedApplicationDiagnosticPredicateNames
        .slice(3)
        .map((name) => (name.endsWith("_exit_class") ? `${name}|not_run` : `${name}|f`)),
    );
    assert.equal(failedCalls, 1);
  }

  const stageScenarios = [
    {
      expected: {
        applicationContract: "f",
        contextExecutionCompleted: "t",
        contractExecutionCompleted: "f",
      },
      responses: [
        { code: 0, stderr: "", stdout: "t\n" },
        { code: 3, stderr: "SECRET contract error", stdout: "" },
        { code: 0, stderr: "", stdout: "t|123\nt\nt|123\n" },
        { code: 3, stderr: "ERROR:  42501\n", stdout: "" },
      ],
    },
    {
      expected: {
        applicationContract: "t",
        contextExecutionCompleted: "f",
        contractExecutionCompleted: "t",
      },
      responses: [
        { code: 0, stderr: "", stdout: "t\n" },
        { code: 0, stderr: "", stdout: "t|t|t|t|t|t\n" },
        { code: 3, stderr: "SECRET context error", stdout: "" },
        { code: 3, stderr: "ERROR:  42501\n", stdout: "" },
      ],
    },
  ];
  for (const scenario of stageScenarios) {
    let stageCalls = 0;
    const stageResults = await diagnoseHostedApplicationLogin({
      arguments_: [hostedApplicationDiagnosticArgument],
      environment: {
        HUAYI_HOSTED_DATABASE_CA_CERTIFICATE: rootCertificate,
        PGPASSWORD: applicationPassword,
      },
      runPsql: async () => scenario.responses[stageCalls++],
    });
    const stageMap = Object.fromEntries(stageResults.map((result) => result.split("|")));
    assert.equal(stageCalls, 4);
    assert.equal(
      stageMap.contract_execution_completed,
      scenario.expected.contractExecutionCompleted,
    );
    assert.equal(
      stageMap.contract_exit_class,
      scenario.expected.contractExecutionCompleted === "t" ? "ok" : "script_error",
    );
    assert.equal(stageMap.application_contract, scenario.expected.applicationContract);
    assert.equal(stageMap.context_execution_completed, scenario.expected.contextExecutionCompleted);
    assert.equal(
      stageMap.context_exit_class,
      scenario.expected.contextExecutionCompleted === "t" ? "ok" : "script_error",
    );
    assert.equal(stageMap.postgres_switch_exit_class, "script_error");
    assert.equal(stageMap.postgres_switch_denied, "t");
    assert.doesNotMatch(stageResults.join("\n"), /SECRET|123|42501/u);
  }
});

test("hosted psql exit classification is fixed and exhaustive", () => {
  assert.deepEqual(
    [0, 1, 2, 3, null, 4, -1].map((code) => classifyHostedPsqlExitCode(code)),
    [
      "ok",
      "client_fatal",
      "connection_error",
      "script_error",
      "process_error",
      "unexpected_error",
      "unexpected_error",
    ],
  );
});

test("package scripts expose separate hosted plan, apply and read-only verification commands", async () => {
  const packageDocument = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  assert.equal(
    packageDocument.scripts["acceptance:hosted:bootstrap"],
    "node scripts/acceptance-hosted-bootstrap.mjs",
  );
  assert.equal(
    packageDocument.scripts["acceptance:hosted:verify"],
    "node scripts/acceptance-hosted-verify.mjs",
  );
  assert.equal(
    packageDocument.scripts["acceptance:hosted:application:verify"],
    "node scripts/acceptance-hosted-application-verify.mjs",
  );
  assert.equal(
    packageDocument.scripts["acceptance:hosted:application:diagnose"],
    "node scripts/acceptance-hosted-application-diagnose.mjs",
  );
  assert.equal(
    packageDocument.scripts["acceptance:hosted:operator"],
    "node scripts/acceptance-hosted-first-operator.mjs",
  );
  assert.equal(
    packageDocument.scripts["acceptance:hosted:operator:status"],
    "node scripts/acceptance-hosted-first-operator.mjs status",
  );
  assert.equal(
    packageDocument.scripts["acceptance:hosted:operator:invite"],
    "node scripts/acceptance-hosted-first-operator.mjs invite",
  );
  assert.equal(
    packageDocument.scripts["acceptance:hosted:operator:replace"],
    "node scripts/acceptance-hosted-first-operator.mjs replace",
  );
  assert.equal(
    packageDocument.scripts["acceptance:hosted:operator:complete"],
    "node scripts/acceptance-hosted-first-operator.mjs complete",
  );
  assert.equal(
    packageDocument.scripts["acceptance:hosted:operator:verify"],
    "node scripts/acceptance-hosted-first-operator.mjs verify",
  );
  assert.equal(
    packageDocument.scripts["acceptance:hosted:operator:pepper:verify"],
    "node scripts/acceptance-hosted-pepper-continuity.mjs",
  );
});

test("hosted bootstrap entrypoint uses one argument and remains offline", async () => {
  const result = await runCommand(process.execPath, [
    "scripts/acceptance-hosted-bootstrap.mjs",
    "--plan",
  ]);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /no remote changes were made\./u);
  assert.equal(result.stderr, "");
});
