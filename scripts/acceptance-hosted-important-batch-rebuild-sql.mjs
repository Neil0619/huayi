import { hostedImportantBatchMigrationVersions } from "./acceptance-hosted-important-batch-execution-contract.mjs";

const fictionalUserId = "00000000-0000-4000-8000-000000000047";
const fictionalEmail = "local-acceptance-operator@seen-said.localhost";

export const hostedImportantBatchRebuildBaselineSql = `/* baseline_contract */
SELECT 'baseline_contract|' || CASE WHEN
  to_regclass('auth.users') IS NOT NULL
  AND to_regclass('auth.identities') IS NOT NULL
  AND to_regclass('storage.objects') IS NOT NULL
  AND to_regclass('storage.buckets') IS NOT NULL
  AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_auth_admin')
  AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_storage_admin')
THEN 't' ELSE 'f' END;
`;

export const hostedImportantBatchRebuildMigrationLedgerSql = `/* migration_ledger_contract */
CREATE SCHEMA IF NOT EXISTS supabase_migrations;
CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (
  version text PRIMARY KEY,
  statements text[] NOT NULL DEFAULT ARRAY[]::text[],
  name text
);
DO $$
BEGIN
  IF (SELECT count(*) FROM supabase_migrations.schema_migrations) <> 0 THEN
    RAISE EXCEPTION 'scratch migration ledger is not empty';
  END IF;
END;
$$;
`;

function sqlLiteral(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

export function renderHostedImportantBatchRecordedMigration(migration) {
  return `${migration.source}\nINSERT INTO supabase_migrations.schema_migrations (
  version, statements, name
) VALUES (
  ${sqlLiteral(migration.version)}, ARRAY[]::text[], ${sqlLiteral(migration.version)}
);\n`;
}

export function renderHostedImportantBatchRebuildFinalContractSql() {
  const expectedVersions = hostedImportantBatchMigrationVersions
    .map((version) => `(${sqlLiteral(version)})`)
    .join(",");
  return `/* rebuild_contract */
WITH expected(version) AS (VALUES ${expectedVersions})
SELECT 'migration_chain_exact|' || CASE WHEN
  (SELECT array_agg(version ORDER BY version) FROM supabase_migrations.schema_migrations) =
  (SELECT array_agg(version ORDER BY version) FROM expected)
THEN 't' ELSE 'f' END;
SELECT 'fictional_seed_exact|' || CASE WHEN
  (SELECT count(*) FROM public.user_profiles) = 1
  AND EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE user_id = '${fictionalUserId}' AND owner_user_id = '${fictionalUserId}'
      AND email = '${fictionalEmail}' AND status = 'active'
  )
  AND (SELECT count(*) FROM public.admin_roles) = 1
  AND EXISTS (
    SELECT 1 FROM public.admin_roles
    WHERE user_id = '${fictionalUserId}' AND role = 'operator'
  )
THEN 't' ELSE 'f' END;
SELECT 'hosted_data_absent|' || CASE WHEN
  (SELECT count(*) FROM auth.users) = 0
  AND (SELECT count(*) FROM auth.identities) = 0
  AND (SELECT count(*) FROM storage.objects) = 0
  AND (SELECT count(*) FROM public.invitations) = 0
  AND (SELECT count(*) FROM public.invitation_claims) = 0
  AND NOT EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE user_id <> '${fictionalUserId}' OR email <> '${fictionalEmail}'
  )
THEN 't' ELSE 'f' END;
SELECT 'runtime_contract_exact|' || CASE WHEN
  to_regprocedure('public.renew_interrupted_password_confirmation(text,text,timestamptz)') IS NOT NULL
  AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'huayi_runtime')
  AND EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'huayi_business')
THEN 't' ELSE 'f' END;
`;
}
