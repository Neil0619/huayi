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
  renderHostedApplicationVerificationSql,
  verifyHostedApplicationLogin,
} from "./acceptance-hosted-application-verify.mjs";
import {
  diagnoseHostedAcceptance,
  hostedDiagnosticArgument,
  hostedDiagnosticPredicateNames,
  renderHostedDiagnosticSql,
} from "./acceptance-hosted-diagnose.mjs";
import {
  hostedAcceptanceApplicationPoolerUrl,
  hostedAcceptanceMigrationVersions,
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
  assert.deepEqual(hostedAcceptancePriceVersionIds, {
    legacy: "8a7c5397-dbba-4e28-bc0d-107c4d04c3c3",
    offPeak: "dad0deb1-cbdc-4311-b3ad-b492c7ece757",
    peak: "e4479ddf-f4da-4a75-825a-2b25c1a145cf",
  });
  assert.equal(new Set(Object.values(hostedAcceptancePriceVersionIds)).size, 3);
  assert.equal(hostedAcceptanceMigrationVersions.at(-1), "20260822030000");
  assert.equal(hostedAcceptanceMigrationVersions.length, 12);
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
  const sql = renderHostedApplicationVerificationSql();
  assert.match(sql, /BEGIN READ ONLY/u);
  assert.match(sql, /session_user = 'huayi_hosted_acceptance_login'/u);
  assert.match(sql, /pg_stat_ssl/u);
  assert.match(sql, /has_schema_privilege\(session_user, 'public', 'CREATE'\)/u);
  assert.match(sql, /has_function_privilege/u);
  assert.match(sql, /pg_has_role\(session_user, 'postgres', 'SET'\)/u);
  assert.match(sql, /SET LOCAL ROLE huayi_context_setter/u);
  assert.match(sql, /set_owner_context/u);
  assert.match(sql, /SET LOCAL ROLE huayi_business/u);
  assert.match(sql, /current_owner_user_id\(\) IS NULL/u);
  assert.equal(sql.match(/COMMIT;/gu)?.length, 2);
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
      return calls.length === 1
        ? { code: 0, stdout: "t\nt|123\nt\nt|123\n" }
        : { code: 3, stderr: "ERROR:  42501\n", stdout: "" };
    },
  });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].captureOutput, true);
  assert.equal(calls[0].databaseUrl, hostedAcceptanceApplicationPoolerUrl);
  assert.equal(calls[0].environment.PGPASSWORD, applicationPassword);
  assert.equal(calls[0].environment.HUAYI_HOSTED_DATABASE_CA_CERTIFICATE, rootCertificate);
  assert.match(calls[1].input, /SET LOCAL ROLE postgres/u);
  assert.equal(calls[1].captureErrorCode, true);

  await assert.rejects(
    verifyHostedApplicationLogin({
      arguments_: [hostedApplicationVerificationArgument],
      environment: {
        HUAYI_HOSTED_DATABASE_CA_CERTIFICATE: rootCertificate,
        PGPASSWORD: applicationPassword,
      },
      runPsql: async () => ({ code: 0, stdout: "t\nf|123\nt\nt|123\n" }),
    }),
    /Hosted acceptance application login verification failed\./u,
  );

  let retries = 0;
  await verifyHostedApplicationLogin({
    arguments_: [hostedApplicationVerificationArgument],
    environment: {
      HUAYI_HOSTED_DATABASE_CA_CERTIFICATE: rootCertificate,
      PGPASSWORD: applicationPassword,
    },
    runPsql: async () => {
      retries += 1;
      if (retries === 1) return { code: 0, stdout: "t\nt|123\nt\nt|456\n" };
      if (retries === 2) return { code: 0, stdout: "t\nt|789\nt\nt|789\n" };
      return { code: 3, stderr: "ERROR:  42501\n", stdout: "" };
    },
  });
  assert.equal(retries, 3);

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
});

test("pnpm hosted bootstrap plan uses one argument and remains offline", async () => {
  const result = await runCommand("pnpm", ["acceptance:hosted:bootstrap", "--plan"]);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /no remote changes were made\./u);
  assert.equal(result.stderr, "");
});
