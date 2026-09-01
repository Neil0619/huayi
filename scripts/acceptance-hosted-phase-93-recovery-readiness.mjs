import { pathToFileURL } from "node:url";

import {
  hostedAcceptancePoolerUrl,
  hostedAcceptanceProjectRef,
  runHostedPsql,
} from "./acceptance-hosted-foundation.mjs";
import { readHiddenTerminalLine } from "./acceptance-hosted-important-batch-secret-prompt.mjs";
import { fetchHostedAcceptanceOfficialCaCertificate } from "./acceptance-hosted-official-ca.mjs";
import { renderHostedPhase93RecoveryReadinessSql } from "./acceptance-hosted-phase-93-recovery-readiness-sql.mjs";

export { renderHostedPhase93RecoveryReadinessSql } from "./acceptance-hosted-phase-93-recovery-readiness-sql.mjs";

export const hostedPhase93RecoveryReadinessArgument = `--diagnose-invitation-token-recovery-readiness-${hostedAcceptanceProjectRef}`;
export const hostedPhase93RecoveryReadinessFailureMessage =
  "Hosted Phase 93 recovery readiness diagnostic failed.";

const booleanFields = Object.freeze([
  "ordinary_invitation_unique",
  "invitation_contract_exact",
  "invitation_token_hash_valid",
  "invitation_claim_unique",
  "claim_contract_exact",
  "bound_user_claim_unique",
  "registration_flow_unique",
  "registration_flow_contract_exact",
  "auth_user_unique",
  "auth_email_contract_exact",
  "auth_email_unique",
  "auth_identity_unique_email",
  "previous_recovery_audit_absent",
  "user_profiles_absent",
  "account_sign_in_methods_absent",
  "password_recovery_flows_absent",
  "security_notification_outbox_absent",
  "web_sessions_absent",
  "account_data_export_jobs_absent",
  "account_deletion_jobs_absent",
  "extension_sessions_absent",
  "extension_pairings_absent",
  "admin_roles_absent",
  "subject_audit_events_absent",
  "study_captures_absent",
  "analysis_records_absent",
  "learning_items_absent",
  "word_entries_absent",
  "practice_sessions_absent",
  "quota_grants_absent",
  "quota_reservations_absent",
  "usage_ledger_absent",
  "model_rate_limit_events_absent",
  "mutation_preconditions_exact",
]);

export const hostedPhase93RecoveryReadinessFieldNames = Object.freeze([
  ...booleanFields,
  "eligible_verdict",
]);

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

export function renderHostedPhase93RecoveryReadinessPlan() {
  return `Hosted Phase 93 invitation-token recovery readiness plan (zero network / zero write)
- Select exactly one ordinary invitation automatically; accept no email, UUID, invitation ID, or token input.
- Use one verify-full administrator connection and one repeatable-read READ ONLY transaction.
- Mirror every stored-state precondition from 0023 without generating or rotating a token;
  runtime actor, request, idempotency, and new-token inputs remain outside this read-only check.
- Return only fixed booleans and one eligible/not-eligible verdict; expose no identity or content.
`;
}

export function parseHostedPhase93RecoveryReadinessOutput(output) {
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
  if (lines.length !== hostedPhase93RecoveryReadinessFieldNames.length) return null;
  const result = {};
  for (const [index, name] of hostedPhase93RecoveryReadinessFieldNames.entries()) {
    const tokens = lines[index]?.split("|");
    if (tokens?.length !== 2 || tokens[0] !== name) return null;
    const value = tokens[1];
    if (name === "eligible_verdict") {
      if (!/^(?:eligible|not-eligible)$/u.test(value)) return null;
    } else if (!/^[tf]$/u.test(value)) {
      return null;
    }
    result[name] = value;
  }
  const exact = booleanFields.every((name) => result[name] === "t");
  if ((result.eligible_verdict === "eligible") !== exact) return null;
  return result;
}

export function renderHostedPhase93RecoveryReadiness(readiness) {
  const output = `${hostedPhase93RecoveryReadinessFieldNames
    .map((name) => `${name}|${readiness?.[name]}`)
    .join("\n")}\n`;
  if (parseHostedPhase93RecoveryReadinessOutput(output) === null) {
    throw new Error(hostedPhase93RecoveryReadinessFailureMessage);
  }
  return output;
}

export async function runHostedPhase93RecoveryReadinessQuery(
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
    input: renderHostedPhase93RecoveryReadinessSql(),
    timeoutMilliseconds: 30_000,
  });
  return result.code === 0 ? parseHostedPhase93RecoveryReadinessOutput(result.stdout) : null;
}

export async function runHostedPhase93RecoveryReadinessCli({
  arguments_ = process.argv.slice(2),
  environment = process.env,
  fetchCaCertificate = fetchHostedAcceptanceOfficialCaCertificate,
  readPassword = readHiddenTerminalLine,
  runReadinessQuery = runHostedPhase93RecoveryReadinessQuery,
  writeError = (value) => process.stderr.write(value),
  writeOutput = (value) => process.stdout.write(value),
} = {}) {
  if (arguments_.length === 1 && arguments_[0] === "--plan") {
    writeOutput(renderHostedPhase93RecoveryReadinessPlan());
    return 0;
  }
  try {
    if (
      arguments_.length !== 1 ||
      arguments_[0] !== hostedPhase93RecoveryReadinessArgument ||
      environmentHasInheritedPassword(environment)
    ) {
      throw new Error(hostedPhase93RecoveryReadinessFailureMessage);
    }
    const caCertificate = await fetchCaCertificate();
    const administratorPassword = await readPassword();
    if (!passwordIsValid(administratorPassword)) {
      throw new Error(hostedPhase93RecoveryReadinessFailureMessage);
    }
    const readiness = await runReadinessQuery({ administratorPassword, caCertificate });
    if (readiness === null) throw new Error(hostedPhase93RecoveryReadinessFailureMessage);
    writeOutput(renderHostedPhase93RecoveryReadiness(readiness));
    return readiness.eligible_verdict === "eligible" ? 0 : 1;
  } catch {
    writeError(`${hostedPhase93RecoveryReadinessFailureMessage}\n`);
    return 1;
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runHostedPhase93RecoveryReadinessCli();
}
