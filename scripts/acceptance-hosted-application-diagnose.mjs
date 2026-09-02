import { pathToFileURL } from "node:url";

import {
  readHostedCredential,
  rejectLegacyHostedCredentialEnvironment,
} from "./acceptance-hosted-credentials.mjs";
import {
  parseHostedApplicationContextOutput,
  parseHostedApplicationContractOutput,
  renderHostedApplicationContextSql,
  renderHostedApplicationContractSql,
  renderHostedForbiddenRoleSql,
} from "./acceptance-hosted-application-verify.mjs";
import {
  hostedAcceptanceApplicationSessionPoolerUrl,
  hostedAcceptanceProjectRef,
  runHostedPsql,
} from "./acceptance-hosted-foundation.mjs";
import { fetchHostedAcceptanceOfficialCaCertificate } from "./acceptance-hosted-official-ca.mjs";

export const hostedApplicationDiagnosticArgument = `--diagnose-hosted-application-login-${hostedAcceptanceProjectRef}`;

export const hostedApplicationDiagnosticPredicateNames = Object.freeze([
  "connection_exit_class",
  "psql_connection_ok",
  "client_tls_verified",
  "contract_exit_class",
  "contract_execution_completed",
  "contract_output_valid",
  "session_user_exact",
  "current_user_exact",
  "runtime_member",
  "postgres_not_settable",
  "public_create_denied",
  "context_function_denied",
  "application_contract",
  "context_exit_class",
  "context_execution_completed",
  "context_output_valid",
  "context_set",
  "context_visible",
  "context_cleared",
  "backend_reused",
  "postgres_switch_exit_class",
  "postgres_switch_denied",
]);

function verdict(name, passed) {
  return `${name}|${passed ? "t" : "f"}`;
}

export function classifyHostedPsqlExitCode(code) {
  if (code === 0) return "ok";
  if (code === 1) return "client_fatal";
  if (code === 2) return "connection_error";
  if (code === 3) return "script_error";
  if (code === null) return "process_error";
  return "unexpected_error";
}

export async function diagnoseHostedApplicationLogin({
  arguments_ = process.argv.slice(2),
  environment = process.env,
  fetchCaCertificate = fetchHostedAcceptanceOfficialCaCertificate,
  readCredential = readHostedCredential,
  runPsql = runHostedPsql,
} = {}) {
  if (arguments_.length !== 1 || arguments_[0] !== hostedApplicationDiagnosticArgument) {
    throw new Error("Hosted acceptance application diagnostic arguments are invalid.");
  }
  rejectLegacyHostedCredentialEnvironment(environment);
  const caCertificate = await fetchCaCertificate();
  const password = await readCredential("supabase-application-db-password", { environment });
  const connection = {
    databaseUrl: hostedAcceptanceApplicationSessionPoolerUrl,
    environment: {
      HUAYI_HOSTED_DATABASE_CA_CERTIFICATE: caCertificate,
    },
    password,
  };
  const connectionProbe = await runPsql({
    ...connection,
    captureOutput: true,
    input: "SELECT true;\n",
  });
  const psqlConnectionOk = connectionProbe.code === 0;
  const clientTlsVerified = psqlConnectionOk && connectionProbe.stdout.trim() === "t";
  if (!clientTlsVerified) {
    return [
      `connection_exit_class|${classifyHostedPsqlExitCode(connectionProbe.code)}`,
      verdict("psql_connection_ok", psqlConnectionOk),
      verdict("client_tls_verified", false),
      ...hostedApplicationDiagnosticPredicateNames
        .slice(3)
        .map((name) => (name.endsWith("_exit_class") ? `${name}|not_run` : verdict(name, false))),
    ];
  }

  const contractResult = await runPsql({
    ...connection,
    captureOutput: true,
    input: renderHostedApplicationContractSql(),
  });
  const contractExecutionCompleted = contractResult.code === 0;
  const contractPredicates = contractExecutionCompleted
    ? parseHostedApplicationContractOutput(contractResult.stdout)
    : null;
  const contractOutputValid = contractPredicates !== null;
  const safeContractPredicates = contractPredicates ?? Array(6).fill(false);

  const contextResult = await runPsql({
    ...connection,
    captureOutput: true,
    input: renderHostedApplicationContextSql(),
  });
  const contextExecutionCompleted = contextResult.code === 0;
  const context = contextExecutionCompleted
    ? parseHostedApplicationContextOutput(contextResult.stdout)
    : null;
  const contextOutputValid = context !== null;

  const forbiddenRole = await runPsql({
    ...connection,
    captureErrorCode: true,
    captureOutput: false,
    input: renderHostedForbiddenRoleSql(),
  });
  const postgresSwitchDenied =
    forbiddenRole.code === 3 && /^ERROR:\s+42501\s*$/u.test(forbiddenRole.stderr);
  const predicates = {
    sessionUserExact: safeContractPredicates[0] === true,
    currentUserExact: safeContractPredicates[1] === true,
    runtimeMember: safeContractPredicates[2] === true,
    postgresNotSettable: safeContractPredicates[3] === true,
    publicCreateDenied: safeContractPredicates[4] === true,
    contextFunctionDenied: safeContractPredicates[5] === true,
    applicationContract: contractOutputValid && safeContractPredicates.every(Boolean),
    contextSet: contextOutputValid && context.contextSet,
    contextVisible: contextOutputValid && context.contextVisible,
    contextCleared: contextOutputValid && context.contextCleared,
    backendReused: contextOutputValid && context.firstBackendPid === context.secondBackendPid,
    postgresSwitchDenied,
  };
  return [
    `connection_exit_class|${classifyHostedPsqlExitCode(connectionProbe.code)}`,
    verdict("psql_connection_ok", psqlConnectionOk),
    verdict("client_tls_verified", clientTlsVerified),
    `contract_exit_class|${classifyHostedPsqlExitCode(contractResult.code)}`,
    verdict("contract_execution_completed", contractExecutionCompleted),
    verdict("contract_output_valid", contractOutputValid),
    verdict("session_user_exact", predicates.sessionUserExact),
    verdict("current_user_exact", predicates.currentUserExact),
    verdict("runtime_member", predicates.runtimeMember),
    verdict("postgres_not_settable", predicates.postgresNotSettable),
    verdict("public_create_denied", predicates.publicCreateDenied),
    verdict("context_function_denied", predicates.contextFunctionDenied),
    verdict("application_contract", predicates.applicationContract),
    `context_exit_class|${classifyHostedPsqlExitCode(contextResult.code)}`,
    verdict("context_execution_completed", contextExecutionCompleted),
    verdict("context_output_valid", contextOutputValid),
    verdict("context_set", predicates.contextSet),
    verdict("context_visible", predicates.contextVisible),
    verdict("context_cleared", predicates.contextCleared),
    verdict("backend_reused", predicates.backendReused),
    `postgres_switch_exit_class|${classifyHostedPsqlExitCode(forbiddenRole.code)}`,
    verdict("postgres_switch_denied", predicates.postgresSwitchDenied),
  ];
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  diagnoseHostedApplicationLogin()
    .then((results) => process.stdout.write(`${results.join("\n")}\n`))
    .catch(() => {
      process.stderr.write("Hosted acceptance application diagnostic failed.\n");
      process.exitCode = 1;
    });
}
