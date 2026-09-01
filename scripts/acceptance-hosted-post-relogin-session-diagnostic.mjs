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
import { fetchHostedAcceptanceOfficialCaCertificate } from "./acceptance-hosted-official-ca.mjs";
import { renderHostedPostReloginSessionDiagnosticSql } from "./acceptance-hosted-post-relogin-session-diagnostic-sql.mjs";

export { renderHostedPostReloginSessionDiagnosticSql } from "./acceptance-hosted-post-relogin-session-diagnostic-sql.mjs";

export const hostedPostReloginSessionDiagnosticArgument = `--diagnose-hosted-post-relogin-web-session-${hostedAcceptanceProjectRef}`;
export const hostedPostReloginSessionDiagnosticFailureMessage =
  "Hosted post-relogin Web session diagnostic failed.";

const diagnosticFields = Object.freeze([
  ["migration_0023_applied", "boolean"],
  ["ordinary_invitation_unique", "boolean"],
  ["subject_account_exact", "boolean"],
  ["session_owner_contract_exact", "boolean"],
  ["all_web_session_count", "count"],
  ["all_active_web_session_count", "count"],
  ["subject_web_session_count", "count"],
  ["subject_active_web_session_count", "count"],
  ["subject_active_full_session_count", "count"],
  ["subject_active_nonfull_session_count", "count"],
  ["subject_revoked_web_session_count", "count"],
  ["subject_expired_web_session_count", "count"],
  ["other_active_web_session_count", "count"],
  ["other_active_operator_session_count", "count"],
  ["other_active_non_operator_session_count", "count"],
  ["subject_session_partition_exact", "boolean"],
  ["active_session_partition_exact", "boolean"],
  ["subject_latest_session_state", "session-state"],
  ["diagnostic_verdict", "verdict"],
]);

export const hostedPostReloginSessionDiagnosticFieldNames = Object.freeze(
  diagnosticFields.map(([name]) => name),
);

const validValues = Object.freeze({
  boolean: /^(?:t|f)$/u,
  count: /^(?:0|[1-9]\d{0,18})$/u,
  "session-state": /^(?:none|invalid-owner|revoked|expired|active-full|active-nonfull)$/u,
  verdict:
    /^(?:target-inconsistent|session-contract-drift|subject-multiple-active|subject-nonfull-active|subject-and-other-active|subject-active|other-active-only|no-active-session)$/u,
});

function passwordIsValid(password) {
  return (
    typeof password === "string" &&
    Buffer.byteLength(password) >= 12 &&
    Buffer.byteLength(password) <= 512 &&
    !/[\0\r\n]/u.test(password)
  );
}

function environmentHasInheritedPassword(environment) {
  try {
    rejectLegacyHostedCredentialEnvironment(environment);
    return false;
  } catch {
    return true;
  }
}

function count(value) {
  return BigInt(value);
}

function expectedVerdict(diagnostic) {
  if (
    diagnostic.migration_0023_applied !== "t" ||
    diagnostic.ordinary_invitation_unique !== "t" ||
    diagnostic.subject_account_exact !== "t"
  ) {
    return "target-inconsistent";
  }
  if (
    diagnostic.session_owner_contract_exact !== "t" ||
    diagnostic.subject_session_partition_exact !== "t" ||
    diagnostic.active_session_partition_exact !== "t"
  ) {
    return "session-contract-drift";
  }
  const subjectActive = count(diagnostic.subject_active_web_session_count);
  const subjectNonfull = count(diagnostic.subject_active_nonfull_session_count);
  const otherActive = count(diagnostic.other_active_web_session_count);
  if (subjectActive > 1n) return "subject-multiple-active";
  if (subjectActive === 1n && subjectNonfull > 0n) return "subject-nonfull-active";
  if (subjectActive === 1n && otherActive > 0n) return "subject-and-other-active";
  if (subjectActive === 1n) return "subject-active";
  if (otherActive > 0n) return "other-active-only";
  return "no-active-session";
}

function crossFieldsAreExact(diagnostic) {
  const allTotal = count(diagnostic.all_web_session_count);
  const allActive = count(diagnostic.all_active_web_session_count);
  const subjectTotal = count(diagnostic.subject_web_session_count);
  const subjectActive = count(diagnostic.subject_active_web_session_count);
  const subjectFull = count(diagnostic.subject_active_full_session_count);
  const subjectNonfull = count(diagnostic.subject_active_nonfull_session_count);
  const subjectRevoked = count(diagnostic.subject_revoked_web_session_count);
  const subjectExpired = count(diagnostic.subject_expired_web_session_count);
  const otherActive = count(diagnostic.other_active_web_session_count);
  const otherOperator = count(diagnostic.other_active_operator_session_count);
  const otherNonOperator = count(diagnostic.other_active_non_operator_session_count);
  const subjectPartition = subjectTotal === subjectActive + subjectRevoked + subjectExpired;
  const activePartition =
    allActive === subjectActive + otherActive &&
    subjectActive === subjectFull + subjectNonfull &&
    otherActive === otherOperator + otherNonOperator;
  const latestStateExact =
    (subjectTotal === 0n && diagnostic.subject_latest_session_state === "none") ||
    (subjectTotal > 0n &&
      diagnostic.subject_latest_session_state !== "none" &&
      (!diagnostic.subject_latest_session_state.startsWith("active-") || subjectActive > 0n));
  return (
    allActive <= allTotal &&
    subjectTotal <= allTotal &&
    subjectActive <= allActive &&
    (diagnostic.subject_session_partition_exact === "t") === subjectPartition &&
    (diagnostic.active_session_partition_exact === "t") === activePartition &&
    latestStateExact &&
    diagnostic.diagnostic_verdict === expectedVerdict(diagnostic)
  );
}

