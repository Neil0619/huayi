import { pathToFileURL } from "node:url";

import {
  hostedAcceptanceApplicationRole,
  hostedAcceptanceExportBucket,
  hostedAcceptanceMigrationVersions,
  hostedAcceptancePoolerUrl,
  hostedAcceptancePriceVersionIds,
  hostedAcceptanceProjectRef,
  hostedAcceptanceTenantTables,
  requirePostgresPassword,
  runHostedPsql,
  sqlLiteral,
  sqlTextArray,
} from "./acceptance-hosted-foundation.mjs";
import { renderHostedRoleMembershipContractSql } from "./acceptance-hosted-role-memberships.mjs";

export const hostedDiagnosticArgument = `--diagnose-hosted-foundation-${hostedAcceptanceProjectRef}`;

export const hostedDiagnosticPredicateNames = Object.freeze([
  "migration_chain",
  "public_tables",
  "private_tables",
  "migration_roles_safe",
  "runtime_business_member",
  "runtime_context_member",
  "application_role_safe",
  "application_runtime_member",
  "membership_contract_exact",
  "tenant_rls_exact",
  "prices_expected",
  "prices_exact",
  "kill_switch_enabled",
  "runtime_controls_exact",
  "export_bucket_exact",
  "storage_buckets_exact",
  "export_bucket_objects_empty",
  "storage_objects_empty",
  "auth_users_empty",
  "auth_identities_empty",
  "profiles_empty",
  "admin_roles_empty",
  "invitations_empty",
  "invitation_claims_empty",
  "first_operator_empty",
  "migration_0012_columns",
  "migration_0012_constraint",
  "migration_0012_functions",
  "migration_0012_trigger",
  "migration_0013_recovery_function",
  "migration_0013_recovery_acl",
  "migration_0014_bound_identity",
  "migration_0014_resend_function",
  "migration_0014_resend_acl",
]);

function diagnosticPredicates() {
  const migrations = sqlTextArray(hostedAcceptanceMigrationVersions);
  const tenantTables = sqlTextArray(hostedAcceptanceTenantTables);
  const { legacy, offPeak, peak } = hostedAcceptancePriceVersionIds;
  const applicationRole = sqlLiteral(hostedAcceptanceApplicationRole);
  const exportBucket = sqlLiteral(hostedAcceptanceExportBucket);
  return [
    `(SELECT array_agg(version::text ORDER BY version::text)
      FROM supabase_migrations.schema_migrations) = ${migrations}`,
    `(SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r') = 42`,
    `(SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'huayi_private'
        AND c.relname IN ('transaction_owner_context','first_operator_bootstrap')
        AND c.relkind = 'r') = 2`,
    `(SELECT count(*) FROM pg_roles
      WHERE rolname = ANY(ARRAY['huayi_business','huayi_context_setter','huayi_runtime'])
        AND NOT rolcanlogin AND NOT rolsuper AND NOT rolinherit AND NOT rolbypassrls
        AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication) = 3`,
    `pg_has_role('huayi_runtime', 'huayi_business', 'member')`,
    `pg_has_role('huayi_runtime', 'huayi_context_setter', 'member')`,
    `(SELECT count(*) FROM pg_roles
      WHERE rolname = ${applicationRole} AND rolcanlogin
        AND NOT rolsuper AND NOT rolinherit AND NOT rolbypassrls
        AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication) = 1`,
    `pg_has_role(${applicationRole}, 'huayi_runtime', 'member')`,
    renderHostedRoleMembershipContractSql(),
    `(SELECT count(*)
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = ANY(${tenantTables})
        AND c.relkind = 'r' AND c.relrowsecurity AND c.relforcerowsecurity
        AND EXISTS (
          SELECT 1 FROM pg_policy p
          WHERE p.polrelid = c.oid AND p.polname = c.relname || '_owner'
        )) = ${hostedAcceptanceTenantTables.length}`,
    `(SELECT count(*) FROM public.model_price_versions
      WHERE (id, provider, model, input_micro_usd_per_million,
             cached_input_micro_usd_per_million, output_micro_usd_per_million,
             effective_from) IN (
        ('${legacy}', 'deepseek', 'deepseek-v4-flash', 140000, 2800, 280000,
         '2026-08-16T15:59:59Z'::timestamptz),
        ('${offPeak}', 'deepseek', 'deepseek-v4-flash', 220000, 7000, 660000,
         '2026-08-16T16:00:00Z'::timestamptz),
        ('${peak}', 'deepseek', 'deepseek-v4-flash', 440000, 14000, 1320000,
         '2026-08-16T16:00:01Z'::timestamptz)
      )) = 3`,
    `(SELECT count(*) FROM public.model_price_versions) = 3`,
    `COALESCE((SELECT enabled FROM public.runtime_controls
      WHERE name = 'model_kill_switch'), false)`,
    `(SELECT count(*) FROM public.runtime_controls) = 1`,
    `(SELECT count(*) FROM storage.buckets
      WHERE id = ${exportBucket} AND name = ${exportBucket} AND public = false) = 1`,
    `(SELECT count(*) FROM storage.buckets) = 1`,
    `(SELECT count(*) FROM storage.objects WHERE bucket_id = ${exportBucket}) = 0`,
    `(SELECT count(*) FROM storage.objects) = 0`,
    `(SELECT count(*) FROM auth.users) = 0`,
    `(SELECT count(*) FROM auth.identities) = 0`,
    `(SELECT count(*) FROM public.user_profiles) = 0`,
    `(SELECT count(*) FROM public.admin_roles) = 0`,
    `(SELECT count(*) FROM public.invitations) = 0`,
    `(SELECT count(*) FROM public.invitation_claims) = 0`,
    `(SELECT count(*) FROM huayi_private.first_operator_bootstrap) = 0`,
    `(SELECT count(*) FROM pg_attribute
      WHERE attrelid = 'public.invitations'::regclass AND NOT attisdropped
        AND ((attname = 'created_by' AND NOT attnotnull)
          OR (attname = 'created_by_kind' AND attnotnull))) = 2`,
    `EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'public.invitations'::regclass
        AND conname = 'invitations_created_by_kind_check'
    )`,
    `to_regprocedure(
      'huayi_private.issue_first_operator_invitation(uuid,text,timestamptz,timestamptz)'
    ) IS NOT NULL
      AND to_regprocedure(
        'huayi_private.replace_first_operator_invitation(uuid,text,timestamptz,timestamptz)'
      ) IS NOT NULL
      AND to_regprocedure(
        'huayi_private.complete_first_operator_bootstrap(timestamptz)'
      ) IS NOT NULL
      AND to_regprocedure(
        'huayi_private.clear_deleted_first_operator_identity()'
      ) IS NOT NULL`,
    `EXISTS (
      SELECT 1 FROM pg_trigger
      WHERE tgrelid = 'public.user_profiles'::regclass
        AND tgname = 'user_profile_clear_first_operator_identity'
        AND NOT tgisinternal
    )`,
    `to_regprocedure(
      'public.resume_interrupted_password_registration(text,uuid,text,text,integer)'
    ) IS NOT NULL`,
    `has_function_privilege(
      'huayi_context_setter',
      'public.resume_interrupted_password_registration(text,uuid,text,text,integer)',
      'EXECUTE'
    )
      AND NOT has_function_privilege(
        'huayi_business',
        'public.resume_interrupted_password_registration(text,uuid,text,text,integer)',
        'EXECUTE'
      )
      AND NOT has_function_privilege(
        'huayi_runtime',
        'public.resume_interrupted_password_registration(text,uuid,text,text,integer)',
        'EXECUTE'
      )`,
    `EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'invitation_claims'
        AND column_name = 'bound_email'
        AND data_type = 'text'
    )
      AND position(
        'bound_email'
        IN pg_get_functiondef(
          to_regprocedure('public.bind_auth_identity(text,uuid)')
        )
      ) > 0`,
    `to_regprocedure(
      'public.renew_interrupted_password_confirmation(text,text,timestamptz)'
    ) IS NOT NULL`,
    `has_function_privilege(
      'huayi_context_setter',
      'public.renew_interrupted_password_confirmation(text,text,timestamptz)',
      'EXECUTE'
    )
      AND NOT has_function_privilege(
        'huayi_business',
        'public.renew_interrupted_password_confirmation(text,text,timestamptz)',
        'EXECUTE'
      )
      AND NOT has_function_privilege(
        'huayi_runtime',
        'public.renew_interrupted_password_confirmation(text,text,timestamptz)',
        'EXECUTE'
      )`,
  ];
}

