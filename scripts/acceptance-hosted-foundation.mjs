import { spawn } from "node:child_process";
import { chmod, mkdtemp, open, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { withHostedSignalAwareCleanup } from "./acceptance-hosted-signal-aware-cleanup.mjs";

export const hostedAcceptanceProjectRef = "kpadiulxkgckskcfydry";
export const hostedAcceptancePoolerUrl =
  "postgresql://postgres.kpadiulxkgckskcfydry@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres?sslmode=verify-full";
export const hostedAcceptanceApplicationRole = "huayi_hosted_acceptance_login";
export const hostedAcceptanceApplicationPoolerUrl =
  "postgresql://huayi_hosted_acceptance_login.kpadiulxkgckskcfydry@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres?sslmode=verify-full";
export const hostedAcceptanceApplicationSessionPoolerUrl =
  "postgresql://huayi_hosted_acceptance_login.kpadiulxkgckskcfydry@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres?sslmode=verify-full";
export const hostedAcceptanceExportBucket = "account-exports-acceptance";
export const hostedAcceptanceCaCertificateUrl =
  "https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt";

export const hostedAcceptancePriceVersionIds = Object.freeze({
  legacy: "8a7c5397-dbba-4e28-bc0d-107c4d04c3c3",
  offPeak: "dad0deb1-cbdc-4311-b3ad-b492c7ece757",
  peak: "e4479ddf-f4da-4a75-825a-2b25c1a145cf",
});

export const hostedAcceptanceMigrationVersionsThrough0014 = Object.freeze([
  "20260821000000",
  "20260821010000",
  "20260821020000",
  "20260821030000",
  "20260821040000",
  "20260821050000",
  "20260821060000",
  "20260821070000",
  "20260821080000",
  "20260822010000",
  "20260822020000",
  "20260822030000",
  "20260823010000",
  "20260824010000",
]);

export const hostedAcceptanceMigrationVersionsThrough0015 = Object.freeze([
  ...hostedAcceptanceMigrationVersionsThrough0014,
  "20260825010000",
]);

export const hostedAcceptanceMigrationVersionsThrough0021 = Object.freeze([
  ...hostedAcceptanceMigrationVersionsThrough0015,
  "20260827010000",
  "20260827020000",
  "20260827030000",
  "20260827040000",
  "20260827050000",
  "20260827060000",
]);

export const hostedAcceptanceMigrationVersions = Object.freeze([
  ...hostedAcceptanceMigrationVersionsThrough0021,
  "20260828010000",
]);

export const hostedAcceptanceMigrationVersionsThrough0022 = hostedAcceptanceMigrationVersions;
export const hostedAcceptanceMigrationVersionsThrough0023 = Object.freeze([
  ...hostedAcceptanceMigrationVersionsThrough0022,
  "20260831010000",
]);

export const hostedAcceptanceTenantTables = Object.freeze([
  "user_profiles",
  "account_sign_in_methods",
  "web_sessions",
  "account_data_export_jobs",
  "extension_sessions",
  "extension_pairings",
  "study_captures",
  "analysis_records",
  "analysis_candidates",
  "idempotency_records",
  "analysis_requests",
  "extension_query_generations",
  "learning_items",
  "source_examples",
  "tags",
  "learning_item_tags",
  "schedule_states",
  "word_entries",
  "context_observations",
  "external_wordbook_jobs",
  "external_wordbook_items",
  "practice_sessions",
  "practice_session_items",
  "practice_turns",
  "practice_attempts",
  "practice_generation_tasks",
  "quota_grants",
  "quota_reservations",
  "usage_ledger",
  "learning_duplicate_suggestion_requests",
  "model_rate_limit_events",
  "password_recovery_flows",
  "security_notification_outbox",
]);

export function sqlLiteral(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

export function sqlTextArray(values) {
  return `ARRAY[${values.map(sqlLiteral).join(", ")}]::text[]`;
}

export function requireHostedCaCertificate(environment) {
  const certificate = environment.HUAYI_HOSTED_DATABASE_CA_CERTIFICATE;
  if (
    typeof certificate !== "string" ||
    certificate.length < 64 ||
    certificate.length > 16_384 ||
    !certificate.startsWith("-----BEGIN CERTIFICATE-----\n") ||
    !certificate.trimEnd().endsWith("-----END CERTIFICATE-----")
  ) {
    throw new Error("Hosted acceptance database CA certificate is unavailable.");
  }
  return certificate;
}

export function createHostedPsqlProcessEnvironment({
  passwordFile,
  processEnvironment = process.env,
  rootCertificate,
}) {
  return {
    LANG: processEnvironment.LANG ?? "C",
    LC_ALL: processEnvironment.LC_ALL ?? "C",
    PATH: processEnvironment.PATH ?? "",
    PGPASSFILE: passwordFile,
    PGSSLMODE: "verify-full",
    PGSSLROOTCERT: rootCertificate,
  };
}

async function spawnHostedPsql({
  captureErrorCode,
  captureOutput,
  databaseUrl,
  environment,
  input,
  passwordFile,
  registerChild,
  rootCertificate,
  spawnProcess,
  timeoutMilliseconds,
}) {
  return new Promise((resolveResult) => {
    let settled = false;
    let stderr = "";
    let stdout = "";
    let timedOut = false;
    let timeout;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolveResult(result);
    };
    const child = spawnProcess(
      "psql",
      [
        "-X",
        "--quiet",
        "--set=ON_ERROR_STOP=1",
        ...(captureErrorCode ? ["--set=VERBOSITY=sqlstate"] : []),
        ...(captureOutput ? ["--tuples-only", "--no-align"] : []),
        "--dbname",
        databaseUrl,
      ],
      {
        env: createHostedPsqlProcessEnvironment({
          passwordFile,
          processEnvironment: environment,
          rootCertificate,
        }),
        shell: false,
        stdio: ["pipe", captureOutput ? "pipe" : "ignore", captureErrorCode ? "pipe" : "ignore"],
        windowsHide: true,
      },
    );
    registerChild(child);
    if (timeoutMilliseconds !== undefined) {
      timeout = setTimeout(() => {
        timedOut = true;
        stderr = "";
        stdout = "";
        child.kill("SIGKILL");
      }, timeoutMilliseconds);
    }
    if (captureOutput) {
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        if (stdout.length < 4_096) stdout += chunk;
      });
    }
    if (captureErrorCode) {
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk) => {
        if (stderr.length < 256) stderr += chunk;
      });
    }
    child.once("error", () => finish({ code: null, stderr: "", stdout: "" }));
    child.once("close", (code, signal) =>
      finish({
        code: timedOut || signal !== null ? null : code,
        stderr: timedOut ? "" : stderr,
        stdout: timedOut ? "" : stdout,
      }),
    );
    child.stdin.end(input);
  });
}

