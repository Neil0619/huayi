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
  hostedMigration0014StatusDiagnosticPredicateNames as predicateNames,
  renderHostedMigration0014StatusDiagnosticSql,
} from "./acceptance-hosted-migration-0014-status-diagnostic-sql.mjs";
import { fetchHostedAcceptanceOfficialCaCertificate } from "./acceptance-hosted-official-ca.mjs";

export { renderHostedMigration0014StatusDiagnosticSql };

export const hostedMigration0014StatusDiagnosticArgument = `--diagnose-status-20260824010000-password-signup-otp-resend-${hostedAcceptanceProjectRef}`;

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
    throw new Error("Hosted 0014 status diagnostic stage is invalid.");
  }
  return `Hosted 0014 status diagnostic failed at allowlisted stage ${stage}.`;
}

export function classifyHostedMigration0014StatusDiagnosticExitCode(code) {
  if (code === 0) return "ok";
  if (code === 1) return "client_fatal";
  if (code === 2) return "connection_error";
  if (code === 3) return "script_error";
  if (code === null) return "process_error";
  return "unexpected_error";
}

function classifyFinalStatus(predicates) {
  if (
    predicates.migration_chain_applied_exact &&
    predicates.bound_column_applied_exact &&
    predicates.bound_check_applied_exact &&
    predicates.bind_function_applied_exact &&
    predicates.renew_function_exact &&
    predicates.renew_acl_exact
  ) {
    return "applied_exact";
  }
  if (
    predicates.migration_chain_pending_exact &&
    predicates.bound_column_pending_exact &&
    predicates.bound_check_pending_exact &&
    predicates.bind_function_pending_exact &&
    predicates.renew_function_absent
  ) {
    return "pending_exact";
  }
  return "uncertain";
}

export function parseHostedMigration0014StatusDiagnosticOutput(output) {
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

export async function runHostedMigration0014StatusDiagnosticQuery(
  { administratorPassword, caCertificate },
  { runPsql = runHostedPsql } = {},
) {
  const result = await runPsql({
    captureOutput: true,
    databaseUrl: `${hostedAcceptancePoolerUrl}&connect_timeout=10`,
    environment: {
      HUAYI_HOSTED_DATABASE_CA_CERTIFICATE: caCertificate,
    },
    input: renderHostedMigration0014StatusDiagnosticSql(),
    password: administratorPassword,
    timeoutMilliseconds: 30_000,
  });
  const exitClass = classifyHostedMigration0014StatusDiagnosticExitCode(result.code);
  const diagnostic =
    result.code === 0 ? parseHostedMigration0014StatusDiagnosticOutput(result.stdout) : null;
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

export async function runHostedMigration0014StatusDiagnosticCli({
  arguments_ = process.argv.slice(2),
  environment = process.env,
  fetchCaCertificate = fetchHostedAcceptanceOfficialCaCertificate,
  readPassword = readHostedAdministratorPassword,
  runDiagnosticQuery = runHostedMigration0014StatusDiagnosticQuery,
  writeError = (value) => process.stderr.write(value),
  writeOutput = (value) => process.stdout.write(value),
} = {}) {
  let failureStage = "arguments";
  try {
    if (
      arguments_.length !== 1 ||
      arguments_[0] !== hostedMigration0014StatusDiagnosticArgument ||
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
  process.exitCode = await runHostedMigration0014StatusDiagnosticCli();
}
