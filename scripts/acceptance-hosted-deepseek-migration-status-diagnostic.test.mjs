import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";

import {
  hostedDeepseekMigrationStatusDiagnosticArgument,
  hostedDeepseekMigrationStatusDiagnosticPredicateNames as predicateNames,
  parseHostedDeepseekMigrationStatusDiagnosticOutput,
  renderHostedDeepseekMigrationStatusDiagnosticSql,
  runHostedDeepseekMigrationStatusDiagnosticCli,
  runHostedDeepseekMigrationStatusDiagnosticQuery,
} from "./acceptance-hosted-deepseek-migration-status-diagnostic.mjs";

const caCertificate =
  "-----BEGIN CERTIFICATE-----\n" + "a".repeat(64) + "\n-----END CERTIFICATE-----\n";
const requireFromApi = createRequire(new URL("../apps/api/package.json", import.meta.url));
const { PGlite } = requireFromApi("@electric-sql/pglite");

const migrationPredicateNames = [
  "migration_chain_0015_exact",
  "migration_chain_0016_exact",
  "migration_chain_0017_exact",
  "migration_chain_0018_exact",
  "migration_chain_0019_exact",
  "migration_chain_0020_exact",
  "migration_chain_0021_exact",
];
const catalogPredicateNames = [
  "executor_role_present",
  "executor_role_attributes_exact",
  "executor_role_membership_absent",
  "executor_role_membership_contract_exact",
  "private_schema_owner_exact",
  "operations_table_present",
  "operations_table_owner_exact",
  "operations_table_rls_exact",
  "operations_table_force_rls_exact",
  "cleanup_table_present",
  "cleanup_table_owner_exact",
  "cleanup_table_rls_exact",
  "cleanup_table_force_rls_exact",
  "receipt_column_exact",
  "receipt_constraint_exact",
  "operation_trigger_exact",
  "cleanup_trigger_exact",
  "receipt_trigger_exact",
  "executor_schema_usage_exact",
  "executor_schema_create_absent",
  "unexpected_table_acl_absent",
  "external_table_acl_absent",
];
const functionKeys = [
  "arm_cleanup",
  "bind_request",
  "claim_cleanup",
  "claim_operation",
  "complete_cleanup",
  "complete_operation",
  "effective_kill_switch",
  "enforce_cleanup",
  "enforce_operation",
  "enforce_receipt",
  "token_hash",
  "mark_dispatch",
  "read_freeze_settlement",
  "read_status",
  "reconcile_bind",
  "record_settlement",
  "retain_evidence",
];
const functionPredicateSuffixes = ["contract_exact", "executor_acl_exact", "unexpected_acl_absent"];
const aggregatePredicateNames = [
  "private_functions_absent",
  "private_function_count_exact",
  "private_function_owner_exact",
  "private_function_security_definer_exact",
  "private_function_search_path_exact",
  "executor_function_acl_exact",
  "unexpected_function_acl_absent",
  "external_function_acl_absent",
  "pending_state_exact",
  "applied_state_exact",
];
const expectedPredicateNames = [
  ...migrationPredicateNames,
  ...catalogPredicateNames,
  ...functionKeys.flatMap((key) =>
    functionPredicateSuffixes.map((suffix) => `function_${key}_${suffix}`),
  ),
  ...aggregatePredicateNames,
];

function serializePredicates(values) {
  return `${expectedPredicateNames
    .map((name) => `${name}|${values[name] === true ? "t" : "f"}`)
    .join("\n")}\n`;
}

function allFalsePredicates() {
  return Object.fromEntries(expectedPredicateNames.map((name) => [name, false]));
}

function appliedPredicates() {
  return {
    ...Object.fromEntries(expectedPredicateNames.map((name) => [name, true])),
    private_functions_absent: false,
    pending_state_exact: false,
  };
}

