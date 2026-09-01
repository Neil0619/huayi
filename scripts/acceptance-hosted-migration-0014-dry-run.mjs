import { spawn } from "node:child_process";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  hostedAcceptancePoolerUrl,
  hostedAcceptanceProjectRef,
  renderHostedPgpass,
  requireHostedCaCertificate,
} from "./acceptance-hosted-foundation.mjs";
import {
  readHostedAdministratorPassword,
  rejectLegacyHostedCredentialEnvironment,
} from "./acceptance-hosted-credentials.mjs";
import { fetchHostedAcceptanceOfficialCaCertificate } from "./acceptance-hosted-official-ca.mjs";
import { withHostedSignalAwareCleanup } from "./acceptance-hosted-signal-aware-cleanup.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const supabaseCommand = join(repositoryRoot, "node_modules", ".bin", "supabase");
const failureMessage = "Hosted 0014 migration dry-run failed closed; database was not modified.";
const realCertificateIo = Object.freeze({ chmod, mkdtemp, rm, writeFile });

export const hostedMigration0014Filename = "20260824010000_password_signup_otp_resend.sql";
export const hostedMigration0014DryRunArgument = `--confirm-dry-run-20260824010000-password-signup-otp-resend-${hostedAcceptanceProjectRef}`;
export const hostedMigration0014SuccessMessage = `Supabase migration dry-run passed: exactly ${hostedMigration0014Filename}; database was not modified.`;

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
  ` • ${hostedMigration0014Filename}`,
  "Finished supabase db push.",
]);

function passwordIsValid(password) {
  return (
    typeof password === "string" &&
    Buffer.byteLength(password) > 0 &&
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

export function parseHostedMigration0014DryRunOutput(output) {
  return classifyHostedMigration0014DryRunTranscript({ stderr: output, stdout: "" })
    .transcriptExact;
}

function classifyDryRunChannel(output) {
  if (typeof output !== "string") {
    return { indexes: [], linesAllowlisted: false, orderExact: false };
  }
  if (output === "") return { indexes: [], linesAllowlisted: true, orderExact: true };
  if (!output.endsWith("\n")) {
    return { indexes: [], linesAllowlisted: false, orderExact: false };
  }

  const lines = output.slice(0, -1).split("\n");
  const indexes = [];
  for (const line of lines) {
    const index = /^(?: )?• 20260824010000_password_signup_otp_resend\.sql$/u.test(line)
      ? 3
      : fixedDryRunLines.indexOf(line);
    if (index === -1) {
      return { indexes: [], linesAllowlisted: false, orderExact: false };
    }
    indexes.push(index);
  }
  return {
    indexes,
    linesAllowlisted: true,
    orderExact: indexes.every((index, position) => position === 0 || indexes[position - 1] < index),
  };
}

export function classifyHostedMigration0014DryRunTranscript({ stderr, stdout } = {}) {
  const stderrClassification = classifyDryRunChannel(stderr);
  const stdoutClassification = classifyDryRunChannel(stdout);
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

export function hasExactHostedMigration0014DryRunTranscript({ stderr, stdout } = {}) {
  return classifyHostedMigration0014DryRunTranscript({ stderr, stdout }).transcriptExact;
}

export async function runHostedMigration0014DryRunProcess(
  { administratorPassword, caCertificate },
  {
    certificateIo = realCertificateIo,
    maxOutputBytes = 131_072,
    process_ = process,
    spawnProcess = spawn,
    timeoutMilliseconds = 300_000,
  } = {},
) {
  const certificate = requireHostedCaCertificate({
    HUAYI_HOSTED_DATABASE_CA_CERTIFICATE: caCertificate,
  });
  const certificateDirectory = await certificateIo.mkdtemp(join(tmpdir(), "huayi-hosted-0014-ca-"));
  const rootCertificate = join(certificateDirectory, "root.crt");
  const passwordFile = join(certificateDirectory, ".pgpass");
  return withHostedSignalAwareCleanup({
    cleanup: () => certificateIo.rm(certificateDirectory, { force: true, recursive: true }),
    process_,
    run: async ({ registerChild }) => {
      await certificateIo.chmod(certificateDirectory, 0o700);
      await certificateIo.writeFile(rootCertificate, certificate, {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      });
      await certificateIo.writeFile(
        passwordFile,
        `${renderHostedPgpass(hostedAcceptancePoolerUrl, administratorPassword)}\n`,
        { encoding: "utf8", flag: "wx", mode: 0o600 },
      );
      return new Promise((resolveResult) => {
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
        const child = spawnProcess(supabaseCommand, fixedSupabaseArguments, {
          cwd: repositoryRoot,
          env: {
            LANG: "C",
            LC_ALL: "C",
            PGPASSFILE: passwordFile,
            PGSSLMODE: "verify-full",
            PGSSLROOTCERT: rootCertificate,
          },
          shell: false,
          stdio: ["ignore", "pipe", "pipe"],
          windowsHide: true,
        });
        registerChild(child);
        timeout = setTimeout(() => {
          invalidResult = true;
          child.kill("SIGKILL");
        }, timeoutMilliseconds);
        child.stdout.setEncoding("utf8");
        child.stderr.setEncoding("utf8");
        const captureOutput = (channel) => (chunk) => {
          outputBytes += Buffer.byteLength(chunk);
          if (outputBytes > maxOutputBytes) {
            invalidResult = true;
            stderr = "";
            stdout = "";
            child.kill("SIGKILL");
            return;
          }
          if (channel === "stderr") stderr += chunk;
          else stdout += chunk;
        };
        child.stdout.on("data", captureOutput("stdout"));
        child.stderr.on("data", captureOutput("stderr"));
        child.once("error", () => finish({ code: null, stderr: "", stdout: "" }));
        child.once("close", (code, signal) => {
          finish({
            code: invalidResult || signal !== null ? null : code,
            stderr: invalidResult ? "" : stderr,
            stdout: invalidResult ? "" : stdout,
          });
        });
      });
    },
  });
}

export async function runHostedMigration0014DryRunCli({
  arguments_ = process.argv.slice(2),
  environment = process.env,
  fetchCaCertificate = fetchHostedAcceptanceOfficialCaCertificate,
  readPassword = readHostedAdministratorPassword,
  runSupabase = runHostedMigration0014DryRunProcess,
  writeError = (value) => process.stderr.write(value),
  writeOutput = (value) => process.stdout.write(value),
} = {}) {
  try {
    if (
      arguments_.length !== 1 ||
      arguments_[0] !== hostedMigration0014DryRunArgument ||
      environmentHasInheritedPassword(environment)
    ) {
      throw new Error(failureMessage);
    }
    const caCertificate = await fetchCaCertificate();
    const password = await readPassword({ environment });
    if (!passwordIsValid(password)) throw new Error(failureMessage);
    const result = await runSupabase({ administratorPassword: password, caCertificate });
    if (result.code !== 0 || !hasExactHostedMigration0014DryRunTranscript(result)) {
      throw new Error(failureMessage);
    }
    writeOutput(`${hostedMigration0014SuccessMessage}\n`);
    return 0;
  } catch {
    writeError(`${failureMessage}\n`);
    return 1;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runHostedMigration0014DryRunCli();
}
