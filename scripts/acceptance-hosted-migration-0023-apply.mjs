import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { hostedAcceptanceProjectRef } from "./acceptance-hosted-foundation.mjs";
import { readHiddenTerminalLine } from "./acceptance-hosted-important-batch-secret-prompt.mjs";
import { runHostedMigration0022ApplyProcess } from "./acceptance-hosted-migration-0022-apply.mjs";
import {
  runHostedMigration0022DryRunProcess,
  verifyHostedMigration0022SupabaseCli,
} from "./acceptance-hosted-migration-0022-dry-run.mjs";
import {
  hasExactHostedMigration0023DryRunTranscript,
  hostedMigration0023Filename,
} from "./acceptance-hosted-migration-0023-dry-run.mjs";
import { runHostedMigration0023StatusQuery } from "./acceptance-hosted-migration-0023-status.mjs";
import { fetchHostedAcceptanceOfficialCaCertificate } from "./acceptance-hosted-official-ca.mjs";
import {
  hostedPhase93MigrationBackupPreflightArgument,
  runHostedPhase93MigrationBackupCli,
} from "./acceptance-hosted-phase-93-migration-backup.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceSha256 = "1530fcbe8abc53d08abc246d4556ef5824378b5b066a2ef7906ca07b01689956";
const failureMessage =
  "Hosted 0023 migration apply did not produce verified completion; do not retry until remote state is checked.";
export const hostedMigration0023ApplyArgument = `--confirm-apply-20260831010000-invitation-token-recovery-${hostedAcceptanceProjectRef}`;
export const hostedMigration0023ApplySuccessMessage = `Supabase migration applied and verified: exactly ${hostedMigration0023Filename}.`;

function inheritedPassword(environment) {
  return ["PGPASSWORD", "SUPABASE_DB_PASSWORD"].some((name) =>
    Object.prototype.hasOwnProperty.call(environment, name),
  );
}
function validPassword(value) {
  return (
    typeof value === "string" &&
    Buffer.byteLength(value) >= 12 &&
    Buffer.byteLength(value) <= 512 &&
    !/[\0\r\n]/u.test(value)
  );
}

export async function verifyHostedMigration0023RepositoryIdentity({
  readMigrationFile = readFile,
} = {}) {
  try {
    const [canonical, mirror] = await Promise.all([
      readMigrationFile(
        join(repositoryRoot, "supabase", "migrations", hostedMigration0023Filename),
      ),
      readMigrationFile(
        join(repositoryRoot, "apps", "api", "migrations", "0023-invitation-token-recovery.sql"),
      ),
    ]);
    if (
      !Buffer.isBuffer(canonical) ||
      !Buffer.isBuffer(mirror) ||
      !canonical.equals(mirror) ||
      createHash("sha256").update(canonical).digest("hex") !== sourceSha256
    )
      throw new Error("invalid");
    return true;
  } catch {
    throw new Error("Hosted 0023 migration repository identity is invalid.");
  }
}

export async function runHostedMigration0023Preflight({
  runBackupCli = runHostedPhase93MigrationBackupCli,
  verifyRepositoryIdentity = verifyHostedMigration0023RepositoryIdentity,
  verifySupabaseCli = verifyHostedMigration0022SupabaseCli,
} = {}) {
  if (
    (await runBackupCli({
      arguments_: [hostedPhase93MigrationBackupPreflightArgument],
      writeError: () => undefined,
      writeOutput: () => undefined,
    })) !== 0
  )
    return false;
  try {
    return (await verifyRepositoryIdentity()) === true && (await verifySupabaseCli()) === true;
  } catch {
    return false;
  }
}

export async function runHostedMigration0023ApplyCli({
  arguments_ = process.argv.slice(2),
  environment = process.env,
  fetchCaCertificate = fetchHostedAcceptanceOfficialCaCertificate,
  readPassword = readHiddenTerminalLine,
  runApply = runHostedMigration0022ApplyProcess,
  runDryRun = runHostedMigration0022DryRunProcess,
  runPostflight = async (secrets) =>
    (await runHostedMigration0023StatusQuery(secrets)) === "applied_exact",
  runPreflight = runHostedMigration0023Preflight,
  runStatus = runHostedMigration0023StatusQuery,
  writeError = (value) => process.stderr.write(value),
  writeOutput = (value) => process.stdout.write(value),
} = {}) {
  try {
    if (
      arguments_.length !== 1 ||
      arguments_[0] !== hostedMigration0023ApplyArgument ||
      inheritedPassword(environment) ||
      (await runPreflight()) !== true
    )
      throw new Error(failureMessage);
    const secrets = {
      caCertificate: await fetchCaCertificate(),
      administratorPassword: await readPassword(),
    };
    if (!validPassword(secrets.administratorPassword)) throw new Error(failureMessage);
    const dryRun = await runDryRun(secrets);
    if (
      dryRun?.code !== 0 ||
      !hasExactHostedMigration0023DryRunTranscript(dryRun) ||
      (await runPreflight()) !== true ||
      (await runStatus(secrets)) !== "pending_exact"
    ) {
      throw new Error(failureMessage);
    }
    const applied = await runApply(secrets);
    if (applied.code !== 0 || (await runPostflight(secrets)) !== true)
      throw new Error(failureMessage);
    writeOutput(`${hostedMigration0023ApplySuccessMessage}\n`);
    return 0;
  } catch {
    writeError(`${failureMessage}\n`);
    return 1;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runHostedMigration0023ApplyCli();
}
