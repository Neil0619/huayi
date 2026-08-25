import {
  hostedAcceptanceMigrationVersionsThrough0014,
  sqlTextArray,
} from "./acceptance-hosted-foundation.mjs";

const basePredicateNames = Object.freeze([
  "migration_chain_applied_exact",
  "migration_chain_pending_exact",
  "bound_column_applied_exact",
  "bound_column_pending_exact",
  "bound_check_applied_exact",
  "bound_check_pending_exact",
  "bind_function_applied_exact",
  "bind_function_pending_exact",
  "bind_acl_exact",
  "renew_function_exact",
  "renew_function_absent",
  "renew_acl_exact",
]);
const aclBreakdownSuffixes = Object.freeze([
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
]);
const globalAclPredicateNames = Object.freeze([
  "data_api_roles_present_exact",
  "public_security_definer_present",
  "public_security_definer_public_execute_absent",
  "public_security_definer_api_roles_execute_absent",
]);

export const hostedMigration0014StatusDiagnosticPredicateNames = Object.freeze([
  ...basePredicateNames,
  ...["bind", "renew"].flatMap((prefix) =>
    aclBreakdownSuffixes.map((suffix) => `${prefix}_${suffix}`),
  ),
  ...globalAclPredicateNames,
]);

function renderExactContextSetterAclSql(signature) {
  const procedure = `to_regprocedure('${signature}')`;
  return `COALESCE(
      has_function_privilege('huayi_context_setter', ${procedure}, 'EXECUTE')
        AND NOT has_function_privilege('huayi_business', ${procedure}, 'EXECUTE')
        AND NOT has_function_privilege('huayi_runtime', ${procedure}, 'EXECUTE')
        AND NOT EXISTS (
          SELECT 1
          FROM pg_proc target_procedure,
               LATERAL aclexplode(
                 COALESCE(target_procedure.proacl, acldefault('f', target_procedure.proowner))
               ) privilege
          WHERE target_procedure.oid = ${procedure}
            AND privilege.grantee = 0
            AND privilege.privilege_type = 'EXECUTE'
        )
        AND (
          SELECT count(*) = 2
            AND count(*) FILTER (
              WHERE privilege.grantee = target_procedure.proowner
                AND privilege.is_grantable IS FALSE
            ) = 1
            AND count(*) FILTER (
              WHERE privilege.grantee = (
                SELECT oid FROM pg_roles WHERE rolname = 'huayi_context_setter'
              )
                AND privilege.is_grantable IS FALSE
            ) = 1
          FROM pg_proc target_procedure,
               LATERAL aclexplode(
                 COALESCE(target_procedure.proacl, acldefault('f', target_procedure.proowner))
               ) privilege
          WHERE target_procedure.oid = ${procedure}
            AND privilege.privilege_type = 'EXECUTE'
        ),
      FALSE
    )`;
}

function renderAclBreakdownSql(signature, prefix) {
  const procedure = `to_regprocedure('${signature}')`;
  const aclRows = `
          FROM pg_proc target_procedure
          CROSS JOIN LATERAL aclexplode(
            COALESCE(target_procedure.proacl, acldefault('f', target_procedure.proowner))
          ) privilege
          LEFT JOIN pg_roles grantee_role ON grantee_role.oid = privilege.grantee
          WHERE target_procedure.oid = ${procedure}
            AND privilege.privilege_type = 'EXECUTE'`;
  const directRoleAbsent = (roleName) => `COALESCE(
      ${procedure} IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          ${aclRows}
            AND grantee_role.rolname = '${roleName}'
        ),
      FALSE
    )`;
  return `COALESCE(
      has_function_privilege('huayi_context_setter', ${procedure}, 'EXECUTE'),
      FALSE
    ) AS ${prefix}_setter_effective_execute,
    COALESCE(
      NOT has_function_privilege('huayi_business', ${procedure}, 'EXECUTE'),
      FALSE
    ) AS ${prefix}_business_effective_execute_denied,
    COALESCE(
      NOT has_function_privilege('huayi_runtime', ${procedure}, 'EXECUTE'),
      FALSE
    ) AS ${prefix}_runtime_effective_execute_denied,
    COALESCE((
      SELECT count(*) = 1
        AND count(*) FILTER (
          WHERE privilege.grantee = target_procedure.proowner
            AND privilege.is_grantable IS FALSE
        ) = 1
      ${aclRows}
        AND privilege.grantee = target_procedure.proowner
    ), FALSE) AS ${prefix}_owner_direct_execute_exact,
    COALESCE((
      SELECT count(*) = 1
        AND count(*) FILTER (WHERE privilege.is_grantable IS FALSE) = 1
      ${aclRows}
        AND grantee_role.rolname = 'huayi_context_setter'
    ), FALSE) AS ${prefix}_setter_direct_execute_exact,
    COALESCE(
      ${procedure} IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          ${aclRows}
            AND privilege.grantee = 0
        ),
      FALSE
    ) AS ${prefix}_public_direct_execute_absent,
    ${directRoleAbsent("anon")} AS ${prefix}_anon_direct_execute_absent,
    ${directRoleAbsent("authenticated")} AS ${prefix}_authenticated_direct_execute_absent,
    ${directRoleAbsent("service_role")} AS ${prefix}_service_role_direct_execute_absent,
    COALESCE(
      ${procedure} IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          ${aclRows}
            AND privilege.grantee <> 0
            AND privilege.grantee <> target_procedure.proowner
            AND grantee_role.rolname <> 'huayi_context_setter'
            AND grantee_role.rolname NOT IN ('anon', 'authenticated', 'service_role')
        ),
      FALSE
    ) AS ${prefix}_other_direct_execute_absent`;
}

