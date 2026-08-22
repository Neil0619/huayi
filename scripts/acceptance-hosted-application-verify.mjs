import { pathToFileURL } from "node:url";

import {
  hostedAcceptanceApplicationPoolerUrl,
  hostedAcceptanceApplicationRole,
  hostedAcceptanceProjectRef,
  requirePostgresPassword,
  runHostedPsql,
} from "./acceptance-hosted-foundation.mjs";

export const hostedApplicationVerificationArgument = `--verify-hosted-application-login-${hostedAcceptanceProjectRef}`;

export function renderHostedApplicationVerificationSql() {
  return `
BEGIN;

SELECT session_user = '${hostedAcceptanceApplicationRole}'
  AND current_user = '${hostedAcceptanceApplicationRole}'
  AND pg_has_role(session_user, 'huayi_runtime', 'member')
  AND NOT pg_has_role(session_user, 'postgres', 'SET')
  AND COALESCE((SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()), false)
  AND NOT has_schema_privilege(session_user, 'public', 'CREATE')
  AND NOT has_function_privilege(
    session_user, 'huayi_private.set_owner_context(uuid)', 'EXECUTE'
  );

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

export function renderHostedForbiddenRoleSql() {
  return "BEGIN READ ONLY; SET LOCAL ROLE postgres; ROLLBACK;\n";
}

export async function verifyHostedApplicationLogin({
  arguments_ = process.argv.slice(2),
  environment = process.env,
  runPsql = runHostedPsql,
} = {}) {
  if (arguments_.length !== 1 || arguments_[0] !== hostedApplicationVerificationArgument) {
    throw new Error("Hosted acceptance application login verification arguments are invalid.");
  }
  requirePostgresPassword(environment);
  let observedReuse = false;
  for (let attempt = 0; attempt < 12 && !observedReuse; attempt += 1) {
    const result = await runPsql({
      captureOutput: true,
      databaseUrl: hostedAcceptanceApplicationPoolerUrl,
      environment: {
        HUAYI_HOSTED_DATABASE_CA_CERTIFICATE: environment.HUAYI_HOSTED_DATABASE_CA_CERTIFICATE,
        PGPASSWORD: environment.PGPASSWORD,
      },
      input: renderHostedApplicationVerificationSql(),
    });
    const lines = result.stdout.trim().split("\n");
    const firstTransaction = lines[1]?.split("|");
    const secondTransaction = lines[3]?.split("|");
    if (
      result.code !== 0 ||
      lines[0] !== "t" ||
      firstTransaction?.[0] !== "t" ||
      lines[2] !== "t" ||
      secondTransaction?.[0] !== "t"
    ) {
      throw new Error("Hosted acceptance application login verification failed.");
    }
    observedReuse = firstTransaction[1] === secondTransaction[1];
  }
  if (!observedReuse) {
    throw new Error("Hosted acceptance application login verification failed.");
  }
  const forbiddenRole = await runPsql({
    captureErrorCode: true,
    captureOutput: false,
    databaseUrl: hostedAcceptanceApplicationPoolerUrl,
    environment: {
      HUAYI_HOSTED_DATABASE_CA_CERTIFICATE: environment.HUAYI_HOSTED_DATABASE_CA_CERTIFICATE,
      PGPASSWORD: environment.PGPASSWORD,
    },
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
