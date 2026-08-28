import { renderHostedDeepseekExecutorMembershipContractSql } from "./acceptance-hosted-deepseek-executor-membership.mjs";
import {
  hostedAcceptanceMigrationVersions,
  hostedAcceptanceMigrationVersionsThrough0021,
  sqlTextArray,
} from "./acceptance-hosted-foundation.mjs";
const previousFunctionSourceMd5 = "0db3d5f1b7b31f3998c37bd32f89cc17";
const appliedFunctionSourceMd5 = "542cb22c148732255513215b331667b1";
const privateFunctionSignatures = Object.freeze([
  "huayi_private.arm_hosted_acceptance_cleanup(uuid,bigint,text,text)",
  "huayi_private.bind_hosted_acceptance_request(uuid,bigint,text,uuid,uuid,text,text)",
  "huayi_private.claim_hosted_acceptance_cleanup(text,text)",
  "huayi_private.claim_hosted_acceptance_operation(uuid,text,text,bigint,text,text,text,text,text,text,integer,text)",
  "huayi_private.complete_hosted_acceptance_cleanup(uuid,bigint,text,timestamp with time zone)",
  "huayi_private.complete_hosted_acceptance_operation(uuid,bigint,text,text,text)",
  "huayi_private.effective_model_kill_switch_enabled()",
  "huayi_private.enforce_hosted_acceptance_cleanup_state()",
  "huayi_private.enforce_hosted_acceptance_operation_state()",
  "huayi_private.enforce_hosted_acceptance_receipt_evidence()",
  "huayi_private.hosted_acceptance_token_hash(text)",
  "huayi_private.mark_hosted_acceptance_dispatch(uuid,bigint,text,text)",
  "huayi_private.read_and_freeze_hosted_acceptance_settlement(uuid,bigint,text,uuid)",
  "huayi_private.read_hosted_acceptance_status()",
  "huayi_private.reconcile_and_bind_hosted_acceptance_request(uuid,bigint,text,uuid,text,text)",
  "huayi_private.record_hosted_acceptance_settlement(uuid,bigint,text,uuid)",
  "huayi_private.retain_hosted_acceptance_evidence(integer)",
]);
const nonExecutorFunctionSignatures = new Set([
  "huayi_private.effective_model_kill_switch_enabled()",
  "huayi_private.enforce_hosted_acceptance_cleanup_state()",
  "huayi_private.enforce_hosted_acceptance_operation_state()",
  "huayi_private.enforce_hosted_acceptance_receipt_evidence()",
  "huayi_private.hosted_acceptance_token_hash(text)",
]);
const executorFunctionSignatures = Object.freeze(
  privateFunctionSignatures.filter((signature) => !nonExecutorFunctionSignatures.has(signature)),
);

export const hostedMigration0022StatusPredicateNames = Object.freeze([
  "migration_chain_0021_exact",
  "migration_chain_0022_exact",
  "authority_contract_exact",
  "function_present_exact",
  "function_contract_exact",
  "function_owner_exact",
  "function_security_definer_exact",
  "function_search_path_exact",
  "function_acl_exact",
  "function_source_0014_exact",
  "function_source_0022_exact",
  "pending_state_exact",
  "applied_state_exact",
]);

