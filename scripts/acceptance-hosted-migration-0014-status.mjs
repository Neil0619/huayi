import { pathToFileURL } from "node:url";

import {
  hostedAcceptanceMigrationVersionsThrough0014,
  hostedAcceptancePoolerUrl,
  hostedAcceptanceProjectRef,
  runHostedPsql,
  sqlTextArray,
} from "./acceptance-hosted-foundation.mjs";
import {
  readHostedAdministratorPassword,
  rejectLegacyHostedCredentialEnvironment,
} from "./acceptance-hosted-credentials.mjs";
import { fetchHostedAcceptanceOfficialCaCertificate } from "./acceptance-hosted-official-ca.mjs";

const appliedStatus = "applied_exact";
const pendingStatus = "pending_exact";
const uncertainStatus = "uncertain";

export const hostedMigration0014StatusArgument = `--status-20260824010000-password-signup-otp-resend-${hostedAcceptanceProjectRef}`;
export const hostedMigration0014StatusAppliedMessage =
  "Hosted 0014 migration status: applied-exact.";
export const hostedMigration0014StatusPendingMessage =
  "Hosted 0014 migration status: pending-exact.";
export const hostedMigration0014StatusUncertainMessage =
  "Hosted 0014 migration status: uncertain; do not retry apply.";

function passwordIsValid(password) {
  return (
    typeof password === "string" &&
    Buffer.byteLength(password) >= 12 &&
    Buffer.byteLength(password) <= 512 &&
    !/[\0\r\n]/u.test(password)
  );
}

function environmentHasInheritedPassword(environment) {
  try {
    rejectLegacyHostedCredentialEnvironment(environment);
    return false;
  } catch {
    return true;
  }
}

export function renderHostedMigration0014StatusSql() {
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
       AND column_name = 'bound_email') = 0 AS bound_column_absent,
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
       AND is_nullable = 'YES') = 1 AS bound_column_exact,
    (SELECT count(*)
     FROM pg_constraint target_constraint
     WHERE target_constraint.conrelid = 'public.invitation_claims'::regclass
       AND target_constraint.conname = 'invitation_claims_bound_email_check') = 0
      AS bound_check_absent,
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
         '((bound_email IS NULL) OR (bound_email = lower(bound_email)))') AS bound_check_exact,
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
    has_function_privilege(
      'huayi_context_setter',
      to_regprocedure(
        'public.renew_interrupted_password_confirmation(text,text,timestamptz)'
      ),
      'EXECUTE'
    )
      AND NOT has_function_privilege(
        'huayi_business',
        to_regprocedure(
          'public.renew_interrupted_password_confirmation(text,text,timestamptz)'
        ),
        'EXECUTE'
      )
      AND NOT has_function_privilege(
        'huayi_runtime',
        to_regprocedure(
          'public.renew_interrupted_password_confirmation(text,text,timestamptz)'
        ),
        'EXECUTE'
      )
      AND NOT EXISTS (
        SELECT 1
        FROM pg_proc procedure,
             LATERAL aclexplode(
               COALESCE(procedure.proacl, acldefault('f', procedure.proowner))
             ) privilege
        WHERE procedure.oid = to_regprocedure(
          'public.renew_interrupted_password_confirmation(text,text,timestamptz)'
        )
          AND privilege.grantee = 0
          AND privilege.privilege_type = 'EXECUTE'
      )
      AND (
        SELECT count(*) = 2
          AND count(*) FILTER (
            WHERE privilege.grantee = procedure.proowner
              AND privilege.is_grantable IS FALSE
          ) = 1
          AND count(*) FILTER (
            WHERE privilege.grantee = (
              SELECT oid FROM pg_roles WHERE rolname = 'huayi_context_setter'
            )
              AND privilege.is_grantable IS FALSE
          ) = 1
        FROM pg_proc procedure,
             LATERAL aclexplode(
               COALESCE(procedure.proacl, acldefault('f', procedure.proowner))
             ) privilege
        WHERE procedure.oid = to_regprocedure(
          'public.renew_interrupted_password_confirmation(text,text,timestamptz)'
        )
          AND privilege.privilege_type = 'EXECUTE'
      ) AS renew_acl_exact
)
SELECT CASE
  WHEN migration_state.versions = ${appliedMigrations}
    AND artifact_state.bound_column_exact
    AND artifact_state.bound_check_exact
    AND artifact_state.bind_function_applied_exact
    AND artifact_state.renew_function_exact
    AND artifact_state.renew_acl_exact
  THEN '${appliedStatus}'
  WHEN migration_state.versions = ${pendingMigrations}
    AND artifact_state.bound_column_absent
    AND artifact_state.bound_check_absent
    AND artifact_state.bind_function_pending_exact
    AND artifact_state.renew_function_absent
  THEN '${pendingStatus}'
  ELSE '${uncertainStatus}'
END
FROM migration_state
CROSS JOIN artifact_state;
ROLLBACK;
`;
}

export function parseHostedMigration0014StatusOutput(output) {
  if (output === `${appliedStatus}\n`) return appliedStatus;
  if (output === `${pendingStatus}\n`) return pendingStatus;
  if (output === `${uncertainStatus}\n`) return uncertainStatus;
  return null;
}

export async function runHostedMigration0014StatusQuery(
  { administratorPassword, caCertificate },
  { runPsql = runHostedPsql } = {},
) {
  const result = await runPsql({
    captureOutput: true,
    databaseUrl: hostedAcceptancePoolerUrl,
    environment: {
      HUAYI_HOSTED_DATABASE_CA_CERTIFICATE: caCertificate,
    },
    input: renderHostedMigration0014StatusSql(),
    password: administratorPassword,
    timeoutMilliseconds: 30_000,
  });
  if (result.code !== 0) return null;
  return parseHostedMigration0014StatusOutput(result.stdout);
}

export async function runHostedMigration0014StatusCli({
  arguments_ = process.argv.slice(2),
  environment = process.env,
  fetchCaCertificate = fetchHostedAcceptanceOfficialCaCertificate,
  readPassword = readHostedAdministratorPassword,
  runStatusQuery = runHostedMigration0014StatusQuery,
  writeError = (value) => process.stderr.write(value),
  writeOutput = (value) => process.stdout.write(value),
} = {}) {
  void writeError;
  let status = null;
  try {
    if (
      arguments_.length !== 1 ||
      arguments_[0] !== hostedMigration0014StatusArgument ||
      environmentHasInheritedPassword(environment)
    ) {
      throw new Error(hostedMigration0014StatusUncertainMessage);
    }
    const caCertificate = await fetchCaCertificate();
    const administratorPassword = await readPassword({ environment });
    if (!passwordIsValid(administratorPassword)) {
      throw new Error(hostedMigration0014StatusUncertainMessage);
    }
    status = await runStatusQuery({ administratorPassword, caCertificate });
  } catch {
    status = null;
  }

  if (status === appliedStatus) {
    writeOutput(`${hostedMigration0014StatusAppliedMessage}\n`);
    return 0;
  }
  if (status === pendingStatus) {
    writeOutput(`${hostedMigration0014StatusPendingMessage}\n`);
    return 0;
  }
  writeOutput(`${hostedMigration0014StatusUncertainMessage}\n`);
  return 1;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runHostedMigration0014StatusCli();
}
