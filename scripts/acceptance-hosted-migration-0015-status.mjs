import { pathToFileURL } from "node:url";

import {
  hostedAcceptanceMigrationVersionsThrough0014,
  hostedAcceptanceMigrationVersionsThrough0015,
  hostedAcceptancePoolerUrl,
  hostedAcceptanceProjectRef,
  runHostedPsql,
  sqlTextArray,
} from "./acceptance-hosted-foundation.mjs";
import { readHiddenTerminalLine } from "./acceptance-hosted-important-batch-secret-prompt.mjs";
import { fetchHostedAcceptanceOfficialCaCertificate } from "./acceptance-hosted-official-ca.mjs";

const appliedStatus = "applied_exact";
const pendingStatus = "pending_exact";
const uncertainStatus = "uncertain";

export const hostedMigration0015StatusArgument = `--status-20260825010000-public-function-acl-hardening-${hostedAcceptanceProjectRef}`;
export const hostedMigration0015StatusAppliedMessage =
  "Hosted 0015 migration status: applied-exact.";
export const hostedMigration0015StatusPendingMessage =
  "Hosted 0015 migration status: pending-exact.";
export const hostedMigration0015StatusUncertainMessage =
  "Hosted 0015 migration status: uncertain; do not retry apply.";

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

export function renderHostedMigration0015StatusSql() {
  const appliedMigrations = sqlTextArray(hostedAcceptanceMigrationVersionsThrough0015);
  const pendingMigrations = sqlTextArray(hostedAcceptanceMigrationVersionsThrough0014);
  return `
BEGIN READ ONLY;
WITH migration_state AS (
  SELECT COALESCE(
    array_agg(version::text ORDER BY version::text),
    ARRAY[]::text[]
  ) AS versions
  FROM supabase_migrations.schema_migrations
), role_state AS (
  SELECT count(*) FILTER (
    WHERE role.rolname IN ('anon', 'authenticated', 'service_role')
  ) = 3 AS data_api_roles_present_exact
  FROM pg_roles role
), public_function_acl AS (
  SELECT
    procedure.oid,
    procedure.proowner,
    procedure.prosecdef,
    procedure.proconfig,
    procedure.oid IN (
      to_regprocedure('public.bind_auth_identity(text,uuid)'),
      to_regprocedure(
        'public.renew_interrupted_password_confirmation(text,text,timestamptz)'
      )
    ) AS is_0014_function,
    EXISTS (
      SELECT 1
      FROM aclexplode(
        COALESCE(procedure.proacl, acldefault('f', procedure.proowner))
      ) privilege
      LEFT JOIN pg_roles grantee ON grantee.oid = privilege.grantee
      WHERE privilege.privilege_type = 'EXECUTE'
        AND (
          privilege.grantee = 0
          OR grantee.rolname IN ('anon', 'authenticated', 'service_role')
        )
    ) AS external_direct_execute,
    EXISTS (
      SELECT 1
      FROM aclexplode(
        COALESCE(procedure.proacl, acldefault('f', procedure.proowner))
      ) privilege
      WHERE privilege.privilege_type = 'EXECUTE'
        AND privilege.grantee = 0
    ) AS public_direct_execute,
    (
      SELECT count(*)
      FROM aclexplode(
        COALESCE(procedure.proacl, acldefault('f', procedure.proowner))
      ) privilege
      JOIN pg_roles grantee ON grantee.oid = privilege.grantee
      WHERE privilege.privilege_type = 'EXECUTE'
        AND grantee.rolname IN ('anon', 'authenticated', 'service_role')
    ) AS api_role_direct_execute_count,
    COALESCE(has_function_privilege(
      (SELECT oid FROM pg_roles WHERE rolname = 'anon'),
      procedure.oid,
      'EXECUTE'
    ), false) AS anon_effective_execute,
    COALESCE(has_function_privilege(
      (SELECT oid FROM pg_roles WHERE rolname = 'authenticated'),
      procedure.oid,
      'EXECUTE'
    ), false) AS authenticated_effective_execute,
    COALESCE(has_function_privilege(
      (SELECT oid FROM pg_roles WHERE rolname = 'service_role'),
      procedure.oid,
      'EXECUTE'
    ), false) AS service_role_effective_execute,
    COALESCE(has_function_privilege(
      (SELECT oid FROM pg_roles WHERE rolname = 'huayi_business'),
      procedure.oid,
      'EXECUTE'
    ), false) AS business_effective_execute,
    COALESCE(has_function_privilege(
      (SELECT oid FROM pg_roles WHERE rolname = 'huayi_runtime'),
      procedure.oid,
      'EXECUTE'
    ), false) AS runtime_effective_execute,
    EXISTS (
      SELECT 1
      FROM aclexplode(
        COALESCE(procedure.proacl, acldefault('f', procedure.proowner))
      ) privilege
      WHERE privilege.privilege_type = 'EXECUTE'
        AND privilege.grantee = procedure.proowner
    ) AS owner_direct_execute,
    EXISTS (
      SELECT 1
      FROM aclexplode(
        COALESCE(procedure.proacl, acldefault('f', procedure.proowner))
      ) privilege
      WHERE privilege.privilege_type = 'EXECUTE'
        AND privilege.grantee = (
          SELECT oid FROM pg_roles WHERE rolname = 'huayi_context_setter'
        )
    ) AS setter_direct_execute,
    (
      SELECT count(*)
      FROM aclexplode(
        COALESCE(procedure.proacl, acldefault('f', procedure.proowner))
      ) privilege
      LEFT JOIN pg_roles grantee ON grantee.oid = privilege.grantee
      WHERE privilege.privilege_type = 'EXECUTE'
        AND privilege.grantee <> procedure.proowner
        AND privilege.grantee <> COALESCE(
          (SELECT oid FROM pg_roles WHERE rolname = 'huayi_context_setter'),
          0
        )
        AND privilege.grantee <> 0
        AND grantee.rolname NOT IN ('anon', 'authenticated', 'service_role')
    ) AS other_direct_execute_count
  FROM pg_proc procedure
  JOIN pg_namespace namespace ON namespace.oid = procedure.pronamespace
  WHERE namespace.nspname = 'public'
), public_function_state AS (
  SELECT
    count(*) > 0 AS public_functions_present,
    count(*) FILTER (WHERE prosecdef) > 0 AS public_security_definer_present,
    bool_and(
      NOT external_direct_execute
      AND NOT anon_effective_execute
      AND NOT authenticated_effective_execute
      AND NOT service_role_effective_execute
    ) AS applied_external_execute_absent,
    bool_and(
      NOT public_direct_execute
      AND api_role_direct_execute_count = 3
      AND anon_effective_execute
      AND authenticated_effective_execute
      AND service_role_effective_execute
    ) FILTER (WHERE prosecdef) AS pending_api_role_drift_exact
  FROM public_function_acl
), target_function_state AS (
  SELECT
    count(*) = 2
      AND bool_and(prosecdef)
      AND bool_and('search_path=pg_catalog' = ANY(COALESCE(proconfig, ARRAY[]::text[])))
      AS target_contract_exact,
    bool_and(
      owner_direct_execute
      AND setter_direct_execute
      AND NOT business_effective_execute
      AND NOT runtime_effective_execute
      AND NOT external_direct_execute
      AND other_direct_execute_count = 0
    ) AS applied_grants_exact,
    bool_and(
      owner_direct_execute
      AND setter_direct_execute
      AND NOT business_effective_execute
      AND NOT runtime_effective_execute
      AND NOT public_direct_execute
      AND api_role_direct_execute_count = 3
      AND other_direct_execute_count = 0
    ) AS pending_grants_exact
  FROM public_function_acl
  WHERE is_0014_function
), global_default_state AS (
  SELECT
    count(*) = 1 AS entry_present_exact,
    NOT EXISTS (
      SELECT 1
      FROM pg_default_acl defaults
      CROSS JOIN LATERAL aclexplode(defaults.defaclacl) privilege
      LEFT JOIN pg_roles grantee ON grantee.oid = privilege.grantee
      WHERE defaults.defaclrole = (
          SELECT oid FROM pg_roles WHERE rolname = 'postgres'
        )
        AND defaults.defaclobjtype = 'f'
        AND defaults.defaclnamespace = 0
        AND privilege.privilege_type = 'EXECUTE'
        AND (
          privilege.grantee = 0
          OR grantee.rolname IN ('anon', 'authenticated', 'service_role')
        )
    ) AS external_execute_absent
  FROM pg_default_acl defaults
  WHERE defaults.defaclrole = (SELECT oid FROM pg_roles WHERE rolname = 'postgres')
    AND defaults.defaclobjtype = 'f'
    AND defaults.defaclnamespace = 0
), public_default_state AS (
  SELECT
    count(*) FILTER (
      WHERE privilege.privilege_type = 'EXECUTE'
        AND grantee.rolname IN ('anon', 'authenticated', 'service_role')
    ) = 3 AS pending_api_role_execute_exact,
    count(*) FILTER (
      WHERE privilege.privilege_type = 'EXECUTE'
        AND grantee.rolname IN ('anon', 'authenticated', 'service_role')
    ) = 0 AS applied_api_role_execute_absent
  FROM pg_default_acl defaults
  JOIN pg_namespace namespace ON namespace.oid = defaults.defaclnamespace
  CROSS JOIN LATERAL aclexplode(defaults.defaclacl) privilege
  LEFT JOIN pg_roles grantee ON grantee.oid = privilege.grantee
  WHERE defaults.defaclrole = (SELECT oid FROM pg_roles WHERE rolname = 'postgres')
    AND defaults.defaclobjtype = 'f'
    AND namespace.nspname = 'public'
)
SELECT CASE
  WHEN migration_state.versions = ${appliedMigrations}
    AND role_state.data_api_roles_present_exact
    AND public_function_state.public_functions_present
    AND public_function_state.public_security_definer_present
    AND public_function_state.applied_external_execute_absent
    AND target_function_state.target_contract_exact
    AND target_function_state.applied_grants_exact
    AND global_default_state.entry_present_exact
    AND global_default_state.external_execute_absent
    AND public_default_state.applied_api_role_execute_absent
  THEN 'applied_exact'
  WHEN migration_state.versions = ${pendingMigrations}
    AND role_state.data_api_roles_present_exact
    AND public_function_state.public_functions_present
    AND public_function_state.public_security_definer_present
    AND public_function_state.pending_api_role_drift_exact
    AND target_function_state.target_contract_exact
    AND target_function_state.pending_grants_exact
    AND NOT (
      global_default_state.entry_present_exact
      AND global_default_state.external_execute_absent
    )
    AND public_default_state.pending_api_role_execute_exact
  THEN 'pending_exact'
  ELSE 'uncertain'
END
FROM migration_state
CROSS JOIN role_state
CROSS JOIN public_function_state
CROSS JOIN target_function_state
CROSS JOIN global_default_state
CROSS JOIN public_default_state;
ROLLBACK;
`;
}

