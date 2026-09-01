import { pathToFileURL } from "node:url";

import {
  hostedAcceptancePoolerUrl,
  hostedAcceptanceProjectRef,
  runHostedPsql,
} from "./acceptance-hosted-foundation.mjs";
import {
  readHostedAdministratorPassword,
  rejectLegacyHostedCredentialEnvironment,
} from "./acceptance-hosted-credentials.mjs";
import {
  classifyHostedMigration0014DryRunTranscript,
  runHostedMigration0014DryRunProcess,
} from "./acceptance-hosted-migration-0014-dry-run.mjs";
import { fetchHostedAcceptanceOfficialCaCertificate } from "./acceptance-hosted-official-ca.mjs";

const failureStages = new Set([
  "arguments",
  "ca-fetch",
  "credential-read",
  "password-validation",
  "connection-probe",
  "dry-run-process",
]);

export const hostedMigration0014DiagnosticArgument = `--diagnose-20260824010000-password-signup-otp-resend-${hostedAcceptanceProjectRef}`;

function environmentHasInheritedPassword(environment) {
  try {
    rejectLegacyHostedCredentialEnvironment(environment);
    return false;
  } catch {
    return true;
  }
}

function passwordIsValid(password) {
  return (
    typeof password === "string" &&
    Buffer.byteLength(password) > 0 &&
    Buffer.byteLength(password) <= 512 &&
    !/[\0\r\n]/u.test(password)
  );
}

export function classifyHostedMigration0014ConnectionExitCode(code) {
  if (code === 0) return "ok";
  if (code === 1) return "client_fatal";
  if (code === 2) return "connection_error";
  if (code === 3) return "script_error";
  if (code === null) return "process_error";
  return "unexpected_error";
}

export function classifyHostedMigration0014CommandExitCode(code) {
  if (code === 0) return "ok";
  if (code === null) return "process_error";
  if (Number.isInteger(code)) return "command_error";
  return "unexpected_error";
}

function renderFailure(stage) {
  if (!failureStages.has(stage)) throw new Error("Hosted 0014 diagnostic stage is invalid.");
  return `Hosted 0014 migration safe diagnostic failed at allowlisted stage ${stage}.`;
}

export async function runHostedMigration0014ConnectionProbe(
  { administratorPassword, caCertificate },
  { runPsql = runHostedPsql } = {},
) {
  return runPsql({
    captureErrorCode: false,
    captureOutput: true,
    databaseUrl: `${hostedAcceptancePoolerUrl}&connect_timeout=10`,
    environment: {
      HUAYI_HOSTED_DATABASE_CA_CERTIFICATE: caCertificate,
    },
    input: "SELECT 'connection_ok|t';\n",
    password: administratorPassword,
    timeoutMilliseconds: 15_000,
  });
}

export async function runHostedMigration0014DiagnosticCli({
  arguments_ = process.argv.slice(2),
  environment = process.env,
  fetchCaCertificate = fetchHostedAcceptanceOfficialCaCertificate,
  readPassword = readHostedAdministratorPassword,
  runConnectionProbe = runHostedMigration0014ConnectionProbe,
  runDryRun = runHostedMigration0014DryRunProcess,
  writeError = (value) => process.stderr.write(value),
  writeOutput = (value) => process.stdout.write(value),
} = {}) {
  let failureStage = "arguments";
  try {
    if (
      arguments_.length !== 1 ||
      arguments_[0] !== hostedMigration0014DiagnosticArgument ||
      environmentHasInheritedPassword(environment)
    ) {
      throw new Error(renderFailure(failureStage));
    }
    failureStage = "ca-fetch";
    const caCertificate = await fetchCaCertificate();
    failureStage = "credential-read";
    const administratorPassword = await readPassword({ environment });
    failureStage = "password-validation";
    if (!passwordIsValid(administratorPassword)) throw new Error(renderFailure(failureStage));
    failureStage = "connection-probe";
    const connection = await runConnectionProbe({ administratorPassword, caCertificate });
    const connectionOutputExact =
      connection.code === 0 && connection.stdout === "connection_ok|t\n";
    const lines = [
      `connection_exit_class|${classifyHostedMigration0014ConnectionExitCode(connection.code)}`,
      `connection_output_exact|${connectionOutputExact ? "t" : "f"}`,
    ];
    if (!connectionOutputExact) {
      lines.push(
        "dry_run_exit_class|not_run",
        "dry_run_stdout_empty|f",
        "dry_run_stdout_lines_allowlisted|f",
        "dry_run_stderr_lines_allowlisted|f",
        "dry_run_line_multiset_exact|f",
        "dry_run_channel_relative_order_exact|f",
        "dry_run_transcript_exact|f",
      );
    } else {
      failureStage = "dry-run-process";
      const dryRun = await runDryRun({ administratorPassword, caCertificate });
      const transcript = classifyHostedMigration0014DryRunTranscript(dryRun);
      lines.push(
        `dry_run_exit_class|${classifyHostedMigration0014CommandExitCode(dryRun.code)}`,
        `dry_run_stdout_empty|${dryRun.stdout === "" ? "t" : "f"}`,
        `dry_run_stdout_lines_allowlisted|${transcript.stdoutLinesAllowlisted ? "t" : "f"}`,
        `dry_run_stderr_lines_allowlisted|${transcript.stderrLinesAllowlisted ? "t" : "f"}`,
        `dry_run_line_multiset_exact|${transcript.lineMultisetExact ? "t" : "f"}`,
        `dry_run_channel_relative_order_exact|${transcript.channelRelativeOrderExact ? "t" : "f"}`,
        `dry_run_transcript_exact|${transcript.transcriptExact ? "t" : "f"}`,
      );
    }
    writeOutput(`${lines.join("\n")}\n`);
    return 0;
  } catch {
    writeError(`${renderFailure(failureStage)}\n`);
    return 1;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runHostedMigration0014DiagnosticCli();
}
