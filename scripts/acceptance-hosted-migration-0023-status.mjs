import { pathToFileURL } from "node:url";

import {
  hostedAcceptancePoolerUrl,
  hostedAcceptanceProjectRef,
  runHostedPsql,
} from "./acceptance-hosted-foundation.mjs";
import { readHiddenTerminalLine } from "./acceptance-hosted-important-batch-secret-prompt.mjs";
import { renderHostedMigration0023StateCtes } from "./acceptance-hosted-migration-0023-status-contract.mjs";
import { fetchHostedAcceptanceOfficialCaCertificate } from "./acceptance-hosted-official-ca.mjs";

export const hostedMigration0023StatusArgument = `--status-20260831010000-invitation-token-recovery-${hostedAcceptanceProjectRef}`;
export const hostedMigration0023StatusAppliedMessage =
  "Hosted 0023 migration status: applied-exact.";
export const hostedMigration0023StatusPendingMessage =
  "Hosted 0023 migration status: pending-exact.";
export const hostedMigration0023StatusUncertainMessage =
  "Hosted 0023 migration status: uncertain; do not retry apply.";

function validPassword(value) {
  return (
    typeof value === "string" &&
    Buffer.byteLength(value) >= 12 &&
    Buffer.byteLength(value) <= 512 &&
    !/[\0\r\n]/u.test(value)
  );
}
function inheritedPassword(environment) {
  return ["PGPASSWORD", "SUPABASE_DB_PASSWORD"].some((name) =>
    Object.prototype.hasOwnProperty.call(environment, name),
  );
}

export function renderHostedMigration0023StatusSql() {
  return `
BEGIN READ ONLY;
WITH ${renderHostedMigration0023StateCtes()}
SELECT CASE WHEN applied_state_exact THEN 'applied_exact'
  WHEN pending_state_exact THEN 'pending_exact' ELSE 'uncertain' END
FROM status_state;
ROLLBACK;
`;
}

export function parseHostedMigration0023StatusOutput(output) {
  return new Set(["applied_exact\n", "pending_exact\n", "uncertain\n"]).has(output)
    ? output.slice(0, -1)
    : null;
}

export async function runHostedMigration0023StatusQuery(
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
    input: renderHostedMigration0023StatusSql(),
    timeoutMilliseconds: 30_000,
  });
  return result.code === 0 ? parseHostedMigration0023StatusOutput(result.stdout) : null;
}

export async function runHostedMigration0023StatusCli({
  arguments_ = process.argv.slice(2),
  environment = process.env,
  fetchCaCertificate = fetchHostedAcceptanceOfficialCaCertificate,
  readPassword = readHiddenTerminalLine,
  runStatusQuery = runHostedMigration0023StatusQuery,
  writeOutput = (value) => process.stdout.write(value),
} = {}) {
  let status = "uncertain";
  try {
    if (
      arguments_.length !== 1 ||
      arguments_[0] !== hostedMigration0023StatusArgument ||
      inheritedPassword(environment)
    )
      throw new Error("invalid");
    const caCertificate = await fetchCaCertificate();
    const administratorPassword = await readPassword();
    if (!validPassword(administratorPassword)) throw new Error("invalid");
    status = (await runStatusQuery({ administratorPassword, caCertificate })) ?? "uncertain";
  } catch {
    status = "uncertain";
  }
  if (status === "applied_exact") {
    writeOutput(`${hostedMigration0023StatusAppliedMessage}\n`);
    return 0;
  }
  if (status === "pending_exact") {
    writeOutput(`${hostedMigration0023StatusPendingMessage}\n`);
    return 0;
  }
  writeOutput(`${hostedMigration0023StatusUncertainMessage}\n`);
  return 1;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runHostedMigration0023StatusCli();
}
