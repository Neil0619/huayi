import {
  hostedDeepseekMigrationStatusDiagnosticAggregatePredicateNames as aggregatePredicateNames,
  hostedDeepseekMigrationStatusDiagnosticCatalogPredicateNames as catalogPredicateNames,
  hostedDeepseekMigrationStatusDiagnosticFunctionDefinitions as functionDefinitions,
  hostedDeepseekMigrationStatusDiagnosticFunctionPredicateNames as functionPredicateNames,
  hostedDeepseekMigrationStatusDiagnosticMigrationPredicateNames as migrationPredicateNames,
  hostedDeepseekMigrationStatusDiagnosticPredicateNames,
  renderHostedDeepseekMigrationStatusDiagnosticExpectedFunctionsSql,
  renderHostedDeepseekMigrationStatusDiagnosticMigrationPredicatesSql,
} from "./acceptance-hosted-deepseek-migration-status-diagnostic-contract.mjs";
import { renderHostedDeepseekExecutorMembershipContractSql } from "./acceptance-hosted-deepseek-executor-membership.mjs";
import { sqlLiteral } from "./acceptance-hosted-foundation.mjs";

export { hostedDeepseekMigrationStatusDiagnosticPredicateNames };

function renderBaseDiagnosticRows(startOrdinal = 1) {
  return [...migrationPredicateNames, ...catalogPredicateNames]
    .map(
      (name, index) =>
        `      (${startOrdinal + index}, ${sqlLiteral(name)}, diagnostic_state.${name})`,
    )
    .join(",\n");
}

function renderAggregateDiagnosticRows(startOrdinal) {
  return aggregatePredicateNames
    .map(
      (name, index) =>
        `      (${startOrdinal + index}, ${sqlLiteral(name)}, diagnostic_state.${name})`,
    )
    .join(",\n");
}

