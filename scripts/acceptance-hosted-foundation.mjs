import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

export const hostedAcceptanceMigrationVersions = Object.freeze([
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
  callerEnvironment,
  processEnvironment = process.env,
  rootCertificate,
}) {
  return {
    LANG: processEnvironment.LANG ?? "C",
    LC_ALL: processEnvironment.LC_ALL ?? "C",
    PATH: processEnvironment.PATH ?? "",
    PGPASSWORD: callerEnvironment.PGPASSWORD,
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
  rootCertificate,
}) {
  return new Promise((resolveResult) => {
    let stderr = "";
    let stdout = "";
    const child = spawn(
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
          callerEnvironment: environment,
          rootCertificate,
        }),
        shell: false,
        stdio: ["pipe", captureOutput ? "pipe" : "ignore", captureErrorCode ? "pipe" : "ignore"],
        windowsHide: true,
      },
    );
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
    child.once("error", () => resolveResult({ code: null, stderr: "", stdout: "" }));
    child.once("exit", (code, signal) =>
      resolveResult({ code: signal === null ? code : null, stderr, stdout }),
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
}) {
  const directory = await mkdtemp(join(tmpdir(), "huayi-hosted-ca-"));
  const rootCertificate = join(directory, "root.crt");
  try {
    await writeFile(rootCertificate, requireHostedCaCertificate(environment), {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    return await spawnHostedPsql({
      captureOutput,
      captureErrorCode,
      databaseUrl,
      environment,
      input,
      rootCertificate,
    });
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
}

export function requirePostgresPassword(environment) {
  const password = environment.PGPASSWORD;
  if (typeof password !== "string" || password.length === 0 || password.includes("\0")) {
    throw new Error("Hosted acceptance database password is unavailable.");
  }
  return password;
}
