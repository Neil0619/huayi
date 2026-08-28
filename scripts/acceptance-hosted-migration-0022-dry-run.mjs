import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { runBoundedLocalInspection } from "./acceptance-local-docker-inspection.mjs";
import {
  hostedAcceptancePoolerUrl,
  hostedAcceptanceProjectRef,
  requireHostedCaCertificate,
} from "./acceptance-hosted-foundation.mjs";
import { readHiddenTerminalLine } from "./acceptance-hosted-important-batch-secret-prompt.mjs";
import { fetchHostedAcceptanceOfficialCaCertificate } from "./acceptance-hosted-official-ca.mjs";
import {
  hostedPhase92MigrationBackupPreflightArgument,
  runHostedPhase92MigrationBackupCli,
} from "./acceptance-hosted-phase-92-migration-backup.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const supabaseCommand = join(repositoryRoot, "node_modules", ".bin", "supabase");
const pinnedSupabaseCliVersion = "2.115.0";
const failureMessage = "Hosted 0022 migration dry-run failed closed; database was not modified.";
const realCertificateIo = Object.freeze({ mkdtemp, rm, writeFile });

export const hostedMigration0022Filename =
  "20260828010000_password_signup_expired_invitation_recovery.sql";
export const hostedMigration0022DryRunArgument = `--confirm-dry-run-20260828010000-password-signup-expired-invitation-recovery-${hostedAcceptanceProjectRef}`;
export const hostedMigration0022DryRunSuccessMessage = `Supabase migration dry-run passed: exactly ${hostedMigration0022Filename}; database was not modified.`;

const fixedSupabaseArguments = Object.freeze([
  "db",
  "push",
  "--dry-run",
  "--skip-vault",
  "--db-url",
  hostedAcceptancePoolerUrl,
]);
const fixedDryRunLines = Object.freeze([
  "DRY RUN: migrations will *not* be pushed to the database.",
  "Connecting to remote database...",
  "Would push these migrations:",
  ` • ${hostedMigration0022Filename}`,
  "Finished supabase db push.",
]);

function environmentHasInheritedPassword(environment) {
  return ["PGPASSWORD", "SUPABASE_DB_PASSWORD"].some((name) =>
    Object.prototype.hasOwnProperty.call(environment, name),
  );
}

function secretsAreValid(secrets) {
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
  if (typeof output !== "string") {
    return { indexes: [], linesAllowlisted: false, orderExact: false };
  }
  if (output === "") return { indexes: [], linesAllowlisted: true, orderExact: true };
  if (!output.endsWith("\n") || output.includes("\r")) {
    return { indexes: [], linesAllowlisted: false, orderExact: false };
  }
  const indexes = [];
  for (const line of output.slice(0, -1).split("\n")) {
    const normalized = line.startsWith("• ") ? ` ${line}` : line;
    const index = fixedDryRunLines.indexOf(normalized);
    if (index === -1) return { indexes: [], linesAllowlisted: false, orderExact: false };
    indexes.push(index);
  }
  return {
    indexes,
    linesAllowlisted: true,
    orderExact: indexes.every((index, position) => position === 0 || indexes[position - 1] < index),
  };
}

export function classifyHostedMigration0022DryRunTranscript({ stderr, stdout } = {}) {
  const stderrClassification = classifyChannel(stderr);
  const stdoutClassification = classifyChannel(stdout);
  const indexes = [...stderrClassification.indexes, ...stdoutClassification.indexes].sort(
    (left, right) => left - right,
  );
  const lineMultisetExact =
    stderrClassification.linesAllowlisted &&
    stdoutClassification.linesAllowlisted &&
    indexes.length === fixedDryRunLines.length &&
    indexes.every((index, position) => index === position);
  const channelRelativeOrderExact =
    stderrClassification.orderExact && stdoutClassification.orderExact;
  return Object.freeze({
    channelRelativeOrderExact,
    lineMultisetExact,
    stderrLinesAllowlisted: stderrClassification.linesAllowlisted,
    stdoutLinesAllowlisted: stdoutClassification.linesAllowlisted,
    transcriptExact: lineMultisetExact && channelRelativeOrderExact,
  });
}

export function hasExactHostedMigration0022DryRunTranscript(transcript) {
  return classifyHostedMigration0022DryRunTranscript(transcript).transcriptExact;
}

export async function verifyHostedMigration0022SupabaseCli({
  runInspection = (command, arguments_) =>
    runBoundedLocalInspection(command, arguments_, {
      maxOutputBytes: 32,
      timeoutMilliseconds: 5_000,
    }),
} = {}) {
  try {
    const result = await runInspection(supabaseCommand, ["--version"]);
    return (
      result.code === 0 &&
      new Set([
        pinnedSupabaseCliVersion,
        `${pinnedSupabaseCliVersion}\n`,
        `${pinnedSupabaseCliVersion}\r\n`,
      ]).has(result.stdout)
    );
  } catch {
    return false;
  }
}

