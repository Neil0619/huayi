import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";

import {
  parseHostedMigration0014StatusDiagnosticOutput,
  renderHostedMigration0014StatusDiagnosticSql,
} from "./acceptance-hosted-migration-0014-status-diagnostic.mjs";
import { hostedMigration0014StatusDiagnosticPredicateNames as predicateNames } from "./acceptance-hosted-migration-0014-status-diagnostic-sql.mjs";

const requireFromApi = createRequire(new URL("../apps/api/package.json", import.meta.url));
const { PGlite } = requireFromApi("@electric-sql/pglite");
const apiBaselineUrl = new URL(
  "../apps/api/migrations/0001-cloud-v1-foundation.sql",
  import.meta.url,
);
const apiForwardUrl = new URL(
  "../apps/api/migrations/0014-password-signup-otp-resend.sql",
  import.meta.url,
);
const migrationVersionsThrough0013 = [
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

async function createDatabase({ supabaseDefaultGrants = false } = {}) {
  const database = new PGlite();
  await database.waitReady;
  if (supabaseDefaultGrants) {
    await database.exec(`
      CREATE ROLE anon NOLOGIN;
      CREATE ROLE authenticated NOLOGIN;
      CREATE ROLE service_role NOLOGIN;
      ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
        GRANT EXECUTE ON FUNCTIONS TO anon,authenticated,service_role;
    `);
  }
  await database.exec(await readFile(apiBaselineUrl, "utf8"));
  await database.exec(`
    CREATE SCHEMA supabase_migrations;
    CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY);
    INSERT INTO supabase_migrations.schema_migrations(version)
    VALUES ${migrationVersionsThrough0013.map((version) => `('${version}')`).join(",")};
  `);
  return database;
}

function parseDatabaseResult(result) {
  return parseHostedMigration0014StatusDiagnosticOutput(
    result[1].rows.map((row) => row.diagnostic).join("\n") + "\n",
  );
}

test("0014 status diagnostic SQL is read-only and reports fixed catalog predicates", () => {
  const sql = renderHostedMigration0014StatusDiagnosticSql();
  assert.match(sql, /^\nBEGIN READ ONLY;/u);
  assert.match(sql, /20260824010000/u);
  assert.match(sql, /bind_auth_identity\(text,uuid\)/u);
  assert.match(sql, /renew_interrupted_password_confirmation\(text,text,timestamptz\)/u);
  assert.match(sql, /procedure\.prorettype = 'text'::regtype/u);
  assert.match(sql, /aclexplode/u);
  for (const name of predicateNames) assert.match(sql, new RegExp(`'${name}'`, "u"));
  assert.match(sql, /ROLLBACK;\n$/u);
});

test("0014 status diagnostic classifies exact pending, exact applied, and one drift", async () => {
  const database = await createDatabase();
  try {
    assert.deepEqual(
      parseDatabaseResult(await database.exec(renderHostedMigration0014StatusDiagnosticSql())),
      {
        finalStatus: "pending_exact",
        predicates: expectedPending(),
      },
    );

    await database.exec(await readFile(apiForwardUrl, "utf8"));
    await database.exec(
      "INSERT INTO supabase_migrations.schema_migrations(version) VALUES('20260824010000');",
    );
    assert.deepEqual(
      parseDatabaseResult(await database.exec(renderHostedMigration0014StatusDiagnosticSql())),
      {
        finalStatus: "applied_exact",
        predicates: expectedApplied(),
      },
    );

    await database.exec(`
      REVOKE EXECUTE ON FUNCTION renew_interrupted_password_confirmation(
        text,text,timestamptz
      ) FROM huayi_context_setter;
    `);
    const parsed = parseDatabaseResult(
      await database.exec(renderHostedMigration0014StatusDiagnosticSql()),
    );
    assert.equal(parsed.finalStatus, "uncertain");
    assert.equal(parsed.predicates.renew_acl_exact, false);
    assert.equal(parsed.predicates.renew_function_exact, true);
    assert.equal(parsed.predicates.migration_chain_applied_exact, true);
  } finally {
    await database.close();
  }
});

test("0014 status diagnostic isolates Supabase automatic API-role function grants", async () => {
  const database = await createDatabase({ supabaseDefaultGrants: true });
  try {
    await database.exec(await readFile(apiForwardUrl, "utf8"));
    await database.exec(
      "INSERT INTO supabase_migrations.schema_migrations(version) VALUES('20260824010000');",
    );
    const parsed = parseDatabaseResult(
      await database.exec(renderHostedMigration0014StatusDiagnosticSql()),
    );
    assert.notEqual(parsed, null);
    assert.equal(parsed.finalStatus, "uncertain");
    for (const prefix of ["bind", "renew"]) {
      assert.equal(parsed.predicates[`${prefix}_acl_exact`], false);
      assert.equal(parsed.predicates[`${prefix}_setter_effective_execute`], true);
      assert.equal(parsed.predicates[`${prefix}_business_effective_execute_denied`], true);
      assert.equal(parsed.predicates[`${prefix}_runtime_effective_execute_denied`], true);
      assert.equal(parsed.predicates[`${prefix}_owner_direct_execute_exact`], true);
      assert.equal(parsed.predicates[`${prefix}_setter_direct_execute_exact`], true);
      assert.equal(parsed.predicates[`${prefix}_public_direct_execute_absent`], true);
      assert.equal(parsed.predicates[`${prefix}_anon_direct_execute_absent`], false);
      assert.equal(parsed.predicates[`${prefix}_authenticated_direct_execute_absent`], false);
      assert.equal(parsed.predicates[`${prefix}_service_role_direct_execute_absent`], false);
      assert.equal(parsed.predicates[`${prefix}_other_direct_execute_absent`], true);
    }
    assert.equal(parsed.predicates.data_api_roles_present_exact, true);
    assert.equal(parsed.predicates.public_security_definer_present, true);
    assert.equal(parsed.predicates.public_security_definer_public_execute_absent, true);
    assert.equal(parsed.predicates.public_security_definer_api_roles_execute_absent, false);
  } finally {
    await database.close();
  }
});
