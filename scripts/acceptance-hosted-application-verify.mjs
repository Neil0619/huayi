import { pathToFileURL } from "node:url";

import {
  readHostedCredential,
  rejectLegacyHostedCredentialEnvironment,
} from "./acceptance-hosted-credentials.mjs";
import {
  hostedAcceptanceApplicationSessionPoolerUrl,
  hostedAcceptanceApplicationRole,
  hostedAcceptanceProjectRef,
  runHostedPsql,
} from "./acceptance-hosted-foundation.mjs";

export const hostedApplicationVerificationArgument = `--verify-hosted-application-login-${hostedAcceptanceProjectRef}`;

export function renderHostedApplicationContractSql() {
  return `
BEGIN READ ONLY;

SELECT session_user = '${hostedAcceptanceApplicationRole}',
  current_user = '${hostedAcceptanceApplicationRole}',
  pg_has_role(session_user, 'huayi_runtime', 'member'),
  NOT pg_has_role(session_user, 'postgres', 'SET'),
  NOT has_schema_privilege(session_user, 'public', 'CREATE'),
  COALESCE((
    SELECT NOT has_function_privilege(session_user, procedures.oid, 'EXECUTE')
    FROM pg_proc AS procedures
    JOIN pg_namespace AS namespaces ON namespaces.oid = procedures.pronamespace
    WHERE namespaces.nspname = 'huayi_private'
      AND procedures.proname = 'set_owner_context'
      AND procedures.prokind = 'f'
      AND procedures.pronargs = 1
      AND procedures.proargtypes[0] = 'uuid'::regtype
  ), false);

COMMIT;
`;
}

export function renderHostedApplicationContextSql() {
  return `
BEGIN;

SET LOCAL ROLE huayi_context_setter;
WITH applied AS (
  SELECT huayi_private.set_owner_context('00000000-0000-0000-0000-000000000001')
)
SELECT current_user = 'huayi_context_setter' AND (SELECT count(*) FROM applied) = 1,
  pg_backend_pid();

RESET ROLE;
SET LOCAL ROLE huayi_business;
SELECT session_user = '${hostedAcceptanceApplicationRole}'
  AND current_user = 'huayi_business'
  AND huayi_private.current_owner_user_id() = '00000000-0000-0000-0000-000000000001'
  AND NOT EXISTS (SELECT 1 FROM public.user_profiles);

COMMIT;

BEGIN READ ONLY;
SET LOCAL ROLE huayi_business;
SELECT huayi_private.current_owner_user_id() IS NULL, pg_backend_pid();
COMMIT;
`;
}

export function parseHostedApplicationContractOutput(stdout) {
  if (typeof stdout !== "string" || stdout.length === 0) return null;
  const lines = stdout.trim().split(/\r?\n/u);
  if (lines.length !== 1) return null;
  const contractTokens = lines[0].split("|");
  if (contractTokens.length !== 6 || !contractTokens.every((token) => /^[tf]$/u.test(token))) {
    return null;
  }
  return contractTokens.map((token) => token === "t");
}

export function parseHostedApplicationContextOutput(stdout) {
  if (typeof stdout !== "string" || stdout.length === 0) return null;
  const lines = stdout.trim().split(/\r?\n/u);
  if (lines.length !== 3) return null;
  const firstTransaction = lines[0].split("|");
  const secondTransaction = lines[2].split("|");
  if (
    firstTransaction.length !== 2 ||
    !/^[tf]$/u.test(firstTransaction[0]) ||
    !/^[1-9]\d*$/u.test(firstTransaction[1]) ||
    !/^[tf]$/u.test(lines[1]) ||
    secondTransaction.length !== 2 ||
    !/^[tf]$/u.test(secondTransaction[0]) ||
    !/^[1-9]\d*$/u.test(secondTransaction[1])
  ) {
    return null;
  }
  return {
    contextCleared: secondTransaction[0] === "t",
    contextSet: firstTransaction[0] === "t",
    contextVisible: lines[1] === "t",
    firstBackendPid: firstTransaction[1],
    secondBackendPid: secondTransaction[1],
  };
}

export function renderHostedForbiddenRoleSql() {
  return "BEGIN READ ONLY; SET LOCAL ROLE postgres; ROLLBACK;\n";
}

export async function verifyHostedApplicationLogin({
  arguments_ = process.argv.slice(2),
  environment = process.env,
  readCredential = readHostedCredential,
  runPsql = runHostedPsql,
} = {}) {
  if (arguments_.length !== 1 || arguments_[0] !== hostedApplicationVerificationArgument) {
    throw new Error("Hosted acceptance application login verification arguments are invalid.");
  }
  rejectLegacyHostedCredentialEnvironment(environment);
  const password = await readCredential("supabase-application-db-password", { environment });
  const connection = {
    databaseUrl: hostedAcceptanceApplicationSessionPoolerUrl,
    environment: {
      HUAYI_HOSTED_DATABASE_CA_CERTIFICATE: environment.HUAYI_HOSTED_DATABASE_CA_CERTIFICATE,
    },
    password,
  };
  const contractResult = await runPsql({
    ...connection,
    captureOutput: true,
    input: renderHostedApplicationContractSql(),
  });
  const contractPredicates =
    contractResult.code === 0 ? parseHostedApplicationContractOutput(contractResult.stdout) : null;
  if (contractPredicates === null || !contractPredicates.every(Boolean)) {
    throw new Error("Hosted acceptance application login verification failed.");
  }
  const contextResult = await runPsql({
    ...connection,
    captureOutput: true,
    input: renderHostedApplicationContextSql(),
  });
  const context =
    contextResult.code === 0 ? parseHostedApplicationContextOutput(contextResult.stdout) : null;
  if (
    context === null ||
    !context.contextSet ||
    !context.contextVisible ||
    !context.contextCleared ||
    context.firstBackendPid !== context.secondBackendPid
  ) {
    throw new Error("Hosted acceptance application login verification failed.");
  }
  const forbiddenRole = await runPsql({
    ...connection,
    captureErrorCode: true,
    captureOutput: false,
    input: renderHostedForbiddenRoleSql(),
  });
  if (forbiddenRole.code !== 3 || !/^ERROR:\s+42501\s*$/u.test(forbiddenRole.stderr)) {
    throw new Error("Hosted acceptance application login verification failed.");
  }
  return true;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  verifyHostedApplicationLogin()
    .then(() => process.stdout.write("Hosted acceptance application login verification passed.\n"))
    .catch(() => {
      process.stderr.write("Hosted acceptance application login verification failed.\n");
      process.exitCode = 1;
    });
}
