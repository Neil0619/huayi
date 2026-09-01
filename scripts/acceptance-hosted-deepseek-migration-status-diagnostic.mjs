import { pathToFileURL } from "node:url";

import {
  hostedAcceptancePoolerUrl,
  hostedAcceptanceProjectRef,
  runHostedPsql,
} from "./acceptance-hosted-foundation.mjs";
import {
  hostedDeepseekMigrationStatusDiagnosticPredicateNames as predicateNames,
  renderHostedDeepseekMigrationStatusDiagnosticSql,
} from "./acceptance-hosted-deepseek-migration-status-diagnostic-sql.mjs";
import {
  readHostedAdministratorPassword,
  rejectLegacyHostedCredentialEnvironment,
} from "./acceptance-hosted-credentials.mjs";
import { fetchHostedAcceptanceOfficialCaCertificate } from "./acceptance-hosted-official-ca.mjs";

export {
  hostedDeepseekMigrationStatusDiagnosticPredicateNames,
  renderHostedDeepseekMigrationStatusDiagnosticSql,
} from "./acceptance-hosted-deepseek-migration-status-diagnostic-sql.mjs";

export const hostedDeepseekMigrationStatusDiagnosticArgument = `--diagnose-status-hosted-deepseek-0016-0021-${hostedAcceptanceProjectRef}`;

const setupFailureStages = new Set([
  "arguments",
  "ca-fetch",
  "credential-read",
  "password-validation",
  "query-process",
]);
const queryExitClasses = new Set([
  "ok",
  "client_fatal",
  "connection_error",
  "script_error",
  "process_error",
  "unexpected_error",
]);

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
    Buffer.byteLength(password) >= 12 &&
    Buffer.byteLength(password) <= 512 &&
    !/[\0\r\n]/u.test(password)
  );
}

function renderSetupFailure(stage) {
  if (!setupFailureStages.has(stage)) {
    throw new Error("Hosted DeepSeek status diagnostic stage is invalid.");
  }
  return `Hosted DeepSeek status diagnostic failed at allowlisted stage ${stage}.`;
}

export function classifyHostedDeepseekMigrationStatusDiagnosticExitCode(code) {
  if (code === 0) return "ok";
  if (code === 1) return "client_fatal";
  if (code === 2) return "connection_error";
  if (code === 3) return "script_error";
  if (code === null) return "process_error";
  return "unexpected_error";
}

function classifyFinalStatus(predicates) {
  if (predicates.applied_state_exact && !predicates.pending_state_exact) {
    return "applied_exact";
  }
  if (predicates.pending_state_exact && !predicates.applied_state_exact) {
    return "pending_exact";
  }
  return "uncertain";
}

export function parseHostedDeepseekMigrationStatusDiagnosticOutput(output) {
  if (typeof output !== "string" || !output.endsWith("\n")) return null;
  const lines = output.slice(0, -1).split("\n");
  if (lines.length !== predicateNames.length) return null;
  const predicates = {};
  for (const [index, name] of predicateNames.entries()) {
    const match = new RegExp(`^${name}\\|([tf])$`, "u").exec(lines[index]);
    if (match === null) return null;
    predicates[name] = match[1] === "t";
  }
  return { finalStatus: classifyFinalStatus(predicates), predicates };
}

export async function runHostedDeepseekMigrationStatusDiagnosticQuery(
  { administratorPassword, caCertificate },
  { runPsql = runHostedPsql } = {},
) {
  const result = await runPsql({
    captureOutput: true,
    databaseUrl: `${hostedAcceptancePoolerUrl}&connect_timeout=10`,
    environment: {
      HUAYI_HOSTED_DATABASE_CA_CERTIFICATE: caCertificate,
    },
    input: renderHostedDeepseekMigrationStatusDiagnosticSql(),
    password: administratorPassword,
    timeoutMilliseconds: 30_000,
  });
  const exitClass = classifyHostedDeepseekMigrationStatusDiagnosticExitCode(result.code);
  const diagnostic =
    result.code === 0 ? parseHostedDeepseekMigrationStatusDiagnosticOutput(result.stdout) : null;
  return { diagnostic, exitClass, outputExact: diagnostic !== null };
}

function falsePredicates() {
  return Object.fromEntries(predicateNames.map((name) => [name, false]));
}

function renderDiagnosticResult({ diagnostic, exitClass, outputExact }) {
  const predicatesAreExact =
    diagnostic !== null &&
    typeof diagnostic === "object" &&
    diagnostic.predicates !== null &&
    typeof diagnostic.predicates === "object" &&
    predicateNames.every((name) => typeof diagnostic.predicates[name] === "boolean") &&
    diagnostic.finalStatus === classifyFinalStatus(diagnostic.predicates);
  const safeExitClass = queryExitClasses.has(exitClass) ? exitClass : "unexpected_error";
  const safeOutputExact = outputExact === true && predicatesAreExact;
  const safeDiagnostic = safeOutputExact
    ? diagnostic
    : {
        finalStatus: "uncertain",
        predicates: falsePredicates(),
      };
  return [
    `status_query_exit_class|${safeExitClass}`,
    `status_query_output_exact|${safeOutputExact ? "t" : "f"}`,
    ...predicateNames.map(
      (name) => `${name}|${safeDiagnostic.predicates[name] === true ? "t" : "f"}`,
    ),
    `final_status|${safeDiagnostic.finalStatus}`,
  ].join("\n");
}

export async function runHostedDeepseekMigrationStatusDiagnosticCli({
  arguments_ = process.argv.slice(2),
  environment = process.env,
  fetchCaCertificate = fetchHostedAcceptanceOfficialCaCertificate,
  readPassword = readHostedAdministratorPassword,
  runDiagnosticQuery = runHostedDeepseekMigrationStatusDiagnosticQuery,
  writeError = (value) => process.stderr.write(value),
  writeOutput = (value) => process.stdout.write(value),
} = {}) {
  let failureStage = "arguments";
  try {
    if (
      arguments_.length !== 1 ||
      arguments_[0] !== hostedDeepseekMigrationStatusDiagnosticArgument ||
      environmentHasInheritedPassword(environment)
    ) {
      throw new Error(renderSetupFailure(failureStage));
    }
    failureStage = "ca-fetch";
    const caCertificate = await fetchCaCertificate();
    failureStage = "credential-read";
    const administratorPassword = await readPassword({ environment });
    failureStage = "password-validation";
    if (!passwordIsValid(administratorPassword)) throw new Error(renderSetupFailure(failureStage));
    failureStage = "query-process";
    const result = await runDiagnosticQuery({ administratorPassword, caCertificate });
    writeOutput(`${renderDiagnosticResult(result)}\n`);
    return 0;
  } catch {
    writeError(`${renderSetupFailure(failureStage)}\n`);
    return 1;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runHostedDeepseekMigrationStatusDiagnosticCli();
}
