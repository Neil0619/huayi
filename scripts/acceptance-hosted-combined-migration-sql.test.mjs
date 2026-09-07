import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { hostedCombinedMigrationCatalogSql } from "./acceptance-hosted-combined-migration-catalog.mjs";
import { loadHostedCombinedMigrationSources } from "./acceptance-hosted-combined-migration-sources.mjs";
import {
  renderHostedCombinedMigrationCaptureSql,
  hostedCombinedMigrationRebuildExtraSql,
} from "./acceptance-hosted-combined-migration-sql.mjs";

const requireFromApi = createRequire(new URL("../apps/api/package.json", import.meta.url));
const { PGlite } = requireFromApi("@electric-sql/pglite");

test("combined catalog SQL accepts exact sources and rejects body, ACL, shape, RLS, policy and data drift", async () => {
  const sources = await loadHostedCombinedMigrationSources(process.cwd());
  const db = new PGlite();
  await db.waitReady;
  try {
    await db.exec("CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;");
    for (const migration of sources.migrations) await db.exec(migration.source);
    await db.exec(sources.seed);
    await db.exec(hostedCombinedMigrationRebuildExtraSql);
    for (const mutation of [
      "ALTER FUNCTION public.read_password_signup_state(text) SECURITY INVOKER;",
      "CREATE OR REPLACE FUNCTION public.read_password_signup_state(presented_flow_hash text) RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS 'SELECT NULL::text';",
      "GRANT EXECUTE ON FUNCTION public.purge_error_diagnostics() TO anon;",
      "GRANT EXECUTE ON FUNCTION public.purge_error_diagnostics() TO huayi_context_setter WITH GRANT OPTION;",
      "GRANT SELECT ON public.error_diagnostics TO huayi_context_setter;",
      "GRANT SELECT(event) ON public.error_diagnostics TO huayi_context_setter;",
      "ALTER TABLE public.error_diagnostics NO FORCE ROW LEVEL SECURITY;",
      "CREATE POLICY drift ON public.error_diagnostics USING(true);",
      "DROP INDEX public.error_diagnostics_request;",
      "ALTER TABLE public.error_diagnostics ADD COLUMN drift text;",
      "ALTER TABLE public.error_diagnostics DROP CONSTRAINT error_diagnostics_event_check;",
      "INSERT INTO public.error_diagnostics(id,event) VALUES('00000000-0000-4000-8000-000000000099','{}');",
    ]) {
      await db.exec(`BEGIN;${mutation}`);
      await assert.rejects(db.exec(hostedCombinedMigrationRebuildExtraSql), /combined .* failed/u);
      await db.exec("ROLLBACK;");
      await db.exec(hostedCombinedMigrationRebuildExtraSql);
    }
    assert.doesNotMatch(
      hostedCombinedMigrationCatalogSql,
      /(?:PERFORM|SELECT)\s+public\.purge_error_diagnostics\(/iu,
    );
  } finally {
    await db.close();
  }
});

test("capture SQL checks fixed 25/28 ledger and source statements in a read-only PG17 transaction", async () => {
  const sources = await loadHostedCombinedMigrationSources(process.cwd());
  const pre = renderHostedCombinedMigrationCaptureSql("pre", sources);
  const post = renderHostedCombinedMigrationCaptureSql("post", sources);
  assert.match(pre, /BEGIN READ ONLY;/u);
  assert.match(pre, /10000 <> 17/u);
  assert.match(pre, /9ea90c14b705062f86b6d163742c75e4/u);
  assert.match(pre, /array_agg\(version ORDER BY version\)/u);
  assert.match(post, /statements=ARRAY\[/u);
  assert.ok(post.includes(hostedCombinedMigrationCatalogSql));
  assert.match(post, /storage_objects_zero/u);
  assert.throws(() => renderHostedCombinedMigrationCaptureSql("production", sources));
});

test("capture rejects baseline and post source-ledger drift with executable SQL", async () => {
  const sources = await loadHostedCombinedMigrationSources(process.cwd());
  const db = new PGlite();
  await db.waitReady;
  try {
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
      CREATE SCHEMA storage; CREATE TABLE storage.objects(id text);
      CREATE SCHEMA supabase_migrations;
      CREATE TABLE supabase_migrations.schema_migrations(version text PRIMARY KEY, name text, statements text[]);`);
    const apply = async (migration, index) => {
      await db.exec(migration.source);
      const names = [
        "email_first_password_signup",
        "error_diagnostics",
        "password_recovery_correctable_retry",
      ];
      await db.query("INSERT INTO supabase_migrations.schema_migrations VALUES($1,$2,$3)", [
        migration.version,
        names[index - 25] ?? migration.version,
        [migration.source],
      ]);
    };
    for (const [index, migration] of sources.migrations.slice(0, 25).entries())
      await apply(migration, index);
    const digest = (
      await db.query(
        "SELECT md5(jsonb_agg(jsonb_build_array(version,name,statements) ORDER BY version)::text) AS value FROM supabase_migrations.schema_migrations",
      )
    ).rows[0].value;
    // This test engine is PG18; only its major-version predicate and fictional ledger
    // fingerprint differ. The independent offline pinned-PG17 rebuild uses no SQL substitution.
    const forLocal = (sql) =>
      sql.replace("10000 <> 17", "10000 <> 18").replace("9ea90c14b705062f86b6d163742c75e4", digest);
    const pre = forLocal(renderHostedCombinedMigrationCaptureSql("pre", sources));
    await db.exec(pre);
    await db.exec(
      "UPDATE supabase_migrations.schema_migrations SET name='drift' WHERE version='20260821000000';",
    );
    await assert.rejects(db.exec(pre), /combined capture contract failed/u);
    await db.exec(
      "ROLLBACK;UPDATE supabase_migrations.schema_migrations SET name=version WHERE version='20260821000000';",
    );
    await db.exec(pre);
    for (const [index, migration] of sources.migrations.slice(25).entries())
      await apply(migration, index + 25);
    const post = forLocal(renderHostedCombinedMigrationCaptureSql("post", sources));
    await db.exec(post);
    await assert.rejects(db.exec(pre), /combined capture contract failed/u);
    await db.exec(
      "ROLLBACK;UPDATE supabase_migrations.schema_migrations SET statements=ARRAY['drift'] WHERE version='20260907020000';",
    );
    await assert.rejects(db.exec(post), /combined capture contract failed/u);
    await db.exec("ROLLBACK;");
  } finally {
    await db.close();
  }
});