export function renderHostedDiagnosticSql() {
  const predicates = diagnosticPredicates();
  if (predicates.length !== hostedDiagnosticPredicateNames.length) {
    throw new Error("Hosted acceptance foundation diagnostic failed.");
  }
  const values = predicates
    .map(
      (predicate, index) =>
        `(${index + 1}, ${sqlLiteral(hostedDiagnosticPredicateNames[index])}, (${predicate}))`,
    )
    .join(",\n    ");
  return `
BEGIN READ ONLY;
WITH predicates(ord, name, ok) AS (
  VALUES
    ${values}
)
SELECT name || '|' || CASE WHEN ok IS TRUE THEN 't' ELSE 'f' END
FROM predicates
ORDER BY ord;
ROLLBACK;
`;
}

function parseDiagnosticOutput(stdout) {
  const lines = stdout.trim().split(/\r?\n/u);
  if (
    lines.length !== hostedDiagnosticPredicateNames.length ||
    lines.some(
      (line, index) =>
        !new RegExp(`^${hostedDiagnosticPredicateNames[index]}\\|[tf]$`, "u").test(line),
    )
  ) {
    throw new Error("Hosted acceptance foundation diagnostic failed.");
  }
  return lines;
}

export async function diagnoseHostedAcceptance({
  arguments_ = process.argv.slice(2),
  environment = process.env,
  runPsql = runHostedPsql,
} = {}) {
  if (arguments_.length !== 1 || arguments_[0] !== hostedDiagnosticArgument) {
    throw new Error("Hosted acceptance foundation diagnostic failed.");
  }
  requirePostgresPassword(environment);
  const result = await runPsql({
    captureOutput: true,
    databaseUrl: hostedAcceptancePoolerUrl,
    environment: {
      HUAYI_HOSTED_DATABASE_CA_CERTIFICATE: environment.HUAYI_HOSTED_DATABASE_CA_CERTIFICATE,
      PGPASSWORD: environment.PGPASSWORD,
    },
    input: renderHostedDiagnosticSql(),
  });
  if (result.code !== 0) {
    throw new Error("Hosted acceptance foundation diagnostic failed.");
  }
  return parseDiagnosticOutput(result.stdout);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  diagnoseHostedAcceptance()
    .then((lines) => process.stdout.write(`${lines.join("\n")}\n`))
    .catch(() => {
      process.stderr.write("Hosted acceptance foundation diagnostic failed.\n");
      process.exitCode = 1;
    });
}