export async function runHostedMigration0022DryRunPreflight({
  runBackupCli = runHostedPhase92MigrationBackupCli,
} = {}) {
  try {
    return (
      (await runBackupCli({
        arguments_: [hostedPhase92MigrationBackupPreflightArgument],
        writeError: () => undefined,
        writeOutput: () => undefined,
      })) === 0
    );
  } catch {
    return false;
  }
}

export async function runHostedMigration0022DryRunProcess(
  { administratorPassword, caCertificate },
  {
    certificateIo = realCertificateIo,
    maxOutputBytes = 131_072,
    spawnProcess = spawn,
    timeoutMilliseconds = 300_000,
  } = {},
) {
  const certificate = requireHostedCaCertificate({
    HUAYI_HOSTED_DATABASE_CA_CERTIFICATE: caCertificate,
  });
  const certificateDirectory = await certificateIo.mkdtemp(join(tmpdir(), "huayi-hosted-0022-ca-"));
  const rootCertificate = join(certificateDirectory, "root.crt");
  try {
    await certificateIo.writeFile(rootCertificate, certificate, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    return await new Promise((resolveResult) => {
      let settled = false;
      let outputBytes = 0;
      let stderr = "";
      let stdout = "";
      let invalidResult = false;
      let timeout;
      const finish = (result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolveResult(result);
      };
      let child;
      try {
        child = spawnProcess(supabaseCommand, fixedSupabaseArguments, {
          cwd: repositoryRoot,
          env: {
            LANG: "C",
            LC_ALL: "C",
            PGPASSWORD: administratorPassword,
            PGSSLMODE: "verify-full",
            PGSSLROOTCERT: rootCertificate,
            SUPABASE_NO_UPDATE_NOTIFIER: "1",
          },
          shell: false,
          stdio: ["ignore", "pipe", "pipe"],
          windowsHide: true,
        });
      } catch {
        finish({ code: null, stderr: "", stdout: "" });
        return;
      }
      const terminate = () => {
        invalidResult = true;
        stderr = "";
        stdout = "";
        try {
          child.kill("SIGKILL");
        } catch {
          // The process may already have exited; the fixed failure result still wins.
        }
        finish({ code: null, stderr: "", stdout: "" });
      };
      timeout = setTimeout(terminate, timeoutMilliseconds);
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      const capture = (channel) => (chunk) => {
        outputBytes += Buffer.byteLength(chunk);
        if (outputBytes > maxOutputBytes) terminate();
        else if (channel === "stderr") stderr += chunk;
        else stdout += chunk;
      };
      child.stdout.on("data", capture("stdout"));
      child.stderr.on("data", capture("stderr"));
      child.once("error", () => finish({ code: null, stderr: "", stdout: "" }));
      child.once("close", (code, signal) => {
        finish({
          code: invalidResult || signal !== null ? null : code,
          stderr: invalidResult ? "" : stderr,
          stdout: invalidResult ? "" : stdout,
        });
      });
    });
  } finally {
    await certificateIo.rm(certificateDirectory, { force: true, recursive: true });
  }
}

export async function runHostedMigration0022DryRunCli({
  arguments_ = process.argv.slice(2),
  environment = process.env,
  fetchCaCertificate = fetchHostedAcceptanceOfficialCaCertificate,
  readPassword = readHiddenTerminalLine,
  runPreflight = runHostedMigration0022DryRunPreflight,
  runSupabase = runHostedMigration0022DryRunProcess,
  verifySupabaseCli = verifyHostedMigration0022SupabaseCli,
  writeError = (value) => process.stderr.write(value),
  writeOutput = (value) => process.stdout.write(value),
} = {}) {
  try {
    if (
      arguments_.length !== 1 ||
      arguments_[0] !== hostedMigration0022DryRunArgument ||
      environmentHasInheritedPassword(environment)
    ) {
      throw new Error(failureMessage);
    }
    if ((await runPreflight()) !== true) throw new Error(failureMessage);
    if ((await verifySupabaseCli()) !== true) throw new Error(failureMessage);
    const caCertificate = await fetchCaCertificate();
    const administratorPassword = await readPassword();
    const secrets = { administratorPassword, caCertificate };
    if (!secretsAreValid(secrets)) throw new Error(failureMessage);
    const result = await runSupabase(secrets);
    if (result.code !== 0 || !hasExactHostedMigration0022DryRunTranscript(result)) {
      throw new Error(failureMessage);
    }
    writeOutput(`${hostedMigration0022DryRunSuccessMessage}\n`);
    return 0;
  } catch {
    writeError(`${failureMessage}\n`);
    return 1;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runHostedMigration0022DryRunCli();
}
