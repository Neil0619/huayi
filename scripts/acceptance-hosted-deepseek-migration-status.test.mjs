import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";

import {
  hostedDeepseekMigrationStatusAppliedMessage,
  hostedDeepseekMigrationStatusArgument,
  hostedDeepseekMigrationStatusPendingMessage,
  hostedDeepseekMigrationStatusUncertainMessage,
  parseHostedDeepseekMigrationStatusOutput,
  renderHostedDeepseekMigrationStatusSql,
  runHostedDeepseekMigrationStatusCli,
} from "./acceptance-hosted-deepseek-migration-status.mjs";

const caCertificate =
  "-----BEGIN CERTIFICATE-----\n" + "a".repeat(64) + "\n-----END CERTIFICATE-----\n";
const requireFromApi = createRequire(new URL("../apps/api/package.json", import.meta.url));
const { PGlite } = requireFromApi("@electric-sql/pglite");

test("DeepSeek migration status is read-only, exact-chain, and bounded", async () => {
  const sql = renderHostedDeepseekMigrationStatusSql();
  assert.match(sql, /^\nBEGIN READ ONLY;/u);
  assert.match(sql, /20260825010000/u);
  assert.match(sql, /20260827060000/u);
  assert.match(sql, /hosted_acceptance_operations/u);
  assert.match(sql, /hosted_acceptance_cleanup_obligations/u);
  assert.match(sql, /receipt_evidence/u);
  assert.match(sql, /'applied_exact'/u);
  assert.match(sql, /'pending_exact'/u);
  assert.match(sql, /ELSE 'uncertain'/u);
  assert.match(sql, /ROLLBACK;\n$/u);

  assert.equal(parseHostedDeepseekMigrationStatusOutput("applied_exact\n"), "applied_exact");
  assert.equal(parseHostedDeepseekMigrationStatusOutput("pending_exact\n"), "pending_exact");
  assert.equal(parseHostedDeepseekMigrationStatusOutput("uncertain\n"), "uncertain");
  assert.equal(parseHostedDeepseekMigrationStatusOutput("applied_exact\r\n"), null);

  for (const { status, code, message } of [
    { status: "applied_exact", code: 0, message: hostedDeepseekMigrationStatusAppliedMessage },
    { status: "pending_exact", code: 0, message: hostedDeepseekMigrationStatusPendingMessage },
    { status: "uncertain", code: 1, message: hostedDeepseekMigrationStatusUncertainMessage },
  ]) {
    let stdout = "";
    const actualCode = await runHostedDeepseekMigrationStatusCli({
      arguments_: [hostedDeepseekMigrationStatusArgument],
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

test("DeepSeek migration status classifies exact 15-chain pending and 21-chain applied catalogs", async () => {
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
    const readVerdict = async () => {
      const result = await database.exec(renderHostedDeepseekMigrationStatusSql());
      return result[1]?.rows[0]?.case;
    };
    assert.equal(await readVerdict(), "pending_exact");

    for (const [index, filename] of migrationFiles.slice(15, 21).entries()) {
      await database.exec(
        await readFile(new URL(`../apps/api/migrations/${filename}`, import.meta.url), "utf8"),
      );
      await database.query(
        "INSERT INTO supabase_migrations.schema_migrations(version) VALUES ($1)",
        [`202608270${index + 1}0000`],
      );
    }
    assert.equal(await readVerdict(), "applied_exact");

    await database.exec(`
      GRANT huayi_hosted_acceptance_executor TO postgres
      WITH ADMIN TRUE, INHERIT FALSE, SET FALSE;
    `);
    assert.equal(await readVerdict(), "applied_exact");

    await database.exec(`
      GRANT huayi_hosted_acceptance_executor TO postgres WITH SET TRUE;
    `);
    assert.equal(await readVerdict(), "uncertain");
    await database.exec(`
      GRANT huayi_hosted_acceptance_executor TO postgres WITH SET FALSE;
    `);
    assert.equal(await readVerdict(), "applied_exact");

    await database.exec(`
      CREATE ROLE hosted_acceptance_membership_rogue NOLOGIN;
      GRANT huayi_hosted_acceptance_executor TO hosted_acceptance_membership_rogue
      WITH ADMIN FALSE, INHERIT FALSE, SET FALSE;
    `);
    assert.equal(await readVerdict(), "uncertain");
    await database.exec(`
      REVOKE huayi_hosted_acceptance_executor FROM hosted_acceptance_membership_rogue;
    `);
    assert.equal(await readVerdict(), "applied_exact");

    await database.exec("ALTER ROLE huayi_hosted_acceptance_executor SUPERUSER;");
    assert.equal(await readVerdict(), "uncertain");
    await database.exec("ALTER ROLE huayi_hosted_acceptance_executor NOSUPERUSER;");
    assert.equal(await readVerdict(), "applied_exact");

    await database.exec(`
      REVOKE EXECUTE ON FUNCTION
        huayi_private.claim_hosted_acceptance_cleanup(text,text)
      FROM huayi_hosted_acceptance_executor;
    `);
    assert.equal(await readVerdict(), "uncertain");
    await database.exec(`
      GRANT EXECUTE ON FUNCTION
        huayi_private.claim_hosted_acceptance_cleanup(text,text)
      TO huayi_hosted_acceptance_executor;
    `);
    assert.equal(await readVerdict(), "applied_exact");

    await database.exec(`
      ALTER TABLE huayi_private.hosted_acceptance_operations
      DISABLE TRIGGER hosted_acceptance_receipt_evidence_guard;
    `);
    assert.equal(await readVerdict(), "uncertain");
    await database.exec(`
      ALTER TABLE huayi_private.hosted_acceptance_operations
      ENABLE TRIGGER hosted_acceptance_receipt_evidence_guard;
    `);
    assert.equal(await readVerdict(), "applied_exact");

    await database.exec(`
      CREATE ROLE hosted_acceptance_rogue NOLOGIN;
      GRANT SELECT ON huayi_private.hosted_acceptance_operations
      TO hosted_acceptance_rogue;
    `);
    assert.equal(await readVerdict(), "uncertain");
  } finally {
    await database.close();
  }
});
