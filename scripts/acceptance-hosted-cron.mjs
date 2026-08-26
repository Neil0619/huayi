import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import {
  hostedAcceptancePoolerUrl,
  hostedAcceptanceProjectRef,
  runHostedPsql,
} from "./acceptance-hosted-foundation.mjs";
import { readHiddenTerminalLine } from "./acceptance-hosted-important-batch-secret-prompt.mjs";
import { fetchHostedAcceptanceOfficialCaCertificate } from "./acceptance-hosted-official-ca.mjs";
import { verifyHostedCronRepositoryCandidate } from "./acceptance-hosted-cron-repository.mjs";
import { renderHostedCronStatusSql } from "./acceptance-hosted-cron-sql.mjs";

export { verifyHostedCronRepositoryCandidate } from "./acceptance-hosted-cron-repository.mjs";
export { renderHostedCronStatusSql } from "./acceptance-hosted-cron-sql.mjs";

export const hostedCronStatusArgument = `--status-hosted-supabase-cron-${hostedAcceptanceProjectRef}`;
export const hostedCronApplyConfirmation = `--confirm-apply-hosted-supabase-cron-after-r3c-and-vercel-continuity-${hostedAcceptanceProjectRef}`;

const operationsUrl = new URL(
  "../apps/api/operations/configure-supabase-cron.sql",
  import.meta.url,
);
const operationsSha256 = "09a074addefdf352ff256ff958bb87a6775b911a7da9475ef697b04d2a64d604";
const psqlTimeoutMilliseconds = 30_000;
const statusFields = Object.freeze([
  ["administrator_connection_exact", "boolean"],
  ["migration_chain_exact", "boolean"],
  ["r3c_sent_count", "count"],
  ["r3c_nonterminal_count", "count"],
  ["r3c_terminal_failure_count", "count"],
  ["r3c_contract_exact", "boolean"],
  ["cron_vault_names_exact", "boolean"],
  ["cron_extensions_installable", "boolean"],
  ["cron_extensions_exact", "boolean"],
  ["cron_fixed_jobs_count", "count"],
  ["cron_unmanaged_jobs_count", "count"],
  ["cron_jobs_exact", "boolean"],
  ["cron_function_installable", "boolean"],
  ["cron_function_contract_exact", "boolean"],
  ["cron_acl_exact", "boolean"],
  ["cron_installation_state", "installation-state"],
  ["cron_preflight_ready", "boolean"],
  ["cron_installation_exact", "boolean"],
]);

export const hostedCronStatusFieldNames = Object.freeze(statusFields.map(([name]) => name));

const validValues = Object.freeze({
  boolean: /^(?:t|f)$/u,
  count: /^(?:0|[1-9]\d{0,18})$/u,
  "installation-state": /^(?:absent|partial|exact)$/u,
});
const allowedFailureStages = new Set([
  "arguments",
  "credentials",
  "preflight-read",
  "preflight-contract",
  "operations-contract",
  "repository-candidate",
  "first-apply",
  "second-apply",
  "postflight-read",
  "postflight-contract",
]);

class HostedCronStageError extends Error {
  constructor(stage) {
    super(`Hosted Supabase Cron operation failed at stage: ${stage}.`);
    this.name = "HostedCronStageError";
    this.stage = stage;
  }
}