function parseDatabaseDiagnostic(results) {
  const rows = results.flatMap((result) => result.rows ?? []);
  const output = `${rows.map((row) => row.diagnostic).join("\n")}\n`;
  return parseHostedDeepseekMigrationStatusDiagnosticOutput(output);
}

test("package exposes one fixed DeepSeek post-apply read-only diagnostic", async () => {
  const packageDocument = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  assert.equal(
    packageDocument.scripts["acceptance:hosted:deepseek:migration:status:diagnose"],
    `node scripts/acceptance-hosted-deepseek-migration-status-diagnostic.mjs ${hostedDeepseekMigrationStatusDiagnosticArgument}`,
  );
  assert.deepEqual(predicateNames, expectedPredicateNames);
});

test("DeepSeek status diagnostic parser accepts only the exact ordered allowlist", () => {
  const expected = appliedPredicates();
  assert.deepEqual(
    parseHostedDeepseekMigrationStatusDiagnosticOutput(serializePredicates(expected)),
    {
      finalStatus: "applied_exact",
      predicates: expected,
    },
  );
  for (const output of [
    "",
    serializePredicates(expected).trimEnd(),
    serializePredicates(expected).replace("|t\n", "|true\n"),
    serializePredicates(expected).replace(expectedPredicateNames[0], "private_catalog_value"),
    `${serializePredicates(expected)}private_detail|t\n`,
  ]) {
    assert.equal(parseHostedDeepseekMigrationStatusDiagnosticOutput(output), null);
  }
});

