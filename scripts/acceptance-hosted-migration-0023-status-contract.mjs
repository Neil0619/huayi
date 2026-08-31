import {
  hostedAcceptanceMigrationVersionsThrough0022,
  hostedAcceptanceMigrationVersionsThrough0023,
  sqlTextArray,
} from "./acceptance-hosted-foundation.mjs";
import { renderHostedMigration0022StateCtes } from "./acceptance-hosted-migration-0022-status-contract.mjs";

const appliedFunctionSourceMd5 = "23e7d2944441851cfef4eb2521da5c0e";

export const hostedMigration0023StatusPredicateNames = Object.freeze([
  "migration_chain_0022_exact",
  "migration_chain_0023_exact",
  "phase92_contract_exact",
  "function_present_exact",
  "function_contract_exact",
  "function_owner_exact",
  "function_security_definer_exact",
  "function_search_path_exact",
  "function_acl_exact",
  "function_source_0023_exact",
  "pending_state_exact",
  "applied_state_exact",
]);

export function renderHostedMigration0023StateCtes() {
  return `phase92_contract AS (
  WITH ${renderHostedMigration0022StateCtes()}
  SELECT authority_contract_exact
    AND function_present_exact
    AND function_contract_exact
    AND function_owner_exact
    AND function_security_definer_exact
    AND function_search_path_exact
    AND function_acl_exact
    AND function_source_0022_exact AS exact
  FROM status_state
), migration_state AS (
  SELECT COALESCE(array_agg(version::text ORDER BY version::text), ARRAY[]::text[]) AS versions
  FROM supabase_migrations.schema_migrations
), target_function AS (
  SELECT procedure.*
  FROM pg_proc AS procedure
  WHERE procedure.oid = to_regprocedure(
    'public.admin_recover_expired_invitation_token(uuid,uuid,text,text,text,timestamptz,timestamptz,uuid)'
  )
), target_function_state AS (
  SELECT
    count(*) = 1 AS function_present_exact,
    count(*) = 1 AND bool_and(
      target_function.prokind = 'f'
      AND language.lanname = 'plpgsql'
      AND pg_get_function_arguments(target_function.oid) =
        'actor_user_id uuid, target_invitation_id uuid, idempotency_key text, presented_request_hash text, new_token_hash text, operation_time timestamp with time zone, response_expires_at timestamp with time zone, audit_id uuid'
      AND pg_get_function_result(target_function.oid) = 'jsonb'
    ) AS function_contract_exact,
    count(*) = 1 AND bool_and(
      target_function.proowner = (SELECT oid FROM pg_roles WHERE rolname = 'postgres')
    ) AS function_owner_exact,
    count(*) = 1 AND bool_and(target_function.prosecdef) AS function_security_definer_exact,
    count(*) = 1 AND bool_and(
      target_function.proconfig = ARRAY['search_path=pg_catalog']::text[]
    ) AS function_search_path_exact,
    count(*) = 1 AND bool_and(md5(target_function.prosrc) = '${appliedFunctionSourceMd5}')
      AS function_source_0023_exact,
    count(*) = 1 AND bool_and(
      COALESCE(has_function_privilege(
        (SELECT oid FROM pg_roles WHERE rolname = 'huayi_context_setter'),
        target_function.oid,'EXECUTE'
      ),false)
      AND NOT EXISTS (
        SELECT 1
        FROM aclexplode(COALESCE(
          target_function.proacl,acldefault('f',target_function.proowner)
        )) AS privilege
        WHERE privilege.privilege_type = 'EXECUTE'
          AND privilege.grantee <> target_function.proowner
          AND privilege.grantee <> COALESCE(
            (SELECT oid FROM pg_roles WHERE rolname = 'huayi_context_setter'),0
          )
      )
    ) AS function_acl_exact
  FROM target_function
  JOIN pg_language AS language ON language.oid = target_function.prolang
), status_state AS (
  SELECT
    migration_state.versions = ${sqlTextArray(hostedAcceptanceMigrationVersionsThrough0022)}
      AS migration_chain_0022_exact,
    migration_state.versions = ${sqlTextArray(hostedAcceptanceMigrationVersionsThrough0023)}
      AS migration_chain_0023_exact,
    phase92_contract.exact AS phase92_contract_exact,
    target_function_state.*,
    migration_state.versions = ${sqlTextArray(hostedAcceptanceMigrationVersionsThrough0022)}
      AND phase92_contract.exact
      AND NOT target_function_state.function_present_exact AS pending_state_exact,
    migration_state.versions = ${sqlTextArray(hostedAcceptanceMigrationVersionsThrough0023)}
      AND phase92_contract.exact
      AND target_function_state.function_present_exact
      AND target_function_state.function_contract_exact
      AND target_function_state.function_owner_exact
      AND target_function_state.function_security_definer_exact
      AND target_function_state.function_search_path_exact
      AND target_function_state.function_acl_exact
      AND target_function_state.function_source_0023_exact AS applied_state_exact
  FROM migration_state
  CROSS JOIN phase92_contract
  CROSS JOIN target_function_state
)`;
}