export function renderHostedDeepseekMigrationStatusDiagnosticSql() {
  const functionStartOrdinal = migrationPredicateNames.length + catalogPredicateNames.length + 1;
  const aggregateStartOrdinal = functionStartOrdinal + functionPredicateNames.length;
  const executorMembershipContract = renderHostedDeepseekExecutorMembershipContractSql();
  return `
BEGIN READ ONLY;
WITH migration_state AS (
  SELECT COALESCE(array_agg(version::text ORDER BY version::text), ARRAY[]::text[]) AS versions
  FROM supabase_migrations.schema_migrations
), expected_functions(ordinal, key, signature, executor_should_execute) AS (
  VALUES
${renderHostedDeepseekMigrationStatusDiagnosticExpectedFunctionsSql()}
), function_catalog AS (
  SELECT
    expected_functions.*,
    to_regprocedure(expected_functions.signature) AS function_oid,
    procedure.proowner,
    procedure.prosecdef,
    procedure.proconfig
  FROM expected_functions
  LEFT JOIN pg_proc procedure
    ON procedure.oid = to_regprocedure(expected_functions.signature)
), function_contract AS (
  SELECT
    function_catalog.*,
    function_oid IS NOT NULL
      AND proowner = (SELECT oid FROM pg_roles WHERE rolname = 'postgres')
      AND prosecdef
      AND 'search_path=pg_catalog, huayi_private' = ANY(
        COALESCE(proconfig, ARRAY[]::text[])
      ) AS contract_exact,
    function_oid IS NOT NULL
      AND COALESCE(
        has_function_privilege(
          (SELECT oid FROM pg_roles WHERE rolname = 'huayi_hosted_acceptance_executor'),
          function_oid,
          'EXECUTE'
        ),
        FALSE
      ) = executor_should_execute AS executor_acl_exact,
    function_oid IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM pg_proc target_procedure
        CROSS JOIN LATERAL aclexplode(
          COALESCE(target_procedure.proacl, acldefault('f', target_procedure.proowner))
        ) privilege
        WHERE target_procedure.oid = function_oid
          AND privilege.privilege_type = 'EXECUTE'
          AND privilege.grantee <> target_procedure.proowner
          AND privilege.grantee <> COALESCE(
            (SELECT oid FROM pg_roles WHERE rolname = 'huayi_hosted_acceptance_executor'),
            0
          )
      ) AS unexpected_acl_absent,
    function_oid IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM pg_roles role_entry
        WHERE role_entry.rolname IN (
          'anon', 'authenticated', 'service_role',
          'huayi_business', 'huayi_context_setter', 'huayi_runtime'
        )
          AND COALESCE(
            has_function_privilege(role_entry.oid, function_oid, 'EXECUTE'),
            FALSE
          )
      ) AS external_acl_absent
  FROM function_catalog
), function_aggregate AS (
  SELECT
    bool_and(function_oid IS NULL) AS private_functions_absent,
    count(*) FILTER (WHERE function_oid IS NOT NULL) = ${functionDefinitions.length}
      AS private_function_count_exact,
    bool_and(
      function_oid IS NOT NULL
      AND proowner = (SELECT oid FROM pg_roles WHERE rolname = 'postgres')
    ) AS private_function_owner_exact,
    bool_and(function_oid IS NOT NULL AND prosecdef)
      AS private_function_security_definer_exact,
    bool_and(
      function_oid IS NOT NULL
      AND 'search_path=pg_catalog, huayi_private' = ANY(
        COALESCE(proconfig, ARRAY[]::text[])
      )
    ) AS private_function_search_path_exact,
    bool_and(executor_acl_exact) AS executor_function_acl_exact,
    bool_and(unexpected_acl_absent) AS unexpected_function_acl_absent,
    bool_and(external_acl_absent) AS external_function_acl_absent
  FROM function_contract
), role_state AS (
  SELECT
    count(*) = 1 AS executor_role_present,
    count(*) = 1
      AND bool_and(
        NOT role_entry.rolsuper
        AND NOT role_entry.rolinherit
        AND NOT role_entry.rolcreaterole
        AND NOT role_entry.rolcreatedb
        AND NOT role_entry.rolcanlogin
        AND NOT role_entry.rolreplication
        AND NOT role_entry.rolbypassrls
      ) AS executor_role_attributes_exact,
    count(*) = 1
      AND bool_and(
        NOT EXISTS (
          SELECT 1
          FROM pg_auth_members membership
          WHERE membership.roleid = role_entry.oid OR membership.member = role_entry.oid
        )
      ) AS executor_role_membership_absent,
    count(*) = 1
      AND bool_and(${executorMembershipContract}) AS executor_role_membership_contract_exact
  FROM pg_roles role_entry
  WHERE role_entry.rolname = 'huayi_hosted_acceptance_executor'
), schema_state AS (
  SELECT count(*) = 1
    AND bool_and(namespace.nspowner = (SELECT oid FROM pg_roles WHERE rolname = 'postgres'))
    AS private_schema_owner_exact
  FROM pg_namespace namespace
  WHERE namespace.nspname = 'huayi_private'
), relation_state AS (
  SELECT
    count(*) FILTER (
      WHERE relation.relname = 'hosted_acceptance_operations' AND relation.relkind = 'r'
    ) = 1 AS operations_table_present,
    count(*) FILTER (
      WHERE relation.relname = 'hosted_acceptance_operations'
        AND relation.relkind = 'r'
        AND relation.relowner = (SELECT oid FROM pg_roles WHERE rolname = 'postgres')
    ) = 1 AS operations_table_owner_exact,
    count(*) FILTER (
      WHERE relation.relname = 'hosted_acceptance_operations'
        AND relation.relkind = 'r' AND relation.relrowsecurity
    ) = 1 AS operations_table_rls_exact,
    count(*) FILTER (
      WHERE relation.relname = 'hosted_acceptance_operations'
        AND relation.relkind = 'r' AND relation.relforcerowsecurity
    ) = 1 AS operations_table_force_rls_exact,
    count(*) FILTER (
      WHERE relation.relname = 'hosted_acceptance_cleanup_obligations'
        AND relation.relkind = 'r'
    ) = 1 AS cleanup_table_present,
    count(*) FILTER (
      WHERE relation.relname = 'hosted_acceptance_cleanup_obligations'
        AND relation.relkind = 'r'
        AND relation.relowner = (SELECT oid FROM pg_roles WHERE rolname = 'postgres')
    ) = 1 AS cleanup_table_owner_exact,
    count(*) FILTER (
      WHERE relation.relname = 'hosted_acceptance_cleanup_obligations'
        AND relation.relkind = 'r' AND relation.relrowsecurity
    ) = 1 AS cleanup_table_rls_exact,
    count(*) FILTER (
      WHERE relation.relname = 'hosted_acceptance_cleanup_obligations'
        AND relation.relkind = 'r' AND relation.relforcerowsecurity
    ) = 1 AS cleanup_table_force_rls_exact
  FROM pg_class relation
  JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
  WHERE namespace.nspname = 'huayi_private'
    AND relation.relname IN (
      'hosted_acceptance_operations',
      'hosted_acceptance_cleanup_obligations'
    )
), receipt_state AS (
  SELECT count(*) = 1
    AND bool_and(attribute.atttypid = 'jsonb'::regtype AND NOT attribute.attisdropped)
    AS receipt_column_exact
  FROM pg_attribute attribute
  WHERE attribute.attrelid = to_regclass('huayi_private.hosted_acceptance_operations')
    AND attribute.attname = 'receipt_evidence'
), constraint_state AS (
  SELECT count(*) = 1 AND bool_and(constraint_entry.convalidated)
    AS receipt_constraint_exact
  FROM pg_constraint constraint_entry
  WHERE constraint_entry.conrelid =
      to_regclass('huayi_private.hosted_acceptance_operations')
    AND constraint_entry.conname = 'hosted_acceptance_receipt_evidence_shape'
    AND constraint_entry.contype = 'c'
), trigger_state AS (
  SELECT
    count(*) FILTER (
      WHERE trigger_entry.tgname = 'hosted_acceptance_operation_state_guard'
        AND relation.relname = 'hosted_acceptance_operations'
        AND trigger_entry.tgenabled = 'O'
        AND trigger_entry.tgtype = 23
        AND trigger_entry.tgfoid =
          to_regprocedure('huayi_private.enforce_hosted_acceptance_operation_state()')
    ) = 1 AS operation_trigger_exact,
    count(*) FILTER (
      WHERE trigger_entry.tgname = 'hosted_acceptance_cleanup_state_guard'
        AND relation.relname = 'hosted_acceptance_cleanup_obligations'
        AND trigger_entry.tgenabled = 'O'
        AND trigger_entry.tgtype = 19
        AND trigger_entry.tgfoid =
          to_regprocedure('huayi_private.enforce_hosted_acceptance_cleanup_state()')
    ) = 1 AS cleanup_trigger_exact,
    count(*) FILTER (
      WHERE trigger_entry.tgname = 'hosted_acceptance_receipt_evidence_guard'
        AND relation.relname = 'hosted_acceptance_operations'
        AND trigger_entry.tgenabled = 'O'
        AND trigger_entry.tgtype = 19
        AND trigger_entry.tgfoid =
          to_regprocedure('huayi_private.enforce_hosted_acceptance_receipt_evidence()')
    ) = 1 AS receipt_trigger_exact
  FROM pg_trigger trigger_entry
  JOIN pg_class relation ON relation.oid = trigger_entry.tgrelid
  JOIN pg_namespace namespace ON namespace.oid = relation.relnamespace
  WHERE namespace.nspname = 'huayi_private' AND NOT trigger_entry.tgisinternal
), acl_state AS (
  SELECT
    COALESCE(
      has_schema_privilege(
        (SELECT oid FROM pg_roles WHERE rolname = 'huayi_hosted_acceptance_executor'),
        'huayi_private',
        'USAGE'
      ),
      FALSE
    ) AS executor_schema_usage_exact,
    NOT COALESCE(
      has_schema_privilege(
        (SELECT oid FROM pg_roles WHERE rolname = 'huayi_hosted_acceptance_executor'),
        'huayi_private',
        'CREATE'
      ),
      FALSE
    ) AS executor_schema_create_absent,
    NOT EXISTS (
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
    ) AS unexpected_table_acl_absent,
    NOT EXISTS (
      SELECT 1
      FROM pg_roles role_entry
      CROSS JOIN unnest(ARRAY[
        'huayi_private.hosted_acceptance_operations',
        'huayi_private.hosted_acceptance_cleanup_obligations'
      ]::text[]) relation_name
      WHERE role_entry.rolname IN (
        'anon', 'authenticated', 'service_role', 'huayi_business',
        'huayi_context_setter', 'huayi_runtime', 'huayi_hosted_acceptance_executor'
      )
        AND COALESCE(
          has_table_privilege(
            role_entry.oid,
            to_regclass(relation_name),
            'SELECT,INSERT,UPDATE,DELETE'
          ),
          FALSE
        )
    ) AS external_table_acl_absent
), core_state AS (
  SELECT
    ${renderHostedDeepseekMigrationStatusDiagnosticMigrationPredicatesSql()},
    role_state.*,
    schema_state.*,
    relation_state.*,
    receipt_state.*,
    constraint_state.*,
    trigger_state.*,
    acl_state.*,
    function_aggregate.*
  FROM migration_state
  CROSS JOIN role_state
  CROSS JOIN schema_state
  CROSS JOIN relation_state
  CROSS JOIN receipt_state
  CROSS JOIN constraint_state
  CROSS JOIN trigger_state
  CROSS JOIN acl_state
  CROSS JOIN function_aggregate
), diagnostic_state AS (
  SELECT
    core_state.*,
    migration_chain_0015_exact
      AND NOT executor_role_present
      AND NOT operations_table_present
      AND NOT cleanup_table_present
      AND private_functions_absent AS pending_state_exact,
    migration_chain_0021_exact
      AND executor_role_present
      AND executor_role_attributes_exact
      AND executor_role_membership_contract_exact
      AND private_schema_owner_exact
      AND operations_table_present
      AND operations_table_owner_exact
      AND operations_table_rls_exact
      AND operations_table_force_rls_exact
      AND cleanup_table_present
      AND cleanup_table_owner_exact
      AND cleanup_table_rls_exact
      AND cleanup_table_force_rls_exact
      AND receipt_column_exact
      AND receipt_constraint_exact
      AND operation_trigger_exact
      AND cleanup_trigger_exact
      AND receipt_trigger_exact
      AND executor_schema_usage_exact
      AND executor_schema_create_absent
      AND unexpected_table_acl_absent
      AND external_table_acl_absent
      AND private_function_count_exact
      AND private_function_owner_exact
      AND private_function_security_definer_exact
      AND private_function_search_path_exact
      AND executor_function_acl_exact
      AND unexpected_function_acl_absent
      AND external_function_acl_absent AS applied_state_exact
  FROM core_state
), diagnostic_rows AS (
  SELECT base.ordinal, base.name, base.value
  FROM diagnostic_state
  CROSS JOIN LATERAL (VALUES
${renderBaseDiagnosticRows()}
  ) base(ordinal, name, value)
  UNION ALL
  SELECT
    ${functionStartOrdinal - 1} + ((function_contract.ordinal - 1) * 3) + detail.detail_ordinal,
    'function_' || function_contract.key || '_' || detail.suffix,
    detail.value
  FROM function_contract
  CROSS JOIN LATERAL (VALUES
    (1, 'contract_exact', function_contract.contract_exact),
    (2, 'executor_acl_exact', function_contract.executor_acl_exact),
    (3, 'unexpected_acl_absent', function_contract.unexpected_acl_absent)
  ) detail(detail_ordinal, suffix, value)
  UNION ALL
  SELECT aggregate.ordinal, aggregate.name, aggregate.value
  FROM diagnostic_state
  CROSS JOIN LATERAL (VALUES
${renderAggregateDiagnosticRows(aggregateStartOrdinal)}
  ) aggregate(ordinal, name, value)
)
SELECT diagnostic_rows.name || '|' || CASE WHEN diagnostic_rows.value THEN 't' ELSE 'f' END
  AS diagnostic
FROM diagnostic_rows
ORDER BY diagnostic_rows.ordinal;
ROLLBACK;
`;
}
