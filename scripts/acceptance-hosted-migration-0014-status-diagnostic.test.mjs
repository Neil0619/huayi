import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  hostedMigration0014StatusDiagnosticArgument,
  parseHostedMigration0014StatusDiagnosticOutput,
  renderHostedMigration0014StatusDiagnosticSql,
  runHostedMigration0014StatusDiagnosticCli,
  runHostedMigration0014StatusDiagnosticQuery,
} from "./acceptance-hosted-migration-0014-status-diagnostic.mjs";

const caCertificate =
  "-----BEGIN CERTIFICATE-----\n" + "a".repeat(64) + "\n-----END CERTIFICATE-----\n";

const basePredicateNames = [
  "migration_chain_applied_exact",
  "migration_chain_pending_exact",
  "bound_column_applied_exact",
  "bound_column_pending_exact",
  "bound_check_applied_exact",
  "bound_check_pending_exact",
  "bind_function_applied_exact",
  "bind_function_pending_exact",
  "bind_acl_exact",
  "renew_function_exact",
  "renew_function_absent",
  "renew_acl_exact",
];
const aclBreakdownSuffixes = [
  "setter_effective_execute",
  "business_effective_execute_denied",
  "runtime_effective_execute_denied",
  "owner_direct_execute_exact",
  "setter_direct_execute_exact",
  "public_direct_execute_absent",
  "anon_direct_execute_absent",
  "authenticated_direct_execute_absent",
  "service_role_direct_execute_absent",
  "other_direct_execute_absent",
];
const globalAclPredicateNames = [
  "data_api_roles_present_exact",
  "public_security_definer_present",
  "public_security_definer_public_execute_absent",
  "public_security_definer_api_roles_execute_absent",
];
const predicateNames = [
  ...basePredicateNames,
  ...["bind", "renew"].flatMap((prefix) =>
    aclBreakdownSuffixes.map((suffix) => `${prefix}_${suffix}`),
  ),
  ...globalAclPredicateNames,
];

function serializePredicates(values) {
  return `${predicateNames
    .map((name) => `${name}|${values[name] === true ? "t" : "f"}`)
    .join("\n")}\n`;
}

function expectedPending() {
  const truePredicates = new Set([
    "migration_chain_pending_exact",
    "bound_column_pending_exact",
    "bound_check_pending_exact",
    "bind_function_pending_exact",
    "bind_acl_exact",
    "renew_function_absent",
    ...aclBreakdownSuffixes.map((suffix) => `bind_${suffix}`),
    "public_security_definer_present",
    "public_security_definer_public_execute_absent",
    "public_security_definer_api_roles_execute_absent",
  ]);
  return Object.fromEntries(predicateNames.map((name) => [name, truePredicates.has(name)]));
}

function expectedApplied() {
  const truePredicates = new Set([
    "migration_chain_applied_exact",
    "bound_column_applied_exact",
    "bound_check_applied_exact",
    "bind_function_applied_exact",
    "bind_acl_exact",
    "renew_function_exact",
    "renew_acl_exact",
    ...["bind", "renew"].flatMap((prefix) =>
      aclBreakdownSuffixes.map((suffix) => `${prefix}_${suffix}`),
    ),
    "public_security_definer_present",
    "public_security_definer_public_execute_absent",
    "public_security_definer_api_roles_execute_absent",
  ]);
  return Object.fromEntries(predicateNames.map((name) => [name, truePredicates.has(name)]));
}

test("package exposes one fixed 0014 read-only status diagnostic entrypoint", async () => {
  const packageDocument = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  assert.equal(
    packageDocument.scripts["acceptance:hosted:migration:0014:status:diagnose"],
    `node scripts/acceptance-hosted-migration-0014-status-diagnostic.mjs ${hostedMigration0014StatusDiagnosticArgument}`,
  );
});

test("0014 status diagnostic parser accepts only the exact ordered allowlist", () => {
  const pendingOutput = serializePredicates(expectedPending());
  assert.deepEqual(parseHostedMigration0014StatusDiagnosticOutput(pendingOutput), {
    finalStatus: "pending_exact",
    predicates: expectedPending(),
  });
  const pendingWithAuxiliaryBindAclDrift = serializePredicates({
    ...expectedPending(),
    bind_acl_exact: false,
  });
  assert.equal(
    parseHostedMigration0014StatusDiagnosticOutput(pendingWithAuxiliaryBindAclDrift).finalStatus,
    "pending_exact",
  );
  for (const output of [
    "",
    pendingOutput.trimEnd(),
    pendingOutput.replace("|t\n", "|true\n"),
    pendingOutput.replace("migration_chain_applied_exact", "private_catalog_value"),
    `${pendingOutput}private_detail|t\n`,
  ]) {
    assert.equal(parseHostedMigration0014StatusDiagnosticOutput(output), null);
  }
});

