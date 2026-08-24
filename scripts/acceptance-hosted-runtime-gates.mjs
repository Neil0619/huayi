import { pathToFileURL } from "node:url";

import {
  hostedAcceptancePoolerUrl,
  hostedAcceptanceProjectRef,
  requirePostgresPassword,
  runHostedPsql,
} from "./acceptance-hosted-foundation.mjs";
import { renderHostedRuntimeSnapshotSql } from "./acceptance-hosted-runtime-gates-sql.mjs";

export { renderHostedRuntimeSnapshotSql } from "./acceptance-hosted-runtime-gates-sql.mjs";

export const hostedRuntimeGatesSnapshotArgument = `--snapshot-hosted-runtime-gates-${hostedAcceptanceProjectRef}`;

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

export function renderHostedRuntimeGatesPlan() {
  return `Hosted runtime gates plan (zero network / zero write)
- Use one verify-full administrator connection and one READ ONLY transaction.
- Return only fixed booleans, enums, and bounded aggregate counts.
- Inspect Vault names only; never read credential material or identity/content fields.
- Select the latest hosted analysis request automatically; no opaque identifier input is needed.
- A snapshot observes state only; it does not send mail, call DeepSeek, install Cron, or change a control.
`;
}

function parseHostedRuntimeSnapshot(stdout) {
  if (typeof stdout !== "string" || stdout.length === 0 || stdout.length > 4_096) return null;
  const lines = stdout.trim().split(/\r?\n/u);
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
      throw new Error("Hosted runtime snapshot failed.");
    }
    lines.push(`${name}|${value}`);
  }
  return `${lines.join("\n")}\n`;
}

export async function readHostedRuntimeSnapshot({
  arguments_ = process.argv.slice(2),
  environment = process.env,
  runPsql = runHostedPsql,
} = {}) {
  if (arguments_.length !== 1 || arguments_[0] !== hostedRuntimeGatesSnapshotArgument) {
    throw new Error("Hosted runtime snapshot arguments are invalid.");
  }
  requirePostgresPassword(environment);
  const result = await runPsql({
    captureOutput: true,
    databaseUrl: hostedAcceptancePoolerUrl,
    environment: {
      HUAYI_HOSTED_DATABASE_CA_CERTIFICATE: environment.HUAYI_HOSTED_DATABASE_CA_CERTIFICATE,
      PGPASSWORD: environment.PGPASSWORD,
    },
    input: renderHostedRuntimeSnapshotSql(),
  });
  const snapshot = result.code === 0 ? parseHostedRuntimeSnapshot(result.stdout) : null;
  if (snapshot === null) throw new Error("Hosted runtime snapshot failed.");
  return snapshot;
}

export async function runHostedRuntimeGatesCli({
  arguments_ = process.argv.slice(2),
  environment = process.env,
  runPsql = runHostedPsql,
  writeError = (value) => process.stderr.write(value),
  writeOutput = (value) => process.stdout.write(value),
} = {}) {
  if (arguments_.length === 1 && arguments_[0] === "--plan") {
    writeOutput(renderHostedRuntimeGatesPlan());
    return 0;
  }
  try {
    const snapshot = await readHostedRuntimeSnapshot({ arguments_, environment, runPsql });
    writeOutput(renderHostedRuntimeSnapshot(snapshot));
    return 0;
  } catch {
    writeError("Hosted runtime snapshot failed.\n");
    return 1;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runHostedRuntimeGatesCli();
}