export async function runHostedPsql({
  captureErrorCode = false,
  captureOutput,
  databaseUrl,
  environment,
  input,
  password,
  process_ = process,
  spawnProcess = spawn,
  timeoutMilliseconds,
}) {
  const directory = await mkdtemp(join(tmpdir(), "huayi-hosted-psql-"));
  await chmod(directory, 0o700);
  const rootCertificate = join(directory, "root.crt");
  const passwordFile = join(directory, ".pgpass");
  return withHostedSignalAwareCleanup({
    cleanup: () => rm(directory, { force: true, recursive: true }),
    process_,
    run: async ({ registerChild }) => {
      await writePrivateFile(rootCertificate, requireHostedCaCertificate(environment));
      await writePrivateFile(
        passwordFile,
        `${renderHostedPgpass(databaseUrl, requirePostgresPassword(password))}\n`,
      );
      return spawnHostedPsql({
        captureOutput,
        captureErrorCode,
        databaseUrl,
        environment,
        input,
        passwordFile,
        registerChild,
        rootCertificate,
        spawnProcess,
        timeoutMilliseconds,
      });
    },
  });
}

export function requirePostgresPassword(password) {
  if (
    typeof password !== "string" ||
    Buffer.byteLength(password) < 1 ||
    Buffer.byteLength(password) > 512 ||
    /[\0\r\n]/u.test(password)
  ) {
    throw new Error("Hosted acceptance database password is unavailable.");
  }
  return password;
}

function escapePgpassField(value) {
  return value.replaceAll("\\", "\\\\").replaceAll(":", "\\:");
}

export function renderHostedPgpass(databaseUrl, password) {
  let parsed;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error("Hosted acceptance database URL is unavailable.");
  }
  const database = decodeURIComponent(parsed.pathname.slice(1));
  const user = decodeURIComponent(parsed.username);
  const fields = [parsed.hostname, parsed.port || "5432", database, user];
  if (
    parsed.protocol !== "postgresql:" ||
    parsed.password !== "" ||
    fields.some((value) => value.length === 0 || value.length > 255 || /[\0\r\n]/u.test(value))
  ) {
    throw new Error("Hosted acceptance database URL is unavailable.");
  }
  return [...fields, password].map(escapePgpassField).join(":");
}

async function writePrivateFile(path, value) {
  const handle = await open(path, "wx", 0o600);
  try {
    await handle.chmod(0o600);
    await handle.writeFile(value, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
}
