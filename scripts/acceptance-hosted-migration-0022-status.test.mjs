import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";

import {
  hostedMigration0022StatusAppliedMessage,
  hostedMigration0022StatusArgument,
  hostedMigration0022StatusPendingMessage,
  hostedMigration0022StatusUncertainMessage,
  parseHostedMigration0022StatusOutput,
  renderHostedMigration0022StatusSql,
  runHostedMigration0022StatusCli,
  runHostedMigration0022StatusQuery,
} from "./acceptance-hosted-migration-0022-status.mjs";

const caCertificate =
  "-----BEGIN CERTIFICATE-----\n" + "a".repeat(64) + "\n-----END CERTIFICATE-----\n";
const requireFromApi = createRequire(new URL("../apps/api/package.json", import.meta.url));
const { PGlite } = requireFromApi("@electric-sql/pglite");
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

async function createPendingDatabase() {
  const database = new PGlite();
  await database.waitReady;
  await database.exec(`
    CREATE ROLE anon NOLOGIN;
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN;
  `);
  const migrationFiles = (await readdir(new URL("../apps/api/migrations", import.meta.url))).sort();
  for (const filename of migrationFiles.slice(0, 21)) {
    await database.exec(
      await readFile(new URL(`../apps/api/migrations/${filename}`, import.meta.url), "utf8"),
    );
  }
  await database.exec(`
    CREATE SCHEMA supabase_migrations;
    CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY);
    INSERT INTO supabase_migrations.schema_migrations(version)
    VALUES ${versions.map((version) => `('${version}')`).join(",")};
  `);
  return database;
}

async function readVerdict(database) {
  const result = await database.exec(renderHostedMigration0022StatusSql());
  return result[1]?.rows[0]?.case;
}

test("0022 status is read-only and pins chain, authority, function source, and ACL", () => {
  const sql = renderHostedMigration0022StatusSql();
  assert.match(sql, /^\nBEGIN READ ONLY;/u);
  assert.match(sql, /20260827060000/u);
  assert.match(sql, /20260828010000/u);
  assert.match(sql, /hosted_acceptance_operations/u);
  assert.match(sql, /renew_interrupted_password_confirmation/u);
  assert.match(sql, /pg_get_function_arguments/u);
  assert.match(sql, /pg_get_function_result/u);
  assert.match(sql, /language\.lanname = 'plpgsql'/u);
  assert.match(sql, /0db3d5f1b7b31f3998c37bd32f89cc17/u);
  assert.match(sql, /542cb22c148732255513215b331667b1/u);
  assert.match(sql, /huayi_context_setter/u);
  assert.match(sql, /'applied_exact'/u);
  assert.match(sql, /'pending_exact'/u);
  assert.match(sql, /ELSE 'uncertain'/u);
  assert.match(sql, /ROLLBACK;\n$/u);
});

test("0022 status classifies exact pending and applied catalogs and rejects drift", async () => {
  const database = await createPendingDatabase();
  try {
    assert.equal(await readVerdict(database), "pending_exact");

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
    assert.equal(await readVerdict(database), "applied_exact");

    await database.exec(`
      GRANT EXECUTE ON FUNCTION renew_interrupted_password_confirmation(
        text,text,timestamptz
      ) TO authenticated;
    `);
    assert.equal(await readVerdict(database), "uncertain");
    await database.exec(`
      REVOKE EXECUTE ON FUNCTION renew_interrupted_password_confirmation(
        text,text,timestamptz
      ) FROM authenticated;
    `);
    assert.equal(await readVerdict(database), "applied_exact");

    await database.exec(`
      REVOKE EXECUTE ON FUNCTION renew_interrupted_password_confirmation(
        text,text,timestamptz
      ) FROM postgres;
    `);
    assert.equal(await readVerdict(database), "uncertain");
    await database.exec(`
      GRANT EXECUTE ON FUNCTION renew_interrupted_password_confirmation(
        text,text,timestamptz
      ) TO postgres;
    `);
    assert.equal(await readVerdict(database), "applied_exact");

    await database.exec(`
      CREATE OR REPLACE FUNCTION renew_interrupted_password_confirmation(
        invitation_token_hash text,
        new_flow_hash text,
        new_expires_at timestamptz
      ) RETURNS TABLE(account_email text)
      LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
      AS $$ BEGIN RETURN; END; $$;
    `);
    assert.equal(await readVerdict(database), "uncertain");
  } finally {
    await database.close();
  }
});

test("0022 status parser and CLI expose only three fixed verdicts", async () => {
  assert.equal(parseHostedMigration0022StatusOutput("applied_exact\n"), "applied_exact");
  assert.equal(parseHostedMigration0022StatusOutput("pending_exact\n"), "pending_exact");
  assert.equal(parseHostedMigration0022StatusOutput("uncertain\n"), "uncertain");
  assert.equal(parseHostedMigration0022StatusOutput("applied_exact\r\n"), null);

  for (const { status, code, message } of [
    { status: "applied_exact", code: 0, message: hostedMigration0022StatusAppliedMessage },
    { status: "pending_exact", code: 0, message: hostedMigration0022StatusPendingMessage },
    { status: "uncertain", code: 1, message: hostedMigration0022StatusUncertainMessage },
  ]) {
    let stdout = "";
    const actualCode = await runHostedMigration0022StatusCli({
      arguments_: [hostedMigration0022StatusArgument],
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

test("0022 status query pins the transaction pooler, CA, timeout, and exact read-only SQL", async () => {
  let observed;
  const result = await runHostedMigration0022StatusQuery(
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
  assert.equal(observed.input, renderHostedMigration0022StatusSql());
});
