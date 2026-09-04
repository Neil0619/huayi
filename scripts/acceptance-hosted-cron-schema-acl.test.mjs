import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";

import { renderHostedCronStatusSql } from "./acceptance-hosted-cron-sql.mjs";
import { hostedAcceptanceMigrationVersionsThrough0023 } from "./acceptance-hosted-foundation.mjs";

const requireFromApi = createRequire(new URL("../apps/api/package.json", import.meta.url));
const { PGlite } = requireFromApi("@electric-sql/pglite");
const migrationsUrl = new URL("../apps/api/migrations/", import.meta.url);

async function createDatabase() {
  const database = new PGlite();
  try {
    await database.waitReady;
    await database.exec(`
      CREATE ROLE anon NOLOGIN;
      CREATE ROLE authenticated NOLOGIN;
      CREATE ROLE service_role NOLOGIN;
      CREATE ROLE unexpected_cron_role NOLOGIN;
    `);
    const filenames = (await readdir(migrationsUrl))
      .filter((filename) => filename.endsWith(".sql"))
      .sort();
    assert.equal(filenames.length, hostedAcceptanceMigrationVersionsThrough0023.length);
    for (const filename of filenames) {
      await database.exec(await readFile(new URL(filename, migrationsUrl), "utf8"));
    }
    return database;
  } catch (error) {
    await database.close();
    throw error;
  }
}

async function schemaAclIsExact(database) {
  // Execute the production predicate against real migration-created catalog ACLs.
  // The surrounding psql/pg_cron probes cannot run inside PGlite.
  const match = /schema_acl AS \(([\s\S]*?)\n\),\nfunction_acl AS \(/u.exec(
    renderHostedCronStatusSql(),
  );
  assert.ok(match, "the production schema ACL predicate must remain in the status query");
  const result = await database.query(`
    WITH schema_acl AS (${match[1]}) SELECT contract_exact FROM schema_acl;
  `);
  return result.rows[0]?.contract_exact;
}

test("Hosted Cron schema ACL gate follows the deployed migration chain", async (context) => {
  const database = await createDatabase();
  try {
    await context.test(
      "accepts the five exact grants after migration 0016 through 0023",
      async () => {
        assert.equal(await schemaAclIsExact(database), true);
      },
    );

    for (const { name, mutation } of [
      {
        name: "rejects the obsolete four-grant schema without executor USAGE",
        mutation: "REVOKE USAGE ON SCHEMA huayi_private FROM huayi_hosted_acceptance_executor;",
      },
      {
        name: "rejects an unknown grantee even at the expected cardinality",
        mutation: `
          REVOKE USAGE ON SCHEMA huayi_private FROM huayi_hosted_acceptance_executor;
          GRANT USAGE ON SCHEMA huayi_private TO unexpected_cron_role;
        `,
      },
      {
        name: "rejects executor CREATE in place of USAGE",
        mutation: `
          REVOKE USAGE ON SCHEMA huayi_private FROM huayi_hosted_acceptance_executor;
          GRANT CREATE ON SCHEMA huayi_private TO huayi_hosted_acceptance_executor;
        `,
      },
      {
        name: "rejects extra executor CREATE",
        mutation: "GRANT CREATE ON SCHEMA huayi_private TO huayi_hosted_acceptance_executor;",
      },
      {
        name: "rejects executor grant option without changing cardinality",
        mutation:
          "GRANT USAGE ON SCHEMA huayi_private TO huayi_hosted_acceptance_executor WITH GRANT OPTION;",
      },
      {
        name: "rejects an additional unknown role",
        mutation: "GRANT USAGE ON SCHEMA huayi_private TO unexpected_cron_role;",
      },
      {
        name: "rejects missing business USAGE",
        mutation: "REVOKE USAGE ON SCHEMA huayi_private FROM huayi_business;",
      },
      {
        name: "rejects missing context-setter USAGE",
        mutation: "REVOKE USAGE ON SCHEMA huayi_private FROM huayi_context_setter;",
      },
      {
        name: "rejects missing owner CREATE",
        mutation: "REVOKE CREATE ON SCHEMA huayi_private FROM postgres;",
      },
      {
        name: "rejects business grant option",
        mutation: "GRANT USAGE ON SCHEMA huayi_private TO huayi_business WITH GRANT OPTION;",
      },
      ...["PUBLIC", "anon", "authenticated", "service_role"].map((role) => ({
        name: `rejects ${role} schema access`,
        mutation: `GRANT USAGE ON SCHEMA huayi_private TO ${role};`,
      })),
    ]) {
      await context.test(name, async () => {
        await database.exec("BEGIN;");
        try {
          await database.exec(mutation);
          assert.equal(await schemaAclIsExact(database), false);
        } finally {
          await database.exec("ROLLBACK;");
        }
      });
    }
  } finally {
    await database.close();
  }
});
