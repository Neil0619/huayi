import { pathToFileURL } from "node:url";

import {
  hostedAcceptancePoolerUrl,
  hostedAcceptanceProjectRef,
  runHostedPsql,
} from "./acceptance-hosted-foundation.mjs";
import { readHiddenTerminalLine } from "./acceptance-hosted-important-batch-secret-prompt.mjs";
import { fetchHostedAcceptanceOfficialCaCertificate } from "./acceptance-hosted-official-ca.mjs";
import { renderHostedRuntimeSnapshotSql } from "./acceptance-hosted-runtime-gates-sql.mjs";

export { renderHostedRuntimeSnapshotSql } from "./acceptance-hosted-runtime-gates-sql.mjs";

export const hostedRuntimeGatesSnapshotArgument = `--snapshot-hosted-runtime-gates-${hostedAcceptanceProjectRef}`;
const failureMessage = "Hosted runtime snapshot failed.";

const snapshotFields = Object.freeze([
  ["r3c_total", "count"],
  ["r3c_pending", "count"],
  ["r3c_sending", "count"],
  ["r3c_sent", "count"],
  ["r3c_failed", "count"],
  ["r3c_dead_letter", "count"],
  ["r3c_claimable", "count"],
  ["r3c_overdue_nonterminal", "count"],
  ["r3c_max_attempts", "count"],
  ["r3c_contract_exact", "boolean"],
  ["cron_extensions_exact", "boolean"],
  ["cron_vault_names_exact", "boolean"],
  ["cron_jobs_exact", "boolean"],
  ["cron_function_contract_exact", "boolean"],
  ["cron_acl_exact", "boolean"],
  ["deepseek_analysis_requests_total", "count"],
  ["deepseek_analysis_requests_running", "count"],
  ["deepseek_analysis_requests_completed", "count"],
  ["deepseek_analysis_requests_failed", "count"],
  ["deepseek_analysis_records_total", "count"],
  ["deepseek_analysis_usage_rows_total", "count"],
  ["deepseek_latest_present", "boolean"],
  ["deepseek_latest_state", "request-state"],
  ["deepseek_latest_dispatched", "boolean"],
  ["deepseek_latest_price_slot", "price-slot"],
  ["deepseek_latest_price_contract", "boolean"],
  ["deepseek_latest_reservation_status", "reservation-status"],
  ["deepseek_latest_ledger_rows", "count"],
  ["deepseek_latest_ledger_outcome", "ledger-outcome"],
  ["deepseek_latest_model_metadata_reconciled", "boolean"],
  ["deepseek_latest_reconciled", "boolean"],
]);

export const hostedRuntimeSnapshotFieldNames = Object.freeze(snapshotFields.map(([name]) => name));

const validValues = Object.freeze({
  boolean: /^(?:t|f)$/u,
  count: /^(?:0|[1-9]\d{0,18})$/u,
  "ledger-outcome": /^(?:none|succeeded|failed|mixed)$/u,
  "price-slot": /^(?:none|legacy|off_peak|peak|other)$/u,
  "request-state": /^(?:none|running|completed|failed)$/u,
  "reservation-status": /^(?:none|active|settled|released)$/u,
});

function isValidSnapshotValue(type, value) {
  return (
    typeof value === "string" &&
    validValues[type].test(value) &&
    (type !== "count" || BigInt(value) <= 9_223_372_036_854_775_807n)
  );
}

function passwordIsValid(password) {
  return (
    typeof password === "string" &&
    Buffer.byteLength(password) >= 12 &&
    Buffer.byteLength(password) <= 512 &&
    !/[\0\r\n]/u.test(password)
  );
}

function environmentHasInheritedPassword(environment) {
  return ["PGPASSWORD", "SUPABASE_DB_PASSWORD"].some((name) =>
    Object.prototype.hasOwnProperty.call(environment, name),
  );
}

export function renderHostedRuntimeGatesPlan() {
  return `Hosted runtime gates plan (zero network / zero write)
- Fetch the official CA, prompt for the administrator secret without echo, and use one verify-full READ ONLY transaction.
- Return only fixed booleans, enums, and bounded aggregate counts.
- Inspect Vault names only; never read credential material or identity/content fields.
- Select the latest hosted analysis request automatically; no opaque identifier input is needed.
- A snapshot observes state only; it does not send mail, call DeepSeek, install Cron, or change a control.
`;
}

