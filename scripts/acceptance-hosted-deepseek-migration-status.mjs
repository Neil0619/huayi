import { pathToFileURL } from "node:url";

import { readHiddenTerminalLine } from "./acceptance-hosted-important-batch-secret-prompt.mjs";
import {
  hostedAcceptanceMigrationVersions,
  hostedAcceptanceMigrationVersionsThrough0015,
  hostedAcceptancePoolerUrl,
  hostedAcceptanceProjectRef,
  runHostedPsql,
  sqlTextArray,
} from "./acceptance-hosted-foundation.mjs";
import { fetchHostedAcceptanceOfficialCaCertificate } from "./acceptance-hosted-official-ca.mjs";

const appliedStatus = "applied_exact";
const pendingStatus = "pending_exact";
const uncertainStatus = "uncertain";
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
const executorFunctionSignatures = Object.freeze([
  "huayi_private.arm_hosted_acceptance_cleanup(uuid,bigint,text,text)",
  "huayi_private.bind_hosted_acceptance_request(uuid,bigint,text,uuid,uuid,text,text)",
  "huayi_private.claim_hosted_acceptance_cleanup(text,text)",
  "huayi_private.claim_hosted_acceptance_operation(uuid,text,text,bigint,text,text,text,text,text,text,integer,text)",
  "huayi_private.complete_hosted_acceptance_cleanup(uuid,bigint,text,timestamp with time zone)",
  "huayi_private.complete_hosted_acceptance_operation(uuid,bigint,text,text,text)",
  "huayi_private.mark_hosted_acceptance_dispatch(uuid,bigint,text,text)",
  "huayi_private.read_and_freeze_hosted_acceptance_settlement(uuid,bigint,text,uuid)",
  "huayi_private.read_hosted_acceptance_status()",
  "huayi_private.reconcile_and_bind_hosted_acceptance_request(uuid,bigint,text,uuid,text,text)",
  "huayi_private.record_hosted_acceptance_settlement(uuid,bigint,text,uuid)",
  "huayi_private.retain_hosted_acceptance_evidence(integer)",
]);

export const hostedDeepseekMigrationStatusArgument = `--status-hosted-deepseek-0016-0021-${hostedAcceptanceProjectRef}`;
export const hostedDeepseekMigrationStatusAppliedMessage =
  "Hosted DeepSeek 0016-0021 migration status: applied-exact.";
export const hostedDeepseekMigrationStatusPendingMessage =
  "Hosted DeepSeek 0016-0021 migration status: pending-exact.";
export const hostedDeepseekMigrationStatusUncertainMessage =
  "Hosted DeepSeek 0016-0021 migration status: uncertain; do not retry apply.";

function passwordIsValid(password) {
  return (
    typeof password === "string" &&
    Buffer.byteLength(password) >= 12 &&
    Buffer.byteLength(password) <= 512 &&
    !/[\0\r\n]/u.test(password)
  );
}

function environmentHasInheritedPassword(environment) {
  return ["PGPASSWORD", "SUPABASE_DB_PASSWORD"].some((name) =>
    Object.prototype.hasOwnProperty.call(environment, name),
  );
}