test("DeepSeek status diagnostic query is read-only, bounded, and uses the transaction pooler", async () => {
  let observed;
  const result = await runHostedDeepseekMigrationStatusDiagnosticQuery(
    { administratorPassword: "fictional-administrator-password", caCertificate },
    {
      runPsql: async (options) => {
        observed = options;
        return { code: 0, stderr: "", stdout: serializePredicates(appliedPredicates()) };
      },
    },
  );
  assert.equal(result.exitClass, "ok");
  assert.equal(result.outputExact, true);
  assert.equal(result.diagnostic.finalStatus, "applied_exact");
  assert.equal(
    observed.databaseUrl,
    "postgresql://postgres.kpadiulxkgckskcfydry@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres?sslmode=verify-full&connect_timeout=10",
  );
  assert.doesNotMatch(observed.databaseUrl, /:5432\//u);
  assert.deepEqual(observed.environment, {
    HUAYI_HOSTED_DATABASE_CA_CERTIFICATE: caCertificate,
    PGPASSWORD: "fictional-administrator-password",
  });
  assert.equal(observed.captureOutput, true);
  assert.equal(observed.timeoutMilliseconds, 30_000);
  assert.equal(observed.input, renderHostedDeepseekMigrationStatusDiagnosticSql());
  assert.ok(Buffer.byteLength(serializePredicates(appliedPredicates())) <= 4_096);
  assert.match(observed.input, /^\nBEGIN READ ONLY;/u);
  assert.match(observed.input, /ROLLBACK;\n$/u);
  assert.doesNotMatch(
    observed.input,
    /^\s*(?:INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|GRANT|REVOKE)\b/mu,
  );
});

test("DeepSeek status diagnostic distinguishes pending, partial, applied, and drifted catalogs", async () => {
  const database = new PGlite();
  await database.waitReady;
  try {
    await database.exec(`
      CREATE ROLE anon NOLOGIN;
      CREATE ROLE authenticated NOLOGIN;
      CREATE ROLE service_role NOLOGIN;
    `);
    const migrationFiles = (
      await readdir(new URL("../apps/api/migrations", import.meta.url))
    ).sort();
    for (const filename of migrationFiles.slice(0, 15)) {
      await database.exec(
        await readFile(new URL(`../apps/api/migrations/${filename}`, import.meta.url), "utf8"),
      );
    }
    await database.exec(`
      CREATE SCHEMA supabase_migrations;
      CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY);
      INSERT INTO supabase_migrations.schema_migrations(version)
      VALUES ${[
        "20260821000000",
        "20260821010000",
        "20260821020000",
        "20260821030000",
        "20260821040000",
        "20260821050000",
        "20260821060000",
        "20260821070000",
        "20260821080000",
        "20260822010000",
        "20260822020000",
        "20260822030000",
        "20260823010000",
        "20260824010000",
        "20260825010000",
      ]
        .map((version) => `('${version}')`)
        .join(",")};
    `);

    let diagnostic = parseDatabaseDiagnostic(
      await database.exec(renderHostedDeepseekMigrationStatusDiagnosticSql()),
    );
    assert.equal(diagnostic.finalStatus, "pending_exact");
    assert.equal(diagnostic.predicates.migration_chain_0015_exact, true);
    assert.equal(diagnostic.predicates.private_functions_absent, true);
    assert.equal(diagnostic.predicates.pending_state_exact, true);

    await database.exec(
      await readFile(
        new URL(`../apps/api/migrations/${migrationFiles[15]}`, import.meta.url),
        "utf8",
      ),
    );
    await database.query("INSERT INTO supabase_migrations.schema_migrations(version) VALUES ($1)", [
      "20260827010000",
    ]);
    diagnostic = parseDatabaseDiagnostic(
      await database.exec(renderHostedDeepseekMigrationStatusDiagnosticSql()),
    );
    assert.equal(diagnostic.finalStatus, "uncertain");
    assert.equal(diagnostic.predicates.migration_chain_0016_exact, true);
    assert.equal(diagnostic.predicates.operations_table_present, true);
    assert.equal(diagnostic.predicates.receipt_column_exact, false);
    assert.equal(diagnostic.predicates.applied_state_exact, false);

    for (const [index, filename] of migrationFiles.slice(16, 21).entries()) {
      await database.exec(
        await readFile(new URL(`../apps/api/migrations/${filename}`, import.meta.url), "utf8"),
      );
      await database.query(
        "INSERT INTO supabase_migrations.schema_migrations(version) VALUES ($1)",
        [`202608270${index + 2}0000`],
      );
    }
    diagnostic = parseDatabaseDiagnostic(
      await database.exec(renderHostedDeepseekMigrationStatusDiagnosticSql()),
    );
    assert.equal(diagnostic.finalStatus, "applied_exact");
    assert.equal(diagnostic.predicates.migration_chain_0021_exact, true);
    assert.equal(diagnostic.predicates.applied_state_exact, true);
    assert.equal(diagnostic.predicates.executor_role_membership_absent, true);
    assert.equal(diagnostic.predicates.executor_role_membership_contract_exact, true);
    for (const key of functionKeys) {
      assert.equal(diagnostic.predicates[`function_${key}_contract_exact`], true);
      assert.equal(diagnostic.predicates[`function_${key}_executor_acl_exact`], true);
      assert.equal(diagnostic.predicates[`function_${key}_unexpected_acl_absent`], true);
    }

    await database.exec(`
      GRANT huayi_hosted_acceptance_executor TO postgres
      WITH ADMIN TRUE, INHERIT FALSE, SET FALSE;
    `);
    diagnostic = parseDatabaseDiagnostic(
      await database.exec(renderHostedDeepseekMigrationStatusDiagnosticSql()),
    );
    assert.equal(diagnostic.finalStatus, "applied_exact");
    assert.equal(diagnostic.predicates.executor_role_membership_absent, false);
    assert.equal(diagnostic.predicates.executor_role_membership_contract_exact, true);

    await database.exec(`
      GRANT huayi_hosted_acceptance_executor TO postgres WITH SET TRUE;
    `);
    diagnostic = parseDatabaseDiagnostic(
      await database.exec(renderHostedDeepseekMigrationStatusDiagnosticSql()),
    );
    assert.equal(diagnostic.finalStatus, "uncertain");
    assert.equal(diagnostic.predicates.executor_role_membership_absent, false);
    assert.equal(diagnostic.predicates.executor_role_membership_contract_exact, false);
    assert.equal(diagnostic.predicates.applied_state_exact, false);
    await database.exec(`
      GRANT huayi_hosted_acceptance_executor TO postgres WITH SET FALSE;
    `);

    await database.exec("ALTER ROLE huayi_hosted_acceptance_executor SUPERUSER;");
    diagnostic = parseDatabaseDiagnostic(
      await database.exec(renderHostedDeepseekMigrationStatusDiagnosticSql()),
    );
    assert.equal(diagnostic.finalStatus, "uncertain");
    assert.equal(diagnostic.predicates.executor_role_attributes_exact, false);
    assert.equal(diagnostic.predicates.applied_state_exact, false);
  } finally {
    await database.close();
  }
});

test("DeepSeek status diagnostic emits only fixed failure classes and false predicates", async () => {
  for (const expectedClass of [
    "client_fatal",
    "connection_error",
    "script_error",
    "process_error",
    "unexpected_error",
  ]) {
    let stdout = "";
    const code = await runHostedDeepseekMigrationStatusDiagnosticCli({
      arguments_: [hostedDeepseekMigrationStatusDiagnosticArgument],
      environment: {},
      fetchCaCertificate: async () => caCertificate,
      readPassword: async () => "fictional-administrator-password",
      runDiagnosticQuery: async () => ({
        diagnostic: null,
        exitClass: expectedClass,
        outputExact: false,
        privateRawOutput: "must-not-leak",
      }),
      writeError: () => assert.fail("must not emit private infrastructure detail"),
      writeOutput: (value) => {
        stdout += value;
      },
    });
    assert.equal(code, 0);
    assert.equal(
      stdout,
      `status_query_exit_class|${expectedClass}\nstatus_query_output_exact|f\n${serializePredicates(
        allFalsePredicates(),
      )}final_status|uncertain\n`,
    );
    assert.doesNotMatch(stdout, /privateRawOutput|must-not-leak|fictional/u);
  }
});

test("DeepSeek status diagnostic rejects unsafe setup without reflecting exceptions", async () => {
  for (const testCase of [
    { arguments_: [], environment: {}, expectedStage: "arguments" },
    {
      arguments_: [hostedDeepseekMigrationStatusDiagnosticArgument],
      environment: { PGPASSWORD: "secret" },
      expectedStage: "arguments",
    },
    {
      arguments_: [hostedDeepseekMigrationStatusDiagnosticArgument],
      environment: {},
      expectedStage: "ca-fetch",
      fetchCaCertificate: async () => Promise.reject(new Error("private-ca")),
    },
    {
      arguments_: [hostedDeepseekMigrationStatusDiagnosticArgument],
      environment: {},
      expectedStage: "password-prompt",
      readPassword: async () => Promise.reject(new Error("private-password")),
    },
    {
      arguments_: [hostedDeepseekMigrationStatusDiagnosticArgument],
      environment: {},
      expectedStage: "query-process",
      runDiagnosticQuery: async () => Promise.reject(new Error("private-query")),
    },
  ]) {
    let stderr = "";
    const code = await runHostedDeepseekMigrationStatusDiagnosticCli({
      arguments_: [hostedDeepseekMigrationStatusDiagnosticArgument],
      environment: {},
      fetchCaCertificate: async () => caCertificate,
      readPassword: async () => "fictional-administrator-password",
      runDiagnosticQuery: async () => ({
        diagnostic: { finalStatus: "applied_exact", predicates: appliedPredicates() },
        exitClass: "ok",
        outputExact: true,
      }),
      writeError: (value) => {
        stderr += value;
      },
      writeOutput: () => assert.fail("must not emit predicates after setup failure"),
      ...testCase,
    });
    assert.equal(code, 1);
    assert.equal(
      stderr,
      `Hosted DeepSeek status diagnostic failed at allowlisted stage ${testCase.expectedStage}.\n`,
    );
    assert.doesNotMatch(stderr, /private|secret/u);
  }
});