export function renderHostedMigration0014StatusDiagnosticSql() {
  const appliedMigrations = sqlTextArray(hostedAcceptanceMigrationVersionsThrough0014);
  const pendingMigrations = sqlTextArray(hostedAcceptanceMigrationVersionsThrough0014.slice(0, -1));
  return `
BEGIN READ ONLY;
WITH migration_state AS (
  SELECT array_agg(version::text ORDER BY version::text) AS versions
  FROM supabase_migrations.schema_migrations
), artifact_state AS (
  SELECT
    (SELECT count(*)
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'invitation_claims'
       AND column_name = 'bound_email') = 0 AS bound_column_pending_exact,
    (SELECT count(*)
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'invitation_claims'
       AND column_name = 'bound_email'
       AND data_type = 'text'
       AND udt_schema = 'pg_catalog'
       AND udt_name = 'text'
       AND column_default IS NULL
       AND character_maximum_length IS NULL
       AND is_identity = 'NO'
       AND is_generated = 'NEVER'
       AND is_nullable = 'YES') = 1 AS bound_column_applied_exact,
    (SELECT count(*)
     FROM pg_constraint target_constraint
     WHERE target_constraint.conrelid = 'public.invitation_claims'::regclass
       AND target_constraint.conname = 'invitation_claims_bound_email_check') = 0
      AS bound_check_pending_exact,
    (SELECT count(*) = 1
     FROM pg_constraint target_constraint
     WHERE target_constraint.conrelid = 'public.invitation_claims'::regclass
       AND target_constraint.contype = 'c'
       AND target_constraint.conname = 'invitation_claims_bound_email_check'
       AND target_constraint.conkey = ARRAY[(
         SELECT target_column.attnum
         FROM pg_attribute target_column
         WHERE target_column.attrelid = 'public.invitation_claims'::regclass
           AND target_column.attname = 'bound_email'
           AND NOT target_column.attisdropped
       )]::smallint[]
       AND pg_get_expr(target_constraint.conbin, target_constraint.conrelid) =
         '((bound_email IS NULL) OR (bound_email = lower(bound_email)))')
      AS bound_check_applied_exact,
    (SELECT count(*) = 1
     FROM pg_proc procedure
     JOIN pg_namespace namespace ON namespace.oid = procedure.pronamespace
     WHERE namespace.nspname = 'public'
       AND procedure.proname = 'bind_auth_identity'
       AND procedure.oid = to_regprocedure('public.bind_auth_identity(text,uuid)')
       AND procedure.pronargs = 2
       AND procedure.proargnames = ARRAY[
         'presented_ticket_hash',
         'account_user_id'
       ]::text[]
       AND procedure.prorettype = 'uuid'::regtype
       AND procedure.prosecdef
       AND procedure.proconfig = ARRAY['search_path=pg_catalog']::text[]
       AND position('bound_email' IN pg_get_functiondef(procedure.oid)) > 0)
      AS bind_function_applied_exact,
    (SELECT count(*) = 1
     FROM pg_proc procedure
     JOIN pg_namespace namespace ON namespace.oid = procedure.pronamespace
     WHERE namespace.nspname = 'public'
       AND procedure.proname = 'bind_auth_identity'
       AND procedure.oid = to_regprocedure('public.bind_auth_identity(text,uuid)')
       AND procedure.pronargs = 2
       AND procedure.proargnames = ARRAY[
         'presented_ticket_hash',
         'account_user_id'
       ]::text[]
       AND procedure.prorettype = 'uuid'::regtype
       AND procedure.prosecdef
       AND procedure.proconfig = ARRAY['search_path=pg_catalog']::text[]
       AND position('bound_email' IN pg_get_functiondef(procedure.oid)) = 0)
      AS bind_function_pending_exact,
    ${renderExactContextSetterAclSql("public.bind_auth_identity(text,uuid)")}
      AS bind_acl_exact,
    (SELECT count(*)
     FROM pg_proc procedure
     JOIN pg_namespace namespace ON namespace.oid = procedure.pronamespace
     WHERE namespace.nspname = 'public'
       AND procedure.proname = 'renew_interrupted_password_confirmation') = 0
      AS renew_function_absent,
    (SELECT count(*) = 1
     FROM pg_proc procedure
     JOIN pg_namespace namespace ON namespace.oid = procedure.pronamespace
     WHERE namespace.nspname = 'public'
       AND procedure.proname = 'renew_interrupted_password_confirmation'
       AND procedure.oid = to_regprocedure(
         'public.renew_interrupted_password_confirmation(text,text,timestamptz)'
       )
       AND procedure.pronargs = 3
       AND procedure.proargnames = ARRAY[
         'invitation_token_hash',
         'new_flow_hash',
         'new_expires_at',
         'account_email'
       ]::text[]
       AND procedure.proargmodes = ARRAY['i', 'i', 'i', 't']::"char"[]
       AND procedure.proallargtypes = ARRAY[
         'text'::regtype::oid,
         'text'::regtype::oid,
         'timestamptz'::regtype::oid,
         'text'::regtype::oid
       ]::oid[]
       AND procedure.proretset
       AND procedure.prorettype = 'text'::regtype
       AND procedure.prosecdef
       AND procedure.proconfig = ARRAY['search_path=pg_catalog']::text[])
      AS renew_function_exact,
    ${renderExactContextSetterAclSql(
      "public.renew_interrupted_password_confirmation(text,text,timestamptz)",
    )} AS renew_acl_exact,
    ${renderAclBreakdownSql("public.bind_auth_identity(text,uuid)", "bind")},
    ${renderAclBreakdownSql(
      "public.renew_interrupted_password_confirmation(text,text,timestamptz)",
      "renew",
    )},
    (SELECT count(*) = 3
     FROM pg_roles
     WHERE rolname IN ('anon', 'authenticated', 'service_role'))
      AS data_api_roles_present_exact,
    EXISTS (
      SELECT 1
      FROM pg_proc procedure
      JOIN pg_namespace namespace ON namespace.oid = procedure.pronamespace
      WHERE namespace.nspname = 'public'
        AND procedure.prosecdef
    ) AS public_security_definer_present,
    NOT EXISTS (
      SELECT 1
      FROM pg_proc procedure
      JOIN pg_namespace namespace ON namespace.oid = procedure.pronamespace
      CROSS JOIN LATERAL aclexplode(
        COALESCE(procedure.proacl, acldefault('f', procedure.proowner))
      ) privilege
      WHERE namespace.nspname = 'public'
        AND procedure.prosecdef
        AND privilege.privilege_type = 'EXECUTE'
        AND privilege.grantee = 0
    ) AS public_security_definer_public_execute_absent,
    NOT EXISTS (
      SELECT 1
      FROM pg_proc procedure
      JOIN pg_namespace namespace ON namespace.oid = procedure.pronamespace
      CROSS JOIN LATERAL aclexplode(
        COALESCE(procedure.proacl, acldefault('f', procedure.proowner))
      ) privilege
      JOIN pg_roles grantee_role ON grantee_role.oid = privilege.grantee
      WHERE namespace.nspname = 'public'
        AND procedure.prosecdef
        AND privilege.privilege_type = 'EXECUTE'
        AND grantee_role.rolname IN ('anon', 'authenticated', 'service_role')
    ) AS public_security_definer_api_roles_execute_absent
), diagnostic_state AS (
  SELECT
    migration_state.versions = ${appliedMigrations} AS migration_chain_applied_exact,
    migration_state.versions = ${pendingMigrations} AS migration_chain_pending_exact,
    artifact_state.*
  FROM migration_state
  CROSS JOIN artifact_state
)
SELECT diagnostic.name || '|' || CASE WHEN diagnostic.value THEN 't' ELSE 'f' END
  AS diagnostic
FROM diagnostic_state,
LATERAL (VALUES
${hostedMigration0014StatusDiagnosticPredicateNames
  .map((name, index) => `  (${index + 1}, '${name}', ${name})`)
  .join(",\n")}
) diagnostic(ordinal, name, value)
ORDER BY diagnostic.ordinal;
ROLLBACK;
`;
}