export function renderHostedPostReloginSessionDiagnosticPlan() {
  return `Hosted post-relogin Web session diagnostic plan (zero network / zero write)
- Select the finalized account behind exactly one ordinary invitation automatically;
  accept no email, UUID, Cookie, session token, or invitation token input.
- Use one verify-full administrator connection and one repeatable-read READ ONLY transaction.
- Partition only fixed Web-session counts by target/other owner, active/revoked/expired,
  full/non-full access, and Operator/non-Operator role.
- Return only fixed booleans, counts, finite states, and one diagnostic verdict;
  expose no identity, token/hash, timestamp, ciphertext, URL, or content.
`;
}

export function parseHostedPostReloginSessionDiagnosticOutput(output) {
  if (
    typeof output !== "string" ||
    output.length === 0 ||
    output.length > 4_096 ||
    !output.endsWith("\n") ||
    output.includes("\r")
  ) {
    return null;
  }
  const lines = output.slice(0, -1).split("\n");
  if (lines.length !== diagnosticFields.length) return null;
  const diagnostic = {};
  for (const [index, [expectedName, type]] of diagnosticFields.entries()) {
    const tokens = lines[index]?.split("|");
    if (tokens?.length !== 2 || tokens[0] !== expectedName) return null;
    const value = tokens[1];
    if (!validValues[type].test(value)) return null;
    if (type === "count" && BigInt(value) > 9_223_372_036_854_775_807n) return null;
    diagnostic[expectedName] = value;
  }
  return crossFieldsAreExact(diagnostic) ? diagnostic : null;
}

export function renderHostedPostReloginSessionDiagnostic(diagnostic) {
  const output = `${hostedPostReloginSessionDiagnosticFieldNames
    .map((name) => `${name}|${diagnostic?.[name]}`)
    .join("\n")}\n`;
  if (parseHostedPostReloginSessionDiagnosticOutput(output) === null) {
    throw new Error(hostedPostReloginSessionDiagnosticFailureMessage);
  }
  return output;
}

export async function runHostedPostReloginSessionDiagnosticQuery(
  { administratorPassword, caCertificate },
  { runPsql = runHostedPsql } = {},
) {
  const result = await runPsql({
    captureOutput: true,
    databaseUrl: hostedAcceptancePoolerUrl,
    environment: {
      HUAYI_HOSTED_DATABASE_CA_CERTIFICATE: caCertificate,
    },
    input: renderHostedPostReloginSessionDiagnosticSql(),
    password: administratorPassword,
    timeoutMilliseconds: 30_000,
  });
  return result.code === 0 ? parseHostedPostReloginSessionDiagnosticOutput(result.stdout) : null;
}

export async function runHostedPostReloginSessionDiagnosticCli({
  arguments_ = process.argv.slice(2),
  environment = process.env,
  fetchCaCertificate = fetchHostedAcceptanceOfficialCaCertificate,
  readPassword = readHostedAdministratorPassword,
  runDiagnosticQuery = runHostedPostReloginSessionDiagnosticQuery,
  writeError = (value) => process.stderr.write(value),
  writeOutput = (value) => process.stdout.write(value),
} = {}) {
  if (arguments_.length === 1 && arguments_[0] === "--plan") {
    writeOutput(renderHostedPostReloginSessionDiagnosticPlan());
    return 0;
  }
  try {
    if (
      arguments_.length !== 1 ||
      arguments_[0] !== hostedPostReloginSessionDiagnosticArgument ||
      environmentHasInheritedPassword(environment)
    ) {
      throw new Error(hostedPostReloginSessionDiagnosticFailureMessage);
    }
    const caCertificate = await fetchCaCertificate();
    const administratorPassword = await readPassword({ environment });
    if (!passwordIsValid(administratorPassword)) {
      throw new Error(hostedPostReloginSessionDiagnosticFailureMessage);
    }
    const diagnostic = await runDiagnosticQuery({ administratorPassword, caCertificate });
    if (diagnostic === null) throw new Error(hostedPostReloginSessionDiagnosticFailureMessage);
    writeOutput(renderHostedPostReloginSessionDiagnostic(diagnostic));
    return 0;
  } catch {
    writeError(`${hostedPostReloginSessionDiagnosticFailureMessage}\n`);
    return 1;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runHostedPostReloginSessionDiagnosticCli();
}
