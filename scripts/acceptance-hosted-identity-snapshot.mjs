import { pathToFileURL } from "node:url";

import {
  hostedAcceptancePoolerUrl,
  hostedAcceptanceProjectRef,
  runHostedPsql,
} from "./acceptance-hosted-foundation.mjs";
import { readHiddenTerminalLine } from "./acceptance-hosted-important-batch-secret-prompt.mjs";
import { fetchHostedAcceptanceOfficialCaCertificate } from "./acceptance-hosted-official-ca.mjs";
import { renderHostedIdentitySnapshotSql } from "./acceptance-hosted-identity-snapshot-sql.mjs";

export { renderHostedIdentitySnapshotSql } from "./acceptance-hosted-identity-snapshot-sql.mjs";

export const hostedIdentitySnapshotArgument = `--snapshot-hosted-invitation-auth-account-${hostedAcceptanceProjectRef}`;
export const hostedIdentitySnapshotFailureMessage = "Hosted identity snapshot failed.";

const snapshotFields = Object.freeze([
  ["ordinary_invitations_total", "count"],
  ["ordinary_available_count", "count"],
  ["ordinary_expired_count", "count"],
  ["ordinary_consumed_count", "count"],
  ["ordinary_revoked_count", "count"],
  ["ordinary_invalid_count", "count"],
  ["latest_invitation_state", "invitation-state"],
  ["latest_claim_count", "count"],
  ["latest_claim_state", "claim-state"],
  ["latest_registration_flow_count", "count"],
  ["latest_registration_flow_state", "flow-state"],
  ["subject_auth_user_state", "auth-state"],
  ["subject_email_binding_exact", "boolean"],
  ["subject_auth_identity_count", "count"],
  ["subject_email_identity_exact", "boolean"],
  ["subject_profile_state", "profile-state"],
  ["subject_password_method_count", "count"],
  ["subject_google_method_count", "count"],
  ["subject_current_quota_count", "count"],
  ["subject_active_web_session_count", "count"],
  ["subject_active_extension_session_count", "count"],
  ["subject_learning_item_count", "count"],
  ["subject_analysis_record_count", "count"],
  ["subject_practice_session_count", "count"],
  ["subject_registration_blocker_count", "count"],
  ["subject_learning_data_present", "boolean"],
  ["otp_resend_eligible", "boolean"],
  ["interrupted_resume_eligible", "boolean"],
  ["account_finalized_exact", "boolean"],
  ["safe_route_state", "route-state"],
]);

export const hostedIdentitySnapshotFieldNames = Object.freeze(snapshotFields.map(([name]) => name));

const validValues = Object.freeze({
  "auth-state": /^(?:none|unconfirmed|confirmed|invalid)$/u,
  boolean: /^(?:t|f)$/u,
  "claim-state":
    /^(?:none|unbound-active|unbound-expired|bound-active|bound-expired|finalized|invalid)$/u,
  count: /^(?:0|[1-9]\d{0,18})$/u,
  "flow-state": /^(?:none|active|expired|consumed|invalid)$/u,
  "invitation-state": /^(?:none|available|expired|consumed|revoked|invalid)$/u,
  "profile-state": /^(?:none|active|disabled|deleting|invalid)$/u,
  "route-state":
    /^(?:no-invitation|use-existing-link|otp-resend|resume-registration|account-established|replacement-review|stop-inconsistent)$/u,
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

export function renderHostedIdentitySnapshotPlan() {
  return `Hosted identity snapshot plan (zero network / zero write)
- Select the latest ordinary invitation automatically; accept no email, user ID, or token input.
- Use one verify-full administrator connection and one repeatable-read READ ONLY transaction.
- Return only fixed status, boolean, and count fields; expose no identity or learning content.
- Classify whether to use the existing link, resend OTP, resume registration, or stop for review.
`;
}

export function parseHostedIdentitySnapshotOutput(output) {
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
  if (lines.length !== snapshotFields.length) return null;
  const snapshot = {};
  for (const [index, [expectedName, type]] of snapshotFields.entries()) {
    const tokens = lines[index]?.split("|");
    if (tokens?.length !== 2 || tokens[0] !== expectedName) return null;
    const value = tokens[1];
    if (!isValidSnapshotValue(type, value)) return null;
    snapshot[expectedName] = value;
  }
  return snapshot;
}

export function renderHostedIdentitySnapshot(snapshot) {
  const lines = [];
  for (const [name, type] of snapshotFields) {
    const value = snapshot?.[name];
    if (!isValidSnapshotValue(type, value)) {
      throw new Error(hostedIdentitySnapshotFailureMessage);
    }
    lines.push(`${name}|${value}`);
  }
  return `${lines.join("\n")}\n`;
}

export async function runHostedIdentitySnapshotQuery(
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
    input: renderHostedIdentitySnapshotSql(),
    timeoutMilliseconds: 30_000,
  });
  return result.code === 0 ? parseHostedIdentitySnapshotOutput(result.stdout) : null;
}

export async function runHostedIdentitySnapshotCli({
  arguments_ = process.argv.slice(2),
  environment = process.env,
  fetchCaCertificate = fetchHostedAcceptanceOfficialCaCertificate,
  readPassword = readHiddenTerminalLine,
  runSnapshotQuery = runHostedIdentitySnapshotQuery,
  writeError = (value) => process.stderr.write(value),
  writeOutput = (value) => process.stdout.write(value),
} = {}) {
  if (arguments_.length === 1 && arguments_[0] === "--plan") {
    writeOutput(renderHostedIdentitySnapshotPlan());
    return 0;
  }
  try {
    if (
      arguments_.length !== 1 ||
      arguments_[0] !== hostedIdentitySnapshotArgument ||
      environmentHasInheritedPassword(environment)
    ) {
      throw new Error(hostedIdentitySnapshotFailureMessage);
    }
    const caCertificate = await fetchCaCertificate();
    const administratorPassword = await readPassword();
    if (!passwordIsValid(administratorPassword)) {
      throw new Error(hostedIdentitySnapshotFailureMessage);
    }
    const snapshot = await runSnapshotQuery({ administratorPassword, caCertificate });
    if (snapshot === null) throw new Error(hostedIdentitySnapshotFailureMessage);
    writeOutput(renderHostedIdentitySnapshot(snapshot));
    return 0;
  } catch {
    writeError(`${hostedIdentitySnapshotFailureMessage}\n`);
    return 1;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runHostedIdentitySnapshotCli();
}
