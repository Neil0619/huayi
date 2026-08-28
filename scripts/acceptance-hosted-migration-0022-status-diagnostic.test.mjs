import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";

import {
  hostedMigration0022StatusDiagnosticArgument,
  hostedMigration0022StatusDiagnosticPredicateNames as predicateNames,
  parseHostedMigration0022StatusDiagnosticOutput,
  renderHostedMigration0022StatusDiagnosticSql,
  runHostedMigration0022StatusDiagnosticCli,
} from "./acceptance-hosted-migration-0022-status-diagnostic.mjs";

const caCertificate =
  "-----BEGIN CERTIFICATE-----\n" + "a".repeat(64) + "\n-----END CERTIFICATE-----\n";
const requireFromApi = createRequire(new URL("../apps/api/package.json", import.meta.url));
const { PGlite } = requireFromApi("@electric-sql/pglite");
const expectedPredicateNames = [
  "migration_chain_0021_exact",
  "migration_chain_0022_exact",
  "authority_contract_exact",
  "function_present_exact",
  "function_contract_exact",
  "function_owner_exact",
  "function_security_definer_exact",
  "function_search_path_exact",
  "function_acl_exact",
  "function_source_0014_exact",
  "function_source_0022_exact",
  "pending_state_exact",
  "applied_state_exact",
];

function serialize(values) {
  return `${expectedPredicateNames
    .map((name) => `${name}|${values[name] ? "t" : "f"}`)
    .join("\n")}\n`;
}

function parseDatabaseDiagnostic(results) {
  const rows = results.flatMap((result) => result.rows ?? []);
  const output = `${rows.map((row) => row.diagnostic).join("\n")}\n`;
  return parseHostedMigration0022StatusDiagnosticOutput(output);
}

test("package exposes one fixed 0022 read-only diagnostic", async () => {
  const packageDocument = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  );
  assert.equal(
    packageDocument.scripts["acceptance:hosted:migration:0022:status:diagnose"],
    `node scripts/acceptance-hosted-migration-0022-status-diagnostic.mjs ${hostedMigration0022StatusDiagnosticArgument}`,
  );
  assert.deepEqual(predicateNames, expectedPredicateNames);
});

test("0022 diagnostic parser accepts only exact ordered booleans", () => {
  const applied = Object.fromEntries(expectedPredicateNames.map((name) => [name, true]));
  applied.migration_chain_0021_exact = false;
  applied.function_source_0014_exact = false;
  applied.pending_state_exact = false;
  assert.deepEqual(parseHostedMigration0022StatusDiagnosticOutput(serialize(applied)), {
    finalStatus: "applied_exact",
    predicates: applied,
  });
  for (const output of [
    "",
    serialize(applied).trimEnd(),
    serialize(applied).replace("|t\n", "|true\n"),
    serialize(applied).replace(expectedPredicateNames[0], "private_key"),
    `${serialize(applied)}private_detail|t\n`,
  ]) {
    assert.equal(parseHostedMigration0022StatusDiagnosticOutput(output), null);
  }
});

test("0022 diagnostic SQL is read-only and CLI emits only sanitized verdicts", async () => {
  const sql = renderHostedMigration0022StatusDiagnosticSql();
  assert.match(sql, /^\nBEGIN READ ONLY;/u);
  assert.match(sql, /ROLLBACK;\n$/u);
  assert.doesNotMatch(sql, /^\s*(?:INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|GRANT|REVOKE)\b/mu);

  const applied = Object.fromEntries(expectedPredicateNames.map((name) => [name, true]));
  applied.migration_chain_0021_exact = false;
  applied.function_source_0014_exact = false;
  applied.pending_state_exact = false;
  let stdout = "";
  const code = await runHostedMigration0022StatusDiagnosticCli({
    arguments_: [hostedMigration0022StatusDiagnosticArgument],
    environment: {},
    fetchCaCertificate: async () => caCertificate,
    readPassword: async () => "fictional-administrator-password",
    runDiagnosticQuery: async () => ({
      diagnostic: { finalStatus: "applied_exact", predicates: applied },
      exitClass: "ok",
      outputExact: true,
    }),
    writeError: () => assert.fail("must not emit private infrastructure detail"),
    writeOutput: (value) => {
      stdout += value;
    },
  });
  assert.equal(code, 0);
  assert.equal(
    stdout,
    `status_query_exit_class|ok\nstatus_query_output_exact|t\n${serialize(applied)}final_status|applied_exact\n`,
  );
  assert.doesNotMatch(stdout, /password|certificate|private/u);
});

test("0022 diagnostic distinguishes exact pending, applied, and drifted catalogs", async () => {
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
    for (const filename of migrationFiles.slice(0, 21)) {
      await database.exec(
        await readFile(new URL(`../apps/api/migrations/${filename}`, import.meta.url), "utf8"),
      );
    }
    const versions = [
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
      "20260827010000",
      "20260827020000",
      "20260827030000",
      "20260827040000",
      "20260827050000",
      "20260827060000",
    ];
    await database.exec(`
      CREATE SCHEMA supabase_migrations;
      CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY);
      INSERT INTO supabase_migrations.schema_migrations(version)
      VALUES ${versions.map((version) => `('${version}')`).join(",")};
    `);

    let diagnostic = parseDatabaseDiagnostic(
      await database.exec(renderHostedMigration0022StatusDiagnosticSql()),
    );
    assert.equal(diagnostic.finalStatus, "pending_exact");
    assert.equal(diagnostic.predicates.migration_chain_0021_exact, true);
    assert.equal(diagnostic.predicates.function_source_0014_exact, true);
    assert.equal(diagnostic.predicates.pending_state_exact, true);

    await database.exec(
      await readFile(
        new URL(
          "../apps/api/migrations/0022-password-signup-expired-invitation-recovery.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    await database.exec(`
      INSERT INTO supabase_migrations.schema_migrations(version)
      VALUES ('20260828010000');
    `);
    diagnostic = parseDatabaseDiagnostic(
      await database.exec(renderHostedMigration0022StatusDiagnosticSql()),
    );
    assert.equal(diagnostic.finalStatus, "applied_exact");
    assert.equal(diagnostic.predicates.migration_chain_0022_exact, true);
    assert.equal(diagnostic.predicates.function_source_0022_exact, true);
    assert.equal(diagnostic.predicates.applied_state_exact, true);

    await database.exec(`
      GRANT EXECUTE ON FUNCTION renew_interrupted_password_confirmation(
        text,text,timestamptz
      ) TO authenticated;
    `);
    diagnostic = parseDatabaseDiagnostic(
      await database.exec(renderHostedMigration0022StatusDiagnosticSql()),
    );
    assert.equal(diagnostic.finalStatus, "uncertain");
    assert.equal(diagnostic.predicates.function_acl_exact, false);
    assert.equal(diagnostic.predicates.applied_state_exact, false);
  } finally {
    await database.close();
  }
});