export function parseHostedMigration0015StatusOutput(output) {
  return new Set(["applied_exact\n", "pending_exact\n", "uncertain\n"]).has(output)
    ? output.slice(0, -1)
    : null;
}

export async function runHostedMigration0015StatusQuery(
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
    input: renderHostedMigration0015StatusSql(),
    timeoutMilliseconds: 30_000,
  });
  return result.code === 0 ? parseHostedMigration0015StatusOutput(result.stdout) : null;
}

export async function runHostedMigration0015StatusCli({
  arguments_ = process.argv.slice(2),
  environment = process.env,
  fetchCaCertificate = fetchHostedAcceptanceOfficialCaCertificate,
  readPassword = readHiddenTerminalLine,
  runStatusQuery = runHostedMigration0015StatusQuery,
  writeOutput = (value) => process.stdout.write(value),
} = {}) {
  let status = uncertainStatus;
  try {
    if (
      arguments_.length !== 1 ||
      arguments_[0] !== hostedMigration0015StatusArgument ||
      environmentHasInheritedPassword(environment)
    ) {
      throw new Error(hostedMigration0015StatusUncertainMessage);
    }
    const caCertificate = await fetchCaCertificate();
    const administratorPassword = await readPassword();
    if (!passwordIsValid(administratorPassword)) {
      throw new Error(hostedMigration0015StatusUncertainMessage);
    }
    status = (await runStatusQuery({ administratorPassword, caCertificate })) ?? uncertainStatus;
  } catch {
    status = uncertainStatus;
  }
  if (status === appliedStatus) {
    writeOutput(`${hostedMigration0015StatusAppliedMessage}\n`);
    return 0;
  }
  if (status === pendingStatus) {
    writeOutput(`${hostedMigration0015StatusPendingMessage}\n`);
    return 0;
  }
  writeOutput(`${hostedMigration0015StatusUncertainMessage}\n`);
  return 1;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runHostedMigration0015StatusCli();
}