test("0014 status diagnostic replaces the failed 5432 path with the known transaction pooler", async () => {
  let observed;
  const result = await runHostedMigration0014StatusDiagnosticQuery(
    { administratorPassword: "fictional-administrator-password", caCertificate },
    {
      runPsql: async (options) => {
        observed = options;
        return { code: 0, stderr: "", stdout: serializePredicates(expectedApplied()) };
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
  });
  assert.equal(observed.password, "fictional-administrator-password");
  assert.equal(observed.captureOutput, true);
  assert.equal(observed.timeoutMilliseconds, 30_000);
  assert.equal(observed.input, renderHostedMigration0014StatusDiagnosticSql());

  const invalidOutput = await runHostedMigration0014StatusDiagnosticQuery(
    { administratorPassword: "fictional-administrator-password", caCertificate },
    {
      runPsql: async () => ({ code: 0, stderr: "private-error", stdout: "private-output" }),
    },
  );
  assert.deepEqual(invalidOutput, {
    diagnostic: null,
    exitClass: "ok",
    outputExact: false,
  });
});

test("0014 status diagnostic emits only fixed failure classes and false predicates", async () => {
  for (const { code: processCode, expectedClass } of [
    { code: 1, expectedClass: "client_fatal" },
    { code: 2, expectedClass: "connection_error" },
    { code: 3, expectedClass: "script_error" },
    { code: null, expectedClass: "process_error" },
    { code: 27, expectedClass: "unexpected_error" },
  ]) {
    let stdout = "";
    const code = await runHostedMigration0014StatusDiagnosticCli({
      arguments_: [hostedMigration0014StatusDiagnosticArgument],
      environment: {},
      fetchCaCertificate: async () => caCertificate,
      readPassword: async () => "fictional-administrator-password",
      runDiagnosticQuery: async () => ({
        diagnostic: null,
        exitClass: expectedClass,
        outputExact: false,
        privateProcessCode: processCode,
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
        Object.fromEntries(predicateNames.map((name) => [name, false])),
      )}final_status|uncertain\n`,
    );
    assert.doesNotMatch(stdout, /private|must-not-leak|fictional/u);
  }
});

test("0014 status diagnostic reports exact predicates without reflecting private output", async () => {
  let stdout = "";
  const code = await runHostedMigration0014StatusDiagnosticCli({
    arguments_: [hostedMigration0014StatusDiagnosticArgument],
    environment: {},
    fetchCaCertificate: async () => caCertificate,
    readPassword: async () => "fictional-administrator-password",
    runDiagnosticQuery: async () => ({
      diagnostic: { finalStatus: "applied_exact", predicates: expectedApplied() },
      exitClass: "ok",
      outputExact: true,
    }),
    writeError: () => assert.fail("must not emit an error"),
    writeOutput: (value) => {
      stdout += value;
    },
  });
  assert.equal(code, 0);
  assert.equal(
    stdout,
    `status_query_exit_class|ok\nstatus_query_output_exact|t\n${serializePredicates(
      expectedApplied(),
    )}final_status|applied_exact\n`,
  );

  stdout = "";
  await runHostedMigration0014StatusDiagnosticCli({
    arguments_: [hostedMigration0014StatusDiagnosticArgument],
    environment: {},
    fetchCaCertificate: async () => caCertificate,
    readPassword: async () => "fictional-administrator-password",
    runDiagnosticQuery: async () => ({
      diagnostic: { finalStatus: "private_status", predicates: expectedApplied() },
      exitClass: "private_exit_class",
      outputExact: true,
    }),
    writeError: () => assert.fail("must not emit an error"),
    writeOutput: (value) => {
      stdout += value;
    },
  });
  assert.match(stdout, /^status_query_exit_class\|unexpected_error\n/u);
  assert.match(stdout, /status_query_output_exact\|f\n/u);
  assert.match(stdout, /final_status\|uncertain\n$/u);
  assert.doesNotMatch(stdout, /private/u);
});

test("0014 status diagnostic rejects arguments, inherited passwords, and private exceptions", async () => {
  for (const testCase of [
    { arguments_: [], environment: {}, expectedStage: "arguments" },
    {
      arguments_: [hostedMigration0014StatusDiagnosticArgument],
      environment: { PGPASSWORD: "secret" },
      expectedStage: "arguments",
    },
    {
      arguments_: [hostedMigration0014StatusDiagnosticArgument],
      environment: {},
      expectedStage: "ca-fetch",
      fetchCaCertificate: async () => Promise.reject(new Error("private-ca")),
    },
    {
      arguments_: [hostedMigration0014StatusDiagnosticArgument],
      environment: {},
      expectedStage: "credential-read",
      readPassword: async () => Promise.reject(new Error("private-password")),
    },
    {
      arguments_: [hostedMigration0014StatusDiagnosticArgument],
      environment: {},
      expectedStage: "query-process",
      runDiagnosticQuery: async () => Promise.reject(new Error("private-query")),
    },
  ]) {
    let stderr = "";
    const code = await runHostedMigration0014StatusDiagnosticCli({
      arguments_: [hostedMigration0014StatusDiagnosticArgument],
      environment: {},
      fetchCaCertificate: async () => caCertificate,
      readPassword: async () => "fictional-administrator-password",
      runDiagnosticQuery: async () => ({
        diagnostic: { finalStatus: "pending_exact", predicates: expectedPending() },
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
      `Hosted 0014 status diagnostic failed at allowlisted stage ${testCase.expectedStage}.\n`,
    );
    assert.doesNotMatch(stderr, /private|secret/u);
  }
});