export function renderHostedDeepseekMigrationStatusSql() {
  const pendingMigrations = sqlTextArray(hostedAcceptanceMigrationVersionsThrough0015);
  const appliedMigrations = sqlTextArray(hostedAcceptanceMigrationVersions);
  const expectedFunctions = sqlTextArray(privateFunctionSignatures);
  const executorFunctions = sqlTextArray(executorFunctionSignatures);
  return `
BEGIN READ ONLY;
WITH migration_state AS (
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
      AND NOT EXISTS (
        SELECT 1
        FROM pg_auth_members membership
        WHERE membership.roleid = role_entry.oid OR membership.member = role_entry.oid
      )
    ) AS exact
  FROM pg_roles role_entry
  WHERE role_entry.rolname = 'huayi_hosted_acceptance_executor'
), schema_state AS (
  SELECT count(*) = 1
    AND bool_and(
      namespace.nspowner = (SELECT oid FROM pg_roles WHERE rolname = 'postgres')
    ) AS exact
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
  WHERE constraint_entry.conrelid =
      to_regclass('huayi_private.hosted_acceptance_operations')
    AND constraint_entry.conname = 'hosted_acceptance_receipt_evidence_shape'
    AND constraint_entry.contype = 'c'
), function_state AS (
  SELECT count(*) = ${privateFunctionSignatures.length}
    AND bool_and(function_oid IS NOT NULL)
    AND bool_and(
      procedure.proowner = (SELECT oid FROM pg_roles WHERE rolname = 'postgres')
    )
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
), pending_state AS (
  SELECT
    to_regclass('huayi_private.hosted_acceptance_operations') IS NULL
    AND to_regclass('huayi_private.hosted_acceptance_cleanup_obligations') IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM pg_roles WHERE rolname = 'huayi_hosted_acceptance_executor'
    )
    AND bool_and(function_oid IS NULL) AS exact
  FROM expected_functions
)
SELECT CASE
  WHEN migration_state.versions = ${appliedMigrations}
    AND role_state.exact
    AND schema_state.exact
    AND relation_state.exact
    AND receipt_state.exact
    AND constraint_state.exact
    AND function_state.exact
    AND executor_function_acl.exact
    AND unexpected_function_acl.exact
    AND executor_schema_acl.exact
    AND trigger_state.exact
    AND unexpected_table_acl.exact
    AND external_function_acl.exact
    AND external_table_acl.exact
  THEN 'applied_exact'
  WHEN migration_state.versions = ${pendingMigrations} AND pending_state.exact
  THEN 'pending_exact'
  ELSE 'uncertain'
END
FROM migration_state
CROSS JOIN role_state
CROSS JOIN schema_state
CROSS JOIN relation_state
CROSS JOIN receipt_state
CROSS JOIN constraint_state
CROSS JOIN function_state
CROSS JOIN executor_function_acl
CROSS JOIN unexpected_function_acl
CROSS JOIN executor_schema_acl
CROSS JOIN trigger_state
CROSS JOIN unexpected_table_acl
CROSS JOIN external_function_acl
CROSS JOIN external_table_acl
CROSS JOIN pending_state;
ROLLBACK;
`;
}

export function parseHostedDeepseekMigrationStatusOutput(output) {
  return new Set(["applied_exact\n", "pending_exact\n", "uncertain\n"]).has(output)
    ? output.slice(0, -1)
    : null;
}

export async function runHostedDeepseekMigrationStatusQuery(
  { administratorPassword, caCertificate },
  { runPsql = runHostedPsql } = {},
) {
  const result = await runPsql({
    captureOutput: true,
    databaseUrl: hostedAcceptancePoolerUrl,
    environment: {
      HUAYI_HOSTED_DATABASE_CA_CERTIFICATE: caCertificate,
      PGPASSWORD: administratorPassword,
    },
    input: renderHostedDeepseekMigrationStatusSql(),
    timeoutMilliseconds: 30_000,
  });
  return result.code === 0 ? parseHostedDeepseekMigrationStatusOutput(result.stdout) : null;
}

export async function runHostedDeepseekMigrationStatusCli({
  arguments_ = process.argv.slice(2),
  environment = process.env,
  fetchCaCertificate = fetchHostedAcceptanceOfficialCaCertificate,
  readPassword = readHiddenTerminalLine,
  runStatusQuery = runHostedDeepseekMigrationStatusQuery,
  writeOutput = (value) => process.stdout.write(value),
} = {}) {
  let status = uncertainStatus;
  try {
    if (
      arguments_.length !== 1 ||
      arguments_[0] !== hostedDeepseekMigrationStatusArgument ||
      environmentHasInheritedPassword(environment)
    ) {
      throw new Error(hostedDeepseekMigrationStatusUncertainMessage);
    }
    const caCertificate = await fetchCaCertificate();
    const administratorPassword = await readPassword();
    if (!passwordIsValid(administratorPassword)) {
      throw new Error(hostedDeepseekMigrationStatusUncertainMessage);
    }
    status = (await runStatusQuery({ administratorPassword, caCertificate })) ?? uncertainStatus;
  } catch {
    status = uncertainStatus;
  }
  if (status === appliedStatus) {
    writeOutput(`${hostedDeepseekMigrationStatusAppliedMessage}\n`);
    return 0;
  }
  if (status === pendingStatus) {
    writeOutput(`${hostedDeepseekMigrationStatusPendingMessage}\n`);
    return 0;
  }
  writeOutput(`${hostedDeepseekMigrationStatusUncertainMessage}\n`);
  return 1;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runHostedDeepseekMigrationStatusCli();
}
