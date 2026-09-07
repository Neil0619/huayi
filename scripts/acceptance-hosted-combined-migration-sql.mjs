import { hostedCombinedMigrationArtifactContract } from "./acceptance-hosted-important-batch-contracts.mjs";
import { assertHostedCombinedMigrationSources } from "./acceptance-hosted-combined-migration-sources.mjs";
import { hostedCombinedMigrationCatalogSql } from "./acceptance-hosted-combined-migration-catalog.mjs";

const quote = (value) => `'${value.replaceAll("'", "''")}'`;
const versions = (values) => `ARRAY[${values.map(quote).join(",")}]::text[]`;
const baseline = hostedCombinedMigrationArtifactContract.migrationVersions.slice(0, 25);
const baselineLedger = `(SELECT md5(jsonb_agg(jsonb_build_array(version,name,statements) ORDER BY version)::text) FROM supabase_migrations.schema_migrations WHERE version=ANY(${versions(baseline)}))='9ea90c14b705062f86b6d163742c75e4'`;

export function renderHostedCombinedMigrationCaptureSql(phase, sources) {
  if (phase !== "pre" && phase !== "post") throw new Error("Invalid fixed capture phase.");
  assertHostedCombinedMigrationSources(sources);
  const expected =
    phase === "pre" ? baseline : hostedCombinedMigrationArtifactContract.migrationVersions;
  const sourceLedger = sources.migrations
    .slice(25)
    .map((migration, index) => {
      const name = hostedCombinedMigrationArtifactContract.migrationFiles[index + 25].slice(15, -4);
      return `(SELECT count(*)=1 AND bool_and(name=${quote(name)} AND statements=ARRAY[${quote(migration.source)}]) FROM supabase_migrations.schema_migrations WHERE version=${quote(migration.version)})`;
    })
    .join(" AND ");
  return `/* combined_migration_capture_contract */
BEGIN READ ONLY;
SET LOCAL statement_timeout='20s';
SET LOCAL lock_timeout='5s';
DO $combined_capture$
BEGIN
  IF current_user <> 'postgres' OR current_database() <> 'postgres'
    OR current_setting('server_version_num')::integer / 10000 <> 17
    OR ((SELECT array_agg(version ORDER BY version) FROM supabase_migrations.schema_migrations) = ${versions(expected)}) IS DISTINCT FROM true
    OR (${baselineLedger}) IS DISTINCT FROM true
    ${phase === "post" ? `OR (${sourceLedger}) IS DISTINCT FROM true` : ""}
  THEN RAISE EXCEPTION 'combined capture contract failed'; END IF;
END;
$combined_capture$;
${phase === "post" ? hostedCombinedMigrationCatalogSql : ""}
SELECT 'migration_head|' || COALESCE(max(version), '') FROM supabase_migrations.schema_migrations;
SELECT 'storage_objects_zero|' || CASE WHEN count(*) = 0 THEN 't' ELSE 'f' END FROM storage.objects;
ROLLBACK;
`;
}

// Extra application tables added after the historical rebuild contract must remain empty.
export const hostedCombinedMigrationRebuildExtraSql = `/* combined_migration_rebuild_contract */
${hostedCombinedMigrationCatalogSql}
DO $combined_absence$
BEGIN
  IF EXISTS (SELECT 1 FROM public.error_diagnostics)
    OR EXISTS (SELECT 1 FROM public.learning_tasks)
    OR EXISTS (SELECT 1 FROM public.learning_task_submission_keys)
    OR EXISTS (SELECT 1 FROM public.learning_task_events)
    OR EXISTS (SELECT 1 FROM public.practice_sessions)
  THEN RAISE EXCEPTION 'combined rebuild data absence failed'; END IF;
END;
$combined_absence$;
`;
