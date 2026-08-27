import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { runBoundedLocalInspection } from "./acceptance-local-docker-inspection.mjs";
import {
  hostedDeepseekMigrationBackupPreflightArgument,
  runHostedDeepseekMigrationBackupCli,
} from "./acceptance-hosted-deepseek-migration-backup.mjs";
import {
  hostedAcceptancePoolerUrl,
  hostedAcceptanceProjectRef,
  requireHostedCaCertificate,
} from "./acceptance-hosted-foundation.mjs";
import { readHiddenTerminalLine } from "./acceptance-hosted-important-batch-secret-prompt.mjs";
import { fetchHostedAcceptanceOfficialCaCertificate } from "./acceptance-hosted-official-ca.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const supabaseCommand = join(repositoryRoot, "node_modules", ".bin", "supabase");
const pinnedSupabaseCliVersion = "2.115.0";
const failureMessage =
  "Hosted DeepSeek 0016-0021 migration dry-run failed closed; database was not modified.";
const realCertificateIo = Object.freeze({ mkdtemp, rm, writeFile });

export const hostedDeepseekMigrationFilenames = Object.freeze([
  "20260827010000_hosted_deepseek_acceptance_authority.sql",
  "20260827020000_hosted_deepseek_acceptance_retention_scrub.sql",
  "20260827030000_hosted_deepseek_acceptance_status.sql",
  "20260827040000_hosted_deepseek_acceptance_effective_fuse.sql",
  "20260827050000_hosted_deepseek_acceptance_authority_mutations.sql",
  "20260827060000_hosted_deepseek_acceptance_evidence.sql",
]);
export const hostedDeepseekMigrationDryRunArgument = `--confirm-dry-run-hosted-deepseek-0016-0021-${hostedAcceptanceProjectRef}`;
export const hostedDeepseekMigrationDryRunSuccessMessage =
  "Supabase migration dry-run passed: exactly Hosted DeepSeek 0016-0021; database was not modified.";

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
  ...hostedDeepseekMigrationFilenames.map((filename) => ` • ${filename}`),
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

export function classifyHostedDeepseekMigrationDryRunTranscript({ stderr, stdout } = {}) {
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

export function hasExactHostedDeepseekMigrationDryRunTranscript(transcript) {
  return classifyHostedDeepseekMigrationDryRunTranscript(transcript).transcriptExact;
}

export async function verifyHostedDeepseekMigrationSupabaseCli({
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

export async function runHostedDeepseekMigrationDryRunPreflight({
  runBackupCli = runHostedDeepseekMigrationBackupCli,
} = {}) {
  try {
    return (
      (await runBackupCli({
        arguments_: [hostedDeepseekMigrationBackupPreflightArgument],
        writeError: () => undefined,
        writeOutput: () => undefined,
      })) === 0
    );
  } catch {
    return false;
  }
}

export async function runHostedDeepseekMigrationDryRunProcess(
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
  const certificateDirectory = await certificateIo.mkdtemp(
    join(tmpdir(), "huayi-hosted-deepseek-migrations-ca-"),
  );
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
        if (outputBytes > maxOutputBytes) {
          terminate();
        } else if (channel === "stderr") stderr += chunk;
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

export async function runHostedDeepseekMigrationDryRunCli({
  arguments_ = process.argv.slice(2),
  environment = process.env,
  fetchCaCertificate = fetchHostedAcceptanceOfficialCaCertificate,
  readPassword = readHiddenTerminalLine,
  runPreflight = runHostedDeepseekMigrationDryRunPreflight,
  runSupabase = runHostedDeepseekMigrationDryRunProcess,
  verifySupabaseCli = verifyHostedDeepseekMigrationSupabaseCli,
  writeError = (value) => process.stderr.write(value),
  writeOutput = (value) => process.stdout.write(value),
} = {}) {
  try {
    if (
      arguments_.length !== 1 ||
      arguments_[0] !== hostedDeepseekMigrationDryRunArgument ||
      environmentHasInheritedPassword(environment)
    ) {
      throw new Error(failureMessage);
    }
    if ((await runPreflight()) !== true) throw new Error(failureMessage);
    if ((await verifySupabaseCli()) !== true) throw new Error(failureMessage);
    const caCertificate = await fetchCaCertificate();
    const administratorPassword = await readPassword();
    const normalized = {
      administratorPassword,
      caCertificate,
    };
    if (!secretsAreValid(normalized)) throw new Error(failureMessage);
    const result = await runSupabase(normalized);
    if (result.code !== 0 || !hasExactHostedDeepseekMigrationDryRunTranscript(result)) {
      throw new Error(failureMessage);
    }
    writeOutput(`${hostedDeepseekMigrationDryRunSuccessMessage}\n`);
    return 0;
  } catch {
    writeError(`${failureMessage}\n`);
    return 1;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runHostedDeepseekMigrationDryRunCli();
}
