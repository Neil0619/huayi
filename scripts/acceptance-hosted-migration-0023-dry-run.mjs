import { pathToFileURL } from "node:url";

import { hostedAcceptanceProjectRef } from "./acceptance-hosted-foundation.mjs";
import { readHiddenTerminalLine } from "./acceptance-hosted-important-batch-secret-prompt.mjs";
import {
  runHostedMigration0022DryRunProcess,
  verifyHostedMigration0022SupabaseCli,
} from "./acceptance-hosted-migration-0022-dry-run.mjs";
import { fetchHostedAcceptanceOfficialCaCertificate } from "./acceptance-hosted-official-ca.mjs";
import {
  hostedPhase93MigrationBackupPreflightArgument,
  runHostedPhase93MigrationBackupCli,
} from "./acceptance-hosted-phase-93-migration-backup.mjs";

const failureMessage = "Hosted 0023 migration dry-run failed closed; database was not modified.";
export const hostedMigration0023Filename = "20260831010000_invitation_token_recovery.sql";
export const hostedMigration0023DryRunArgument = `--confirm-dry-run-20260831010000-invitation-token-recovery-${hostedAcceptanceProjectRef}`;
export const hostedMigration0023DryRunSuccessMessage = `Supabase migration dry-run passed: exactly ${hostedMigration0023Filename}; database was not modified.`;
const fixedLines = Object.freeze([
  "DRY RUN: migrations will *not* be pushed to the database.",
  "Connecting to remote database...",
  "Would push these migrations:",
  ` • ${hostedMigration0023Filename}`,
  "Finished supabase db push.",
]);

function inheritedPassword(environment) {
  return ["PGPASSWORD", "SUPABASE_DB_PASSWORD"].some((name) =>
    Object.prototype.hasOwnProperty.call(environment, name),
  );
}
function validSecrets(secrets) {
  return (
    secrets !== null &&
    typeof secrets === "object" &&
    typeof secrets.administratorPassword === "string" &&
    Buffer.byteLength(secrets.administratorPassword) >= 12 &&
    Buffer.byteLength(secrets.administratorPassword) <= 512 &&
    !/[\0\r\n]/u.test(secrets.administratorPassword) &&
    typeof secrets.caCertificate === "string"
  );
}
function classifyChannel(output) {
  if (output === "") return { indexes: [], valid: true };
  if (typeof output !== "string" || !output.endsWith("\n") || output.includes("\r")) {
    return { indexes: [], valid: false };
  }
  const indexes = output
    .slice(0, -1)
    .split("\n")
    .map((line) => fixedLines.indexOf(line.startsWith("• ") ? ` ${line}` : line));
  return {
    indexes,
    valid: indexes.every(
      (index, position) => index >= 0 && (position === 0 || indexes[position - 1] < index),
    ),
  };
}

export function hasExactHostedMigration0023DryRunTranscript({ stderr, stdout } = {}) {
  const channels = [classifyChannel(stderr), classifyChannel(stdout)];
  const indexes = channels.flatMap((channel) => channel.indexes).sort((a, b) => a - b);
  return (
    channels.every((channel) => channel.valid) &&
    indexes.length === fixedLines.length &&
    indexes.every((index, position) => index === position)
  );
}

export async function runHostedMigration0023DryRunPreflight({
  runBackupCli = runHostedPhase93MigrationBackupCli,
} = {}) {
  try {
    return (
      (await runBackupCli({
        arguments_: [hostedPhase93MigrationBackupPreflightArgument],
        writeError: () => undefined,
        writeOutput: () => undefined,
      })) === 0
    );
  } catch {
    return false;
  }
}

export async function runHostedMigration0023DryRunCli({
  arguments_ = process.argv.slice(2),
  environment = process.env,
  fetchCaCertificate = fetchHostedAcceptanceOfficialCaCertificate,
  readPassword = readHiddenTerminalLine,
  runPreflight = runHostedMigration0023DryRunPreflight,
  runSupabase = runHostedMigration0022DryRunProcess,
  verifySupabaseCli = verifyHostedMigration0022SupabaseCli,
  writeError = (value) => process.stderr.write(value),
  writeOutput = (value) => process.stdout.write(value),
} = {}) {
  try {
    if (
      arguments_.length !== 1 ||
      arguments_[0] !== hostedMigration0023DryRunArgument ||
      inheritedPassword(environment)
    )
      throw new Error(failureMessage);
    if ((await runPreflight()) !== true || (await verifySupabaseCli()) !== true) {
      throw new Error(failureMessage);
    }
    const secrets = {
      caCertificate: await fetchCaCertificate(),
      administratorPassword: await readPassword(),
    };
    if (!validSecrets(secrets)) throw new Error(failureMessage);
    const result = await runSupabase(secrets);
    if (result.code !== 0 || !hasExactHostedMigration0023DryRunTranscript(result)) {
      throw new Error(failureMessage);
    }
    writeOutput(`${hostedMigration0023DryRunSuccessMessage}\n`);
    return 0;
  } catch {
    writeError(`${failureMessage}\n`);
    return 1;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runHostedMigration0023DryRunCli();
}