function isValidValue(type, value) {
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

function parseHostedCronStatus(stdout) {
  if (
    typeof stdout !== "string" ||
    stdout.length === 0 ||
    stdout.length > 2_048 ||
    !stdout.endsWith("\n") ||
    stdout.includes("\r")
  ) {
    return null;
  }
  const lines = stdout.slice(0, -1).split("\n");
  if (lines.length !== statusFields.length) return null;
  const status = Object.create(null);
  for (const [index, [expectedName, type]] of statusFields.entries()) {
    const tokens = lines[index]?.split("|");
    if (tokens?.length !== 2 || tokens[0] !== expectedName) return null;
    const value = tokens[1];
    if (!isValidValue(type, value)) return null;
    status[expectedName] = value;
  }
  return status;
}

function databaseEnvironment({ administratorPassword, caCertificate }) {
  return {
    HUAYI_HOSTED_DATABASE_CA_CERTIFICATE: caCertificate,
    PGPASSWORD: administratorPassword,
  };
}

async function queryHostedCronStatus({ runPsql, secrets, stage }) {
  let result;
  try {
    result = await runPsql({
      captureOutput: true,
      databaseUrl: hostedAcceptancePoolerUrl,
      environment: databaseEnvironment(secrets),
      input: renderHostedCronStatusSql(),
      timeoutMilliseconds: psqlTimeoutMilliseconds,
    });
  } catch {
    throw new HostedCronStageError(stage);
  }
  const status = result.code === 0 ? parseHostedCronStatus(result.stdout) : null;
  if (status === null) throw new HostedCronStageError(stage);
  return status;
}

function requireOperationsSql(sql) {
  const source = Buffer.isBuffer(sql) ? sql : Buffer.from(sql ?? "", "utf8");
  const text = source.toString("utf8");
  if (
    (!Buffer.isBuffer(sql) && typeof sql !== "string") ||
    source.byteLength < 1 ||
    source.byteLength > 64 * 1_024 ||
    createHash("sha256").update(source).digest("hex") !== operationsSha256 ||
    !/^BEGIN;\s/u.test(text) ||
    !/COMMIT;\s*$/u.test(text) ||
    (text.match(/SELECT cron\.schedule\(/gu) ?? []).length !== 5 ||
    (text.match(/CREATE OR REPLACE FUNCTION huayi_private\.invoke_cron_path/gu) ?? []).length !==
      1 ||
    /^\s*\\/mu.test(text)
  ) {
    throw new HostedCronStageError("operations-contract");
  }
  return text;
}

export function renderHostedCronPlan() {
  return `Hosted Supabase Cron plan for ${hostedAcceptanceProjectRef} (zero network / zero write)
- status fetches the official CA, prompts without echo, and uses one verify-full administrator READ ONLY transaction.
- status returns fixed booleans, one fixed enum, and bounded aggregate counts only.
- status inspects Vault names only; it never selects or prints Vault credential values.
- apply requires the exact project-specific confirmation and a clean reviewed candidate after the real R3-C gate passes.
- apply verifies the exact SHA-256-pinned repository operations SQL before secrets or database work.
- apply runs the complete repository fixed operations SQL twice, preserving both transactions.
- apply then uses an independent read-only postflight to require exactly five active minute jobs.
- Vercel Sensitive values cannot be read back; status cannot prove CRON_SECRET value continuity.
- Before apply, rotate or otherwise establish Vercel and Vault from one controlled source, then confirm continuity externally.
- No invitation token, user/request identifier, email, content, Authorization, or raw error is accepted or printed.
`;
}

export function renderHostedCronStatus(status) {
  const lines = [];
  for (const [name, type] of statusFields) {
    const value = status?.[name];
    if (!isValidValue(type, value)) throw new Error("Hosted Supabase Cron status failed.");
    lines.push(`${name}|${value}`);
  }
  return `${lines.join("\n")}\n`;
}

export async function readHostedCronStatus({
  arguments_ = process.argv.slice(2),
  environment = process.env,
  fetchCaCertificate = fetchHostedAcceptanceOfficialCaCertificate,
  readPassword = readHiddenTerminalLine,
  runPsql = runHostedPsql,
} = {}) {
  try {
    if (
      arguments_.length !== 2 ||
      arguments_[0] !== "status" ||
      arguments_[1] !== hostedCronStatusArgument ||
      environmentHasInheritedPassword(environment)
    ) {
      throw new Error("arguments");
    }
    const caCertificate = await fetchCaCertificate();
    const administratorPassword = await readPassword();
    if (!passwordIsValid(administratorPassword)) throw new Error("credentials");
    return await queryHostedCronStatus({
      runPsql,
      secrets: { administratorPassword, caCertificate },
      stage: "status-read",
    });
  } catch {
    throw new Error("Hosted Supabase Cron status failed.");
  }
}

export async function applyHostedCron({
  arguments_ = process.argv.slice(2),
  environment = process.env,
  fetchCaCertificate = fetchHostedAcceptanceOfficialCaCertificate,
  loadOperationsSql = () => readFile(operationsUrl),
  readPassword = readHiddenTerminalLine,
  runPsql = runHostedPsql,
  verifyRepositoryCandidate = verifyHostedCronRepositoryCandidate,
} = {}) {
  if (
    arguments_.length !== 2 ||
    arguments_[0] !== "apply" ||
    arguments_[1] !== hostedCronApplyConfirmation
  ) {
    throw new HostedCronStageError("arguments");
  }
  if (environmentHasInheritedPassword(environment)) {
    throw new HostedCronStageError("credentials");
  }

  let operationsSql;
  try {
    operationsSql = requireOperationsSql(await loadOperationsSql());
  } catch (error) {
    if (error instanceof HostedCronStageError) throw error;
    throw new HostedCronStageError("operations-contract");
  }
  try {
    if ((await verifyRepositoryCandidate()) !== true) {
      throw new HostedCronStageError("repository-candidate");
    }
  } catch (error) {
    if (error instanceof HostedCronStageError) throw error;
    throw new HostedCronStageError("repository-candidate");
  }
  let secrets;
  try {
    const caCertificate = await fetchCaCertificate();
    const administratorPassword = await readPassword();
    if (!passwordIsValid(administratorPassword)) throw new Error("credentials");
    secrets = { administratorPassword, caCertificate };
  } catch {
    throw new HostedCronStageError("credentials");
  }
  const preflight = await queryHostedCronStatus({
    runPsql,
    secrets,
    stage: "preflight-read",
  });
  if (preflight.cron_preflight_ready !== "t") {
    throw new HostedCronStageError("preflight-contract");
  }
  const sharedWrite = {
    captureOutput: false,
    databaseUrl: hostedAcceptancePoolerUrl,
    environment: databaseEnvironment(secrets),
    input: operationsSql,
    timeoutMilliseconds: psqlTimeoutMilliseconds,
  };
  let first;
  try {
    first = await runPsql(sharedWrite);
  } catch {
    throw new HostedCronStageError("first-apply");
  }
  if (first.code !== 0) throw new HostedCronStageError("first-apply");
  let second;
  try {
    second = await runPsql(sharedWrite);
  } catch {
    throw new HostedCronStageError("second-apply");
  }
  if (second.code !== 0) throw new HostedCronStageError("second-apply");

  const postflight = await queryHostedCronStatus({
    runPsql,
    secrets,
    stage: "postflight-read",
  });
  if (
    postflight.cron_installation_exact !== "t" ||
    postflight.cron_installation_state !== "exact" ||
    postflight.cron_fixed_jobs_count !== "5" ||
    postflight.cron_unmanaged_jobs_count !== "0"
  ) {
    throw new HostedCronStageError("postflight-contract");
  }
  return { outcome: "applied" };
}

export async function runHostedCronCli({
  arguments_ = process.argv.slice(2),
  environment = process.env,
  fetchCaCertificate = fetchHostedAcceptanceOfficialCaCertificate,
  loadOperationsSql,
  readPassword = readHiddenTerminalLine,
  runPsql = runHostedPsql,
  verifyRepositoryCandidate = verifyHostedCronRepositoryCandidate,
  writeError = (value) => process.stderr.write(value),
  writeOutput = (value) => process.stdout.write(value),
} = {}) {
  if (arguments_.length === 1 && arguments_[0] === "--plan") {
    writeOutput(renderHostedCronPlan());
    return 0;
  }
  try {
    if (arguments_[0] === "status") {
      const status = await readHostedCronStatus({
        arguments_,
        environment,
        fetchCaCertificate,
        readPassword,
        runPsql,
      });
      writeOutput(renderHostedCronStatus(status));
    } else {
      await applyHostedCron({
        arguments_,
        environment,
        fetchCaCertificate,
        loadOperationsSql,
        readPassword,
        runPsql,
        verifyRepositoryCandidate,
      });
      writeOutput(
        "Hosted Supabase Cron apply passed: fixed SQL executed twice; exact five jobs verified.\n",
      );
    }
    return 0;
  } catch (error) {
    const stage =
      error instanceof HostedCronStageError && allowedFailureStages.has(error.stage)
        ? error.stage
        : arguments_[0] === "status"
          ? "status-read"
          : "arguments";
    writeError(`Hosted Supabase Cron operation failed at stage: ${stage}.\n`);
    return 1;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runHostedCronCli();
}
