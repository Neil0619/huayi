import {
  hostedAcceptanceMigrationVersions,
  hostedAcceptanceMigrationVersionsThrough0015,
  sqlLiteral,
  sqlTextArray,
} from "./acceptance-hosted-foundation.mjs";

export const hostedDeepseekMigrationStatusDiagnosticMigrationPredicateNames = Object.freeze(
  Array.from({ length: 7 }, (_, index) => `migration_chain_00${index + 15}_exact`),
);
export const hostedDeepseekMigrationStatusDiagnosticCatalogPredicateNames = Object.freeze([
  "executor_role_present",
  "executor_role_attributes_exact",
  "executor_role_membership_absent",
  "executor_role_membership_contract_exact",
  "private_schema_owner_exact",
  "operations_table_present",
  "operations_table_owner_exact",
  "operations_table_rls_exact",
  "operations_table_force_rls_exact",
  "cleanup_table_present",
  "cleanup_table_owner_exact",
  "cleanup_table_rls_exact",
  "cleanup_table_force_rls_exact",
  "receipt_column_exact",
  "receipt_constraint_exact",
  "operation_trigger_exact",
  "cleanup_trigger_exact",
  "receipt_trigger_exact",
  "executor_schema_usage_exact",
  "executor_schema_create_absent",
  "unexpected_table_acl_absent",
  "external_table_acl_absent",
]);
const functionPredicateSuffixes = Object.freeze([
  "contract_exact",
  "executor_acl_exact",
  "unexpected_acl_absent",
]);
export const hostedDeepseekMigrationStatusDiagnosticAggregatePredicateNames = Object.freeze([
  "private_functions_absent",
  "private_function_count_exact",
  "private_function_owner_exact",
  "private_function_security_definer_exact",
  "private_function_search_path_exact",
  "executor_function_acl_exact",
  "unexpected_function_acl_absent",
  "external_function_acl_absent",
  "pending_state_exact",
  "applied_state_exact",
]);

export const hostedDeepseekMigrationStatusDiagnosticFunctionDefinitions = Object.freeze([
  ["arm_cleanup", "huayi_private.arm_hosted_acceptance_cleanup(uuid,bigint,text,text)", true],
  [
    "bind_request",
    "huayi_private.bind_hosted_acceptance_request(uuid,bigint,text,uuid,uuid,text,text)",
    true,
  ],
  ["claim_cleanup", "huayi_private.claim_hosted_acceptance_cleanup(text,text)", true],
  [
    "claim_operation",
    "huayi_private.claim_hosted_acceptance_operation(uuid,text,text,bigint,text,text,text,text,text,text,integer,text)",
    true,
  ],
  [
    "complete_cleanup",
    "huayi_private.complete_hosted_acceptance_cleanup(uuid,bigint,text,timestamp with time zone)",
    true,
  ],
  [
    "complete_operation",
    "huayi_private.complete_hosted_acceptance_operation(uuid,bigint,text,text,text)",
    true,
  ],
  ["effective_kill_switch", "huayi_private.effective_model_kill_switch_enabled()", false],
  ["enforce_cleanup", "huayi_private.enforce_hosted_acceptance_cleanup_state()", false],
  ["enforce_operation", "huayi_private.enforce_hosted_acceptance_operation_state()", false],
  ["enforce_receipt", "huayi_private.enforce_hosted_acceptance_receipt_evidence()", false],
  ["token_hash", "huayi_private.hosted_acceptance_token_hash(text)", false],
  ["mark_dispatch", "huayi_private.mark_hosted_acceptance_dispatch(uuid,bigint,text,text)", true],
  [
    "read_freeze_settlement",
    "huayi_private.read_and_freeze_hosted_acceptance_settlement(uuid,bigint,text,uuid)",
    true,
  ],
  ["read_status", "huayi_private.read_hosted_acceptance_status()", true],
  [
    "reconcile_bind",
    "huayi_private.reconcile_and_bind_hosted_acceptance_request(uuid,bigint,text,uuid,text,text)",
    true,
  ],
  [
    "record_settlement",
    "huayi_private.record_hosted_acceptance_settlement(uuid,bigint,text,uuid)",
    true,
  ],
  ["retain_evidence", "huayi_private.retain_hosted_acceptance_evidence(integer)", true],
]);

export const hostedDeepseekMigrationStatusDiagnosticFunctionPredicateNames = Object.freeze(
  hostedDeepseekMigrationStatusDiagnosticFunctionDefinitions.flatMap(([key]) =>
    functionPredicateSuffixes.map((suffix) => `function_${key}_${suffix}`),
  ),
);

export const hostedDeepseekMigrationStatusDiagnosticPredicateNames = Object.freeze([
  ...hostedDeepseekMigrationStatusDiagnosticMigrationPredicateNames,
  ...hostedDeepseekMigrationStatusDiagnosticCatalogPredicateNames,
  ...hostedDeepseekMigrationStatusDiagnosticFunctionPredicateNames,
  ...hostedDeepseekMigrationStatusDiagnosticAggregatePredicateNames,
]);

export function renderHostedDeepseekMigrationStatusDiagnosticExpectedFunctionsSql() {
  return hostedDeepseekMigrationStatusDiagnosticFunctionDefinitions
    .map(
      ([key, signature, executorShouldExecute], index) =>
        `    (${index + 1}, ${sqlLiteral(key)}, ${sqlLiteral(signature)}, ${executorShouldExecute})`,
    )
    .join(",\n");
}

export function renderHostedDeepseekMigrationStatusDiagnosticMigrationPredicatesSql() {
  return hostedDeepseekMigrationStatusDiagnosticMigrationPredicateNames
    .map((name, index) => {
      const versions =
        index === 0
          ? hostedAcceptanceMigrationVersionsThrough0015
          : hostedAcceptanceMigrationVersions.slice(0, 15 + index);
      return `migration_state.versions = ${sqlTextArray(versions)} AS ${name}`;
    })
    .join(",\n    ");
}