export function renderHostedMigration0022StateCtes() {
  const expectedFunctions = sqlTextArray(privateFunctionSignatures);
  const executorFunctions = sqlTextArray(executorFunctionSignatures);
  const executorMembershipContract = renderHostedDeepseekExecutorMembershipContractSql();
  const versionsThrough0021 = sqlTextArray(hostedAcceptanceMigrationVersionsThrough0021);
  const versionsThrough0022 = sqlTextArray(hostedAcceptanceMigrationVersions);
  return `migration_state AS (
  SELECT COALESCE(array_agg(version::text ORDER BY version::text), ARRAY[]::text[]) AS versions
  FROM supabase_migrations.schema_migrations
), expected_functions AS (
  SELECT
    signature,
    to_regprocedure(signature) AS function_oid,
    signature = ANY(${executorFunctions}) AS executor_should_execute
  FROM unnest(${expectedFunctions}) signature
), role_state AS (
  SELECT count(*) = 1
    AND bool_and(
      NOT role_entry.rolsuper
      AND NOT role_entry.rolinherit
      AND NOT role_entry.rolcreaterole
      AND NOT role_entry.rolcreatedb
      AND NOT role_entry.rolcanlogin
      AND NOT role_entry.rolreplication
      AND NOT role_entry.rolbypassrls
      AND ${executorMembershipContract}
    ) AS exact
  FROM pg_roles role_entry
  WHERE role_entry.rolname = 'huayi_hosted_acceptance_executor'
), schema_state AS (
  SELECT count(*) = 1
    AND bool_and(namespace.nspowner = (SELECT oid FROM pg_roles WHERE rolname = 'postgres'))
    AS exact
  FROM pg_namespace namespace
  WHERE namespace.nspname = 'huayi_private'
), relation_state AS (
  SELECT count(*) = 2
    AND bool_and(
      relation.relowner = (SELECT oid FROM pg_roles WHERE rolname = 'postgres')
      AND relation.relrowsecurity
      AND relation.relforcerowsecurity
    ) AS exact
  FROM pg_class relation
  JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
  WHERE namespace.nspname = 'huayi_private'
    AND relation.relname IN (
      'hosted_acceptance_operations',
      'hosted_acceptance_cleanup_obligations'
    )
    AND relation.relkind = 'r'
), receipt_state AS (
  SELECT count(*) = 1
    AND bool_and(attribute.atttypid = 'jsonb'::regtype AND NOT attribute.attisdropped) AS exact
  FROM pg_attribute attribute
  WHERE attribute.attrelid = to_regclass('huayi_private.hosted_acceptance_operations')
    AND attribute.attname = 'receipt_evidence'
), constraint_state AS (
  SELECT count(*) = 1 AND bool_and(constraint_entry.convalidated) AS exact
  FROM pg_constraint constraint_entry
  WHERE constraint_entry.conrelid = to_regclass('huayi_private.hosted_acceptance_operations')
    AND constraint_entry.conname = 'hosted_acceptance_receipt_evidence_shape'
    AND constraint_entry.contype = 'c'
), authority_function_state AS (
  SELECT count(*) = ${privateFunctionSignatures.length}
    AND bool_and(function_oid IS NOT NULL)
    AND bool_and(procedure.proowner = (SELECT oid FROM pg_roles WHERE rolname = 'postgres'))
    AND bool_and(procedure.prosecdef)
    AND bool_and(
      'search_path=pg_catalog, huayi_private' = ANY(
        COALESCE(procedure.proconfig, ARRAY[]::text[])
      )
    ) AS exact
  FROM expected_functions
  LEFT JOIN pg_proc procedure ON procedure.oid = function_oid
), executor_function_acl AS (
  SELECT count(*) = ${privateFunctionSignatures.length}
    AND bool_and(
      COALESCE(
        has_function_privilege(
          (SELECT oid FROM pg_roles WHERE rolname = 'huayi_hosted_acceptance_executor'),
          function_oid,
          'EXECUTE'
        ),
        false
      ) = executor_should_execute
    ) AS exact
  FROM expected_functions
), unexpected_function_acl AS (
  SELECT NOT EXISTS (
    SELECT 1
    FROM expected_functions
    JOIN pg_proc procedure ON procedure.oid = function_oid
    CROSS JOIN LATERAL aclexplode(
      COALESCE(procedure.proacl, acldefault('f', procedure.proowner))
    ) privilege
    WHERE privilege.privilege_type = 'EXECUTE'
      AND privilege.grantee <> procedure.proowner
      AND privilege.grantee <> COALESCE(
        (SELECT oid FROM pg_roles WHERE rolname = 'huayi_hosted_acceptance_executor'),
        0
      )
  ) AS exact
), executor_schema_acl AS (
  SELECT
    COALESCE(
      has_schema_privilege(
        (SELECT oid FROM pg_roles WHERE rolname = 'huayi_hosted_acceptance_executor'),
        'huayi_private',
        'USAGE'
      ),
      false
    )
    AND NOT COALESCE(
      has_schema_privilege(
        (SELECT oid FROM pg_roles WHERE rolname = 'huayi_hosted_acceptance_executor'),
        'huayi_private',
        'CREATE'
      ),
      false
    ) AS exact
), trigger_state AS (
  SELECT count(*) = 3
    AND bool_and(trigger_entry.tgenabled = 'O')
    AND bool_and(
      CASE trigger_entry.tgname
        WHEN 'hosted_acceptance_operation_state_guard' THEN
          relation.relname = 'hosted_acceptance_operations'
          AND trigger_entry.tgtype = 23
          AND trigger_entry.tgfoid =
            to_regprocedure('huayi_private.enforce_hosted_acceptance_operation_state()')
        WHEN 'hosted_acceptance_cleanup_state_guard' THEN
          relation.relname = 'hosted_acceptance_cleanup_obligations'
          AND trigger_entry.tgtype = 19
          AND trigger_entry.tgfoid =
            to_regprocedure('huayi_private.enforce_hosted_acceptance_cleanup_state()')
        WHEN 'hosted_acceptance_receipt_evidence_guard' THEN
          relation.relname = 'hosted_acceptance_operations'
          AND trigger_entry.tgtype = 19
          AND trigger_entry.tgfoid =
            to_regprocedure('huayi_private.enforce_hosted_acceptance_receipt_evidence()')
        ELSE false
      END
    ) AS exact
  FROM pg_trigger trigger_entry
  JOIN pg_class relation ON relation.oid = trigger_entry.tgrelid
  JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
  WHERE namespace.nspname = 'huayi_private'
    AND NOT trigger_entry.tgisinternal
    AND trigger_entry.tgname IN (
      'hosted_acceptance_operation_state_guard',
      'hosted_acceptance_cleanup_state_guard',
      'hosted_acceptance_receipt_evidence_guard'
    )
), unexpected_table_acl AS (
  SELECT NOT EXISTS (
    SELECT 1
    FROM pg_class relation
    JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
    CROSS JOIN LATERAL aclexplode(
      COALESCE(relation.relacl, acldefault('r', relation.relowner))
    ) privilege
    WHERE namespace.nspname = 'huayi_private'
      AND relation.relname IN (
        'hosted_acceptance_operations',
        'hosted_acceptance_cleanup_obligations'
      )
      AND relation.relkind = 'r'
      AND privilege.grantee <> relation.relowner
  ) AS exact
), external_function_acl AS (
  SELECT NOT EXISTS (
    SELECT 1
    FROM expected_functions
    CROSS JOIN pg_roles role
    WHERE role.rolname IN (
      'anon', 'authenticated', 'service_role',
      'huayi_business', 'huayi_context_setter', 'huayi_runtime'
    )
      AND COALESCE(has_function_privilege(role.oid, function_oid, 'EXECUTE'), false)
  ) AS exact
), external_table_acl AS (
  SELECT NOT EXISTS (
    SELECT 1
    FROM pg_roles role
    CROSS JOIN unnest(ARRAY[
      'huayi_private.hosted_acceptance_operations',
      'huayi_private.hosted_acceptance_cleanup_obligations'
    ]::text[]) relation_name
    WHERE role.rolname IN (
      'anon', 'authenticated', 'service_role', 'huayi_business',
      'huayi_context_setter', 'huayi_runtime', 'huayi_hosted_acceptance_executor'
    )
      AND COALESCE(
        has_table_privilege(
          role.oid,
          to_regclass(relation_name),
          'SELECT,INSERT,UPDATE,DELETE'
        ),
        false
      )
  ) AS exact
), authority_state AS (
  SELECT
    role_state.exact
    AND schema_state.exact
    AND relation_state.exact
    AND receipt_state.exact
    AND constraint_state.exact
    AND authority_function_state.exact
    AND executor_function_acl.exact
    AND unexpected_function_acl.exact
    AND executor_schema_acl.exact
    AND trigger_state.exact
    AND unexpected_table_acl.exact
    AND external_function_acl.exact
    AND external_table_acl.exact AS exact
  FROM role_state
  CROSS JOIN schema_state
  CROSS JOIN relation_state
  CROSS JOIN receipt_state
  CROSS JOIN constraint_state
  CROSS JOIN authority_function_state
  CROSS JOIN executor_function_acl
  CROSS JOIN unexpected_function_acl
  CROSS JOIN executor_schema_acl
  CROSS JOIN trigger_state
  CROSS JOIN unexpected_table_acl
  CROSS JOIN external_function_acl
  CROSS JOIN external_table_acl
), target_function AS (
  SELECT procedure.*
  FROM pg_proc procedure
  WHERE procedure.oid = to_regprocedure(
    'public.renew_interrupted_password_confirmation(text,text,timestamptz)'
  )
), target_function_state AS (
  SELECT
    count(*) = 1 AS function_present_exact,
    count(*) = 1
      AND bool_and(
        target_function.prokind = 'f'
        AND language.lanname = 'plpgsql'
        AND pg_get_function_arguments(target_function.oid) =
          'invitation_token_hash text, new_flow_hash text, new_expires_at timestamp with time zone'
        AND pg_get_function_result(target_function.oid) = 'TABLE(account_email text)'
      ) AS function_contract_exact,
    count(*) = 1
      AND bool_and(proowner = (SELECT oid FROM pg_roles WHERE rolname = 'postgres'))
      AS function_owner_exact,
    count(*) = 1 AND bool_and(prosecdef) AS function_security_definer_exact,
    count(*) = 1
      AND bool_and(proconfig = ARRAY['search_path=pg_catalog']::text[])
      AS function_search_path_exact,
    count(*) = 1
      AND bool_and(md5(prosrc) = '${previousFunctionSourceMd5}')
      AS function_source_0014_exact,
    count(*) = 1
      AND bool_and(md5(prosrc) = '${appliedFunctionSourceMd5}')
      AS function_source_0022_exact,
    count(*) = 1
      AND bool_and(
        EXISTS (
          SELECT 1
          FROM aclexplode(COALESCE(proacl, acldefault('f', proowner))) privilege
          WHERE privilege.privilege_type = 'EXECUTE'
            AND privilege.grantee = proowner
        )
        AND EXISTS (
          SELECT 1
          FROM aclexplode(COALESCE(proacl, acldefault('f', proowner))) privilege
          WHERE privilege.privilege_type = 'EXECUTE'
            AND privilege.grantee = COALESCE(
              (SELECT oid FROM pg_roles WHERE rolname = 'huayi_context_setter'), 0
            )
        )
        AND
        COALESCE(has_function_privilege(
          (SELECT oid FROM pg_roles WHERE rolname = 'huayi_context_setter'),
          target_function.oid,
          'EXECUTE'
        ), false)
        AND NOT COALESCE(has_function_privilege(
          (SELECT oid FROM pg_roles WHERE rolname = 'anon'), target_function.oid, 'EXECUTE'
        ), false)
        AND NOT COALESCE(has_function_privilege(
          (SELECT oid FROM pg_roles WHERE rolname = 'authenticated'),
          target_function.oid,
          'EXECUTE'
        ), false)
        AND NOT COALESCE(has_function_privilege(
          (SELECT oid FROM pg_roles WHERE rolname = 'service_role'),
          target_function.oid,
          'EXECUTE'
        ), false)
        AND NOT COALESCE(has_function_privilege(
          (SELECT oid FROM pg_roles WHERE rolname = 'huayi_business'),
          target_function.oid,
          'EXECUTE'
        ), false)
        AND NOT COALESCE(has_function_privilege(
          (SELECT oid FROM pg_roles WHERE rolname = 'huayi_runtime'),
          target_function.oid,
          'EXECUTE'
        ), false)
        AND NOT EXISTS (
          SELECT 1
          FROM aclexplode(COALESCE(proacl, acldefault('f', proowner))) privilege
          WHERE privilege.privilege_type = 'EXECUTE'
            AND privilege.grantee <> proowner
            AND privilege.grantee <> COALESCE(
              (SELECT oid FROM pg_roles WHERE rolname = 'huayi_context_setter'), 0
            )
        )
      ) AS function_acl_exact
  FROM target_function
  JOIN pg_language language ON language.oid = target_function.prolang
), status_state AS (
  SELECT
    migration_state.versions = ${versionsThrough0021} AS migration_chain_0021_exact,
    migration_state.versions = ${versionsThrough0022} AS migration_chain_0022_exact,
    authority_state.exact AS authority_contract_exact,
    target_function_state.*,
    migration_state.versions = ${versionsThrough0021}
      AND authority_state.exact
      AND target_function_state.function_present_exact
      AND target_function_state.function_contract_exact
      AND target_function_state.function_owner_exact
      AND target_function_state.function_security_definer_exact
      AND target_function_state.function_search_path_exact
      AND target_function_state.function_acl_exact
      AND target_function_state.function_source_0014_exact AS pending_state_exact,
    migration_state.versions = ${versionsThrough0022}
      AND authority_state.exact
      AND target_function_state.function_present_exact
      AND target_function_state.function_contract_exact
      AND target_function_state.function_owner_exact
      AND target_function_state.function_security_definer_exact
      AND target_function_state.function_search_path_exact
      AND target_function_state.function_acl_exact
      AND target_function_state.function_source_0022_exact AS applied_state_exact
  FROM migration_state
  CROSS JOIN authority_state
  CROSS JOIN target_function_state
)`;
}
