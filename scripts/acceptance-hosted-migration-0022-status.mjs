import { pathToFileURL } from "node:url";

import {
  hostedAcceptancePoolerUrl,
  hostedAcceptanceProjectRef,
  runHostedPsql,
} from "./acceptance-hosted-foundation.mjs";
import { readHiddenTerminalLine } from "./acceptance-hosted-important-batch-secret-prompt.mjs";
import { renderHostedMigration0022StateCtes } from "./acceptance-hosted-migration-0022-status-contract.mjs";
import { fetchHostedAcceptanceOfficialCaCertificate } from "./acceptance-hosted-official-ca.mjs";

const appliedStatus = "applied_exact";
const pendingStatus = "pending_exact";
const uncertainStatus = "uncertain";

export const hostedMigration0022StatusArgument = `--status-20260828010000-password-signup-expired-invitation-recovery-${hostedAcceptanceProjectRef}`;
export const hostedMigration0022StatusAppliedMessage =
  "Hosted 0022 migration status: applied-exact.";
export const hostedMigration0022StatusPendingMessage =
  "Hosted 0022 migration status: pending-exact.";
export const hostedMigration0022StatusUncertainMessage =
  "Hosted 0022 migration status: uncertain; do not retry apply.";

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

export function renderHostedMigration0022StatusSql() {
  return `
BEGIN READ ONLY;
WITH ${renderHostedMigration0022StateCtes()}
SELECT CASE
  WHEN applied_state_exact THEN 'applied_exact'
  WHEN pending_state_exact THEN 'pending_exact'
  ELSE 'uncertain'
END
FROM status_state;
ROLLBACK;
`;
}

export function parseHostedMigration0022StatusOutput(output) {
  return new Set(["applied_exact\n", "pending_exact\n", "uncertain\n"]).has(output)
    ? output.slice(0, -1)
    : null;
}

export async function runHostedMigration0022StatusQuery(
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
    input: renderHostedMigration0022StatusSql(),
    timeoutMilliseconds: 30_000,
  });
  return result.code === 0 ? parseHostedMigration0022StatusOutput(result.stdout) : null;
}

export async function runHostedMigration0022StatusCli({
  arguments_ = process.argv.slice(2),
  environment = process.env,
  fetchCaCertificate = fetchHostedAcceptanceOfficialCaCertificate,
  readPassword = readHiddenTerminalLine,
  runStatusQuery = runHostedMigration0022StatusQuery,
  writeOutput = (value) => process.stdout.write(value),
} = {}) {
  let status = uncertainStatus;
  try {
    if (
      arguments_.length !== 1 ||
      arguments_[0] !== hostedMigration0022StatusArgument ||
      environmentHasInheritedPassword(environment)
    ) {
      throw new Error(hostedMigration0022StatusUncertainMessage);
    }
    const caCertificate = await fetchCaCertificate();
    const administratorPassword = await readPassword();
    if (!passwordIsValid(administratorPassword)) {
      throw new Error(hostedMigration0022StatusUncertainMessage);
    }
    status = (await runStatusQuery({ administratorPassword, caCertificate })) ?? uncertainStatus;
  } catch {
    status = uncertainStatus;
  }
  if (status === appliedStatus) {
    writeOutput(`${hostedMigration0022StatusAppliedMessage}\n`);
    return 0;
  }
  if (status === pendingStatus) {
    writeOutput(`${hostedMigration0022StatusPendingMessage}\n`);
    return 0;
  }
  writeOutput(`${hostedMigration0022StatusUncertainMessage}\n`);
  return 1;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runHostedMigration0022StatusCli();
}
