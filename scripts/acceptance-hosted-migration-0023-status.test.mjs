import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";

import {
  hostedAcceptanceMigrationVersionsThrough0022,
  hostedAcceptanceMigrationVersionsThrough0023,
} from "./acceptance-hosted-foundation.mjs";
import {
  hostedMigration0023StatusDiagnosticPredicateNames,
  parseHostedMigration0023StatusDiagnosticOutput,
  renderHostedMigration0023StatusDiagnosticSql,
} from "./acceptance-hosted-migration-0023-status-diagnostic.mjs";
import {
  hostedMigration0023StatusAppliedMessage,
  hostedMigration0023StatusArgument,
  hostedMigration0023StatusPendingMessage,
  hostedMigration0023StatusUncertainMessage,
  parseHostedMigration0023StatusOutput,
  renderHostedMigration0023StatusSql,
  runHostedMigration0023StatusCli,
  runHostedMigration0023StatusQuery,
} from "./acceptance-hosted-migration-0023-status.mjs";

const caCertificate =
  "-----BEGIN CERTIFICATE-----\n" + "a".repeat(64) + "\n-----END CERTIFICATE-----\n";
const requireFromApi = createRequire(new URL("../apps/api/package.json", import.meta.url));
const { PGlite } = requireFromApi("@electric-sql/pglite");
const targetFunctionSignature = `admin_recover_expired_invitation_token(
  uuid,uuid,text,text,text,timestamptz,timestamptz,uuid
)`;

