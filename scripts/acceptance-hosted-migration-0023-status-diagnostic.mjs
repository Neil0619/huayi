import { pathToFileURL } from "node:url";

import {
  hostedAcceptancePoolerUrl,
  hostedAcceptanceProjectRef,
  runHostedPsql,
} from "./acceptance-hosted-foundation.mjs";
import { readHiddenTerminalLine } from "./acceptance-hosted-important-batch-secret-prompt.mjs";
import {
  hostedMigration0023StatusPredicateNames as predicateNames,
  renderHostedMigration0023StateCtes,
} from "./acceptance-hosted-migration-0023-status-contract.mjs";
import { fetchHostedAcceptanceOfficialCaCertificate } from "./acceptance-hosted-official-ca.mjs";

export const hostedMigration0023StatusDiagnosticPredicateNames = predicateNames;
export const hostedMigration0023StatusDiagnosticArgument = `--diagnose-status-20260831010000-invitation-token-recovery-${hostedAcceptanceProjectRef}`;
const stages = new Set([
  "arguments",
  "ca-fetch",
  "password-prompt",
  "password-validation",
  "query-process",
]);
const exitClasses = new Set([
  "ok",
  "client_fatal",
  "connection_error",
  "script_error",
  "process_error",
  "unexpected_error",
]);

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
function renderFailure(stage) {
  if (!stages.has(stage)) throw new Error("invalid stage");
  return `Hosted 0023 status diagnostic failed at allowlisted stage ${stage}.`;
}
function finalStatus(predicates) {
  if (predicates.applied_state_exact && !predicates.pending_state_exact) return "applied_exact";
  if (predicates.pending_state_exact && !predicates.applied_state_exact) return "pending_exact";
  return "uncertain";
}

export function renderHostedMigration0023StatusDiagnosticSql() {
  const rows = predicateNames
    .map((name, index) => `    (${index + 1}, '${name}', CASE WHEN ${name} THEN 't' ELSE 'f' END)`)
    .join(",\n");
  return `
BEGIN READ ONLY;
WITH ${renderHostedMigration0023StateCtes()}
SELECT diagnostic.name || '|' || diagnostic.value
FROM status_state
CROSS JOIN LATERAL (VALUES
${rows}
) AS diagnostic(position,name,value)
ORDER BY diagnostic.position;
ROLLBACK;
`;
}

export function parseHostedMigration0023StatusDiagnosticOutput(output) {
  if (typeof output !== "string" || !output.endsWith("\n")) return null;
  const lines = output.slice(0, -1).split("\n");
  if (lines.length !== predicateNames.length) return null;
  const predicates = {};
  for (const [index, name] of predicateNames.entries()) {
    const match = new RegExp(`^${name}\\|([tf])$`, "u").exec(lines[index]);
    if (match === null) return null;
    predicates[name] = match[1] === "t";
  }
  return { finalStatus: finalStatus(predicates), predicates };
}

export function classifyHostedMigration0023StatusDiagnosticExitCode(code) {
  return code === 0
    ? "ok"
    : code === 1
      ? "client_fatal"
      : code === 2
        ? "connection_error"
        : code === 3
          ? "script_error"
          : code === null
            ? "process_error"
            : "unexpected_error";
}

export async function runHostedMigration0023StatusDiagnosticQuery(
  { administratorPassword, caCertificate },
  { runPsql = runHostedPsql } = {},
) {
  const result = await runPsql({
    captureOutput: true,
    databaseUrl: `${hostedAcceptancePoolerUrl}&connect_timeout=10`,
    environment: {
      HUAYI_HOSTED_DATABASE_CA_CERTIFICATE: caCertificate,
      PGPASSWORD: administratorPassword,
    },
    input: renderHostedMigration0023StatusDiagnosticSql(),
    timeoutMilliseconds: 30_000,
  });
  const diagnostic =
    result.code === 0 ? parseHostedMigration0023StatusDiagnosticOutput(result.stdout) : null;
  return {
    diagnostic,
    exitClass: classifyHostedMigration0023StatusDiagnosticExitCode(result.code),
    outputExact: diagnostic !== null,
  };
}

function renderResult({ diagnostic, exitClass, outputExact }) {
  const exact =
    outputExact === true &&
    diagnostic !== null &&
    predicateNames.every((name) => typeof diagnostic.predicates?.[name] === "boolean") &&
    diagnostic.finalStatus === finalStatus(diagnostic.predicates);
  const safe = exact
    ? diagnostic
    : {
        finalStatus: "uncertain",
        predicates: Object.fromEntries(predicateNames.map((name) => [name, false])),
      };
  return [
    `status_query_exit_class|${exitClasses.has(exitClass) ? exitClass : "unexpected_error"}`,
    `status_query_output_exact|${exact ? "t" : "f"}`,
    ...predicateNames.map((name) => `${name}|${safe.predicates[name] ? "t" : "f"}`),
    `final_status|${safe.finalStatus}`,
  ].join("\n");
}

export async function runHostedMigration0023StatusDiagnosticCli({
  arguments_ = process.argv.slice(2),
  environment = process.env,
  fetchCaCertificate = fetchHostedAcceptanceOfficialCaCertificate,
  readPassword = readHiddenTerminalLine,
  runDiagnosticQuery = runHostedMigration0023StatusDiagnosticQuery,
  writeError = (value) => process.stderr.write(value),
  writeOutput = (value) => process.stdout.write(value),
} = {}) {
  let stage = "arguments";
  try {
    if (
      arguments_.length !== 1 ||
      arguments_[0] !== hostedMigration0023StatusDiagnosticArgument ||
      inheritedPassword(environment)
    )
      throw new Error("invalid");
    stage = "ca-fetch";
    const caCertificate = await fetchCaCertificate();
    stage = "password-prompt";
    const administratorPassword = await readPassword();
    stage = "password-validation";
    if (!validPassword(administratorPassword)) throw new Error("invalid");
    stage = "query-process";
    writeOutput(
      `${renderResult(await runDiagnosticQuery({ administratorPassword, caCertificate }))}\n`,
    );
    return 0;
  } catch {
    writeError(`${renderFailure(stage)}\n`);
    return 1;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runHostedMigration0023StatusDiagnosticCli();
}