function parseHostedRuntimeSnapshot(stdout) {
  if (
    typeof stdout !== "string" ||
    stdout.length === 0 ||
    stdout.length > 4_096 ||
    !stdout.endsWith("\n") ||
    stdout.includes("\r")
  ) {
    return null;
  }
  const lines = stdout.slice(0, -1).split("\n");
  if (lines.length !== snapshotFields.length) return null;
  const snapshot = Object.create(null);
  for (const [index, [expectedName, type]] of snapshotFields.entries()) {
    const tokens = lines[index]?.split("|");
    if (tokens?.length !== 2 || tokens[0] !== expectedName) return null;
    const value = tokens[1];
    if (!isValidSnapshotValue(type, value)) return null;
    snapshot[expectedName] = value;
  }
  return snapshot;
}

export function renderHostedRuntimeSnapshot(snapshot) {
  const lines = [];
  for (const [name, type] of snapshotFields) {
    const value = snapshot?.[name];
    if (!isValidSnapshotValue(type, value)) {
      throw new Error(failureMessage);
    }
    lines.push(`${name}|${value}`);
  }
  return `${lines.join("\n")}\n`;
}

export async function runHostedRuntimeSnapshotQuery(
  { administratorPassword, caCertificate },
  { runPsql = runHostedPsql } = {},
) {
  const result = await runPsql({
    captureOutput: true,
    databaseUrl: hostedAcceptancePoolerUrl,
    environment: {
      HUAYI_HOSTED_DATABASE_CA_CERTIFICATE: caCertificate,
      PGPASSWORD: administratorPassword,
    },
    input: renderHostedRuntimeSnapshotSql(),
    timeoutMilliseconds: 30_000,
  });
  return result.code === 0 ? parseHostedRuntimeSnapshot(result.stdout) : null;
}

export async function readHostedRuntimeSnapshot({
  arguments_ = process.argv.slice(2),
  environment = process.env,
  fetchCaCertificate = fetchHostedAcceptanceOfficialCaCertificate,
  readPassword = readHiddenTerminalLine,
  runPsql,
  runSnapshotQuery = runHostedRuntimeSnapshotQuery,
} = {}) {
  try {
    if (
      arguments_.length !== 1 ||
      arguments_[0] !== hostedRuntimeGatesSnapshotArgument ||
      environmentHasInheritedPassword(environment)
    ) {
      throw new Error(failureMessage);
    }
    const caCertificate = await fetchCaCertificate();
    const administratorPassword = await readPassword();
    if (!passwordIsValid(administratorPassword)) throw new Error(failureMessage);
    const snapshot = await runSnapshotQuery(
      { administratorPassword, caCertificate },
      runPsql === undefined ? undefined : { runPsql },
    );
    if (snapshot === null) throw new Error(failureMessage);
    return snapshot;
  } catch {
    throw new Error(failureMessage);
  }
}

export async function runHostedRuntimeGatesCli({
  arguments_ = process.argv.slice(2),
  environment = process.env,
  fetchCaCertificate = fetchHostedAcceptanceOfficialCaCertificate,
  readPassword = readHiddenTerminalLine,
  runPsql,
  runSnapshotQuery = runHostedRuntimeSnapshotQuery,
  writeError = (value) => process.stderr.write(value),
  writeOutput = (value) => process.stdout.write(value),
} = {}) {
  if (arguments_.length === 1 && arguments_[0] === "--plan") {
    writeOutput(renderHostedRuntimeGatesPlan());
    return 0;
  }
  try {
    const snapshot = await readHostedRuntimeSnapshot({
      arguments_,
      environment,
      fetchCaCertificate,
      readPassword,
      runPsql,
      runSnapshotQuery,
    });
    writeOutput(renderHostedRuntimeSnapshot(snapshot));
    return 0;
  } catch {
    writeError(`${failureMessage}\n`);
    return 1;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runHostedRuntimeGatesCli();
}