async function createPendingDatabase() {
  const database = new PGlite();
  await database.waitReady;
  await database.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN;
  `);
  const migrationFiles = (await readdir(new URL("../apps/api/migrations", import.meta.url))).sort();
  assert.equal(migrationFiles.length, hostedAcceptanceMigrationVersionsThrough0023.length);
  for (const filename of migrationFiles.slice(0, -1)) {
    await database.exec(
      await readFile(new URL(`../apps/api/migrations/${filename}`, import.meta.url), "utf8"),
    );
  }
  await database.exec(`
    CREATE SCHEMA supabase_migrations;
    CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY);
    INSERT INTO supabase_migrations.schema_migrations(version)
    VALUES ${hostedAcceptanceMigrationVersionsThrough0022
      .map((version) => `('${version}')`)
      .join(",")};
  `);
  return database;
}

async function readStatus(database) {
  const result = await database.exec(renderHostedMigration0023StatusSql());
  return result[1]?.rows[0]?.case;
}

async function readDiagnostic(database) {
  const result = await database.exec(renderHostedMigration0023StatusDiagnosticSql());
  const output = `${result[1]?.rows.map((row) => row["?column?"]).join("\n")}\n`;
  return parseHostedMigration0023StatusDiagnosticOutput(output);
}

test("0023 status pins the exact chain, function contract, authority, source, and ACL", () => {
  const sql = renderHostedMigration0023StatusSql();
  assert.match(sql, /^\nBEGIN READ ONLY;/u);
  assert.match(sql, /20260828010000/u);
  assert.match(sql, /20260831010000/u);
  assert.match(sql, /admin_recover_expired_invitation_token/u);
  assert.match(sql, /pg_get_function_arguments/u);
  assert.match(sql, /pg_get_function_result/u);
  assert.match(sql, /language\.lanname = 'plpgsql'/u);
  assert.match(sql, /23e7d2944441851cfef4eb2521da5c0e/u);
  assert.match(sql, /huayi_context_setter/u);
  assert.match(sql, /'applied_exact'/u);
  assert.match(sql, /'pending_exact'/u);
  assert.match(sql, /ELSE 'uncertain'/u);
  assert.match(sql, /ROLLBACK;\n$/u);
});

test("0023 status and diagnostic classify local pending and applied catalogs and reject drift", async () => {
  const database = await createPendingDatabase();
  try {
    assert.equal(await readStatus(database), "pending_exact");
    assert.equal((await readDiagnostic(database))?.finalStatus, "pending_exact");

    await database.exec(
      await readFile(
        new URL("../apps/api/migrations/0023-invitation-token-recovery.sql", import.meta.url),
        "utf8",
      ),
    );
    await database.exec(`
      INSERT INTO supabase_migrations.schema_migrations(version)
      VALUES ('20260831010000');
    `);
    const appliedDiagnostic = await readDiagnostic(database);
    assert.deepEqual(appliedDiagnostic, {
      finalStatus: "applied_exact",
      predicates: Object.fromEntries(
        hostedMigration0023StatusDiagnosticPredicateNames.map((name) => [
          name,
          name !== "pending_state_exact" && name !== "migration_chain_0022_exact",
        ]),
      ),
    });
    assert.equal(await readStatus(database), "applied_exact");
    assert.deepEqual(
      hostedMigration0023StatusDiagnosticPredicateNames.filter((name) => {
        const expected = name !== "pending_state_exact" && name !== "migration_chain_0022_exact";
        return appliedDiagnostic?.predicates[name] !== expected;
      }),
      [],
    );
    assert.equal(appliedDiagnostic?.predicates.applied_state_exact, true);
    assert.equal(appliedDiagnostic?.predicates.pending_state_exact, false);

    await database.exec(`GRANT EXECUTE ON FUNCTION ${targetFunctionSignature} TO authenticated;`);
    assert.equal(await readStatus(database), "uncertain");
    assert.equal((await readDiagnostic(database))?.predicates.function_acl_exact, false);
    await database.exec(
      `REVOKE EXECUTE ON FUNCTION ${targetFunctionSignature} FROM authenticated;`,
    );
    assert.equal(await readStatus(database), "applied_exact");

    await database.exec(`ALTER FUNCTION ${targetFunctionSignature} OWNER TO authenticated;`);
    assert.equal(await readStatus(database), "uncertain");
    await database.exec(`ALTER FUNCTION ${targetFunctionSignature} OWNER TO postgres;`);
    assert.equal(await readStatus(database), "applied_exact");

    await database.exec(`
      CREATE OR REPLACE FUNCTION admin_recover_expired_invitation_token(
        actor_user_id uuid,
        target_invitation_id uuid,
        idempotency_key text,
        presented_request_hash text,
        new_token_hash text,
        operation_time timestamptz,
        response_expires_at timestamptz,
        audit_id uuid
      ) RETURNS jsonb
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
      AS $$ BEGIN RETURN '{}'::jsonb; END; $$;
    `);
    assert.equal(await readStatus(database), "uncertain");
    assert.equal((await readDiagnostic(database))?.predicates.function_source_0023_exact, false);
  } finally {
    await database.close();
  }
});

test("0023 status parser and CLI expose only three fixed verdicts", async () => {
  assert.equal(parseHostedMigration0023StatusOutput("applied_exact\n"), "applied_exact");
  assert.equal(parseHostedMigration0023StatusOutput("pending_exact\n"), "pending_exact");
  assert.equal(parseHostedMigration0023StatusOutput("uncertain\n"), "uncertain");
  assert.equal(parseHostedMigration0023StatusOutput("applied_exact\r\n"), null);

  for (const { status, code, message } of [
    { status: "applied_exact", code: 0, message: hostedMigration0023StatusAppliedMessage },
    { status: "pending_exact", code: 0, message: hostedMigration0023StatusPendingMessage },
    { status: "uncertain", code: 1, message: hostedMigration0023StatusUncertainMessage },
  ]) {
    let stdout = "";
    const actualCode = await runHostedMigration0023StatusCli({
      arguments_: [hostedMigration0023StatusArgument],
      environment: {},
      fetchCaCertificate: async () => caCertificate,
      readPassword: async () => "fictional-administrator-password",
      runStatusQuery: async () => status,
      writeOutput: (value) => {
        stdout += value;
      },
    });
    assert.equal(actualCode, code);
    assert.equal(stdout, `${message}\n`);
  }
});

test("0023 status query pins the transaction pooler, CA, timeout, and exact read-only SQL", async () => {
  let observed;
  const result = await runHostedMigration0023StatusQuery(
    { administratorPassword: "fictional-administrator-password", caCertificate },
    {
      runPsql: async (options) => {
        observed = options;
        return { code: 0, stderr: "", stdout: "applied_exact\n" };
      },
    },
  );
  assert.equal(result, "applied_exact");
  assert.match(observed.databaseUrl, /:6543\/postgres\?sslmode=verify-full$/u);
  assert.deepEqual(observed.environment, {
    HUAYI_HOSTED_DATABASE_CA_CERTIFICATE: caCertificate,
    PGPASSWORD: "fictional-administrator-password",
  });
  assert.equal(observed.captureOutput, true);
  assert.equal(observed.timeoutMilliseconds, 30_000);
  assert.equal(observed.input, renderHostedMigration0023StatusSql());
});
