import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

import {
  readHostedCredential,
  rejectLegacyHostedCredentialEnvironment,
} from "./acceptance-hosted-credentials.mjs";
import {
  hostedAcceptancePoolerUrl,
  hostedAcceptanceProjectRef,
  runHostedPsql,
  sqlLiteral,
} from "./acceptance-hosted-foundation.mjs";
import { renderFirstOperatorStatusSql } from "./acceptance-hosted-first-operator.mjs";
import { fetchHostedAcceptanceOfficialCaCertificate } from "./acceptance-hosted-official-ca.mjs";

export const pepperContinuityVerificationArgument = `--verify-hosted-pepper-continuity-${hostedAcceptanceProjectRef}`;

function requireSecret(environment, name, predicate, message) {
  const value = environment[name];
  if (typeof value !== "string" || !predicate(value)) throw new Error(message);
  return value;
}

function requireInvitationToken(environment) {
  return requireSecret(
    environment,
    "HUAYI_BOOTSTRAP_INVITATION_TOKEN",
    (value) => /^[A-Za-z0-9_-]{43}$/u.test(value),
    "Hosted Bootstrap invitation token is unavailable.",
  );
}

function requirePepper(environment) {
  return requireSecret(
    environment,
    "HUAYI_SECRET_PEPPER",
    (value) => value.length >= 32 && value.length <= 512 && !value.includes("\0"),
    "Hosted acceptance secret pepper is unavailable.",
  );
}

function hashInvitation(token, pepper) {
  return createHash("sha256").update(pepper).update("\0").update(token).digest("base64url");
}

export function renderPepperContinuitySql(tokenHash) {
  const statusSql = renderFirstOperatorStatusSql().trim().replace(/;$/u, "");
  return `
BEGIN READ ONLY;
WITH current_status(status) AS MATERIALIZED (
${statusSql}
), bootstrap AS MATERIALIZED (
  SELECT * FROM huayi_private.first_operator_bootstrap WHERE singleton = true
), current_invitation AS MATERIALIZED (
  SELECT invitation.*
  FROM public.invitations invitation
  JOIN bootstrap ON bootstrap.current_invitation_id = invitation.id
)
SELECT
  (SELECT count(*) FROM bootstrap) = 1
  AND (SELECT status FROM current_status) = 'registration-interrupted'
  AND (SELECT count(*) FROM current_invitation) = 1
  AND EXISTS (
    SELECT 1
    FROM current_invitation invitation
    JOIN bootstrap ON bootstrap.current_invitation_id = invitation.id
    WHERE bootstrap.state = 'invited'
      AND invitation.created_by_kind = 'deployment-bootstrap'
      AND invitation.created_by IS NULL
      AND invitation.token_hash = ${sqlLiteral(tokenHash)}
      AND invitation.expires_at > now()
      AND invitation.consumed_at IS NULL
      AND invitation.revoked_at IS NULL
  );
COMMIT;
`;
}

function databaseEnvironment(caCertificate) {
  return {
    HUAYI_HOSTED_DATABASE_CA_CERTIFICATE: caCertificate,
  };
}

export async function runPepperContinuityVerification({
  arguments_ = process.argv.slice(2),
  environment = process.env,
  fetchCaCertificate = fetchHostedAcceptanceOfficialCaCertificate,
  readCredential = readHostedCredential,
  runPsql = runHostedPsql,
} = {}) {
  if (arguments_.length !== 1 || arguments_[0] !== pepperContinuityVerificationArgument) {
    throw new Error("Hosted pepper continuity arguments are invalid.");
  }
  rejectLegacyHostedCredentialEnvironment(environment);
  const tokenHash = hashInvitation(requireInvitationToken(environment), requirePepper(environment));
  const caCertificate = await fetchCaCertificate();
  const password = await readCredential("supabase-admin-db-password", { environment });
  const result = await runPsql({
    captureOutput: true,
    databaseUrl: hostedAcceptancePoolerUrl,
    environment: databaseEnvironment(caCertificate),
    input: renderPepperContinuitySql(tokenHash),
    password,
  });
  if (result.code !== 0 || result.stdout.trim() !== "t") {
    throw new Error("Hosted pepper continuity verification failed.");
  }
  return { outcome: "verified" };
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runPepperContinuityVerification()
    .then(() => {
      process.stdout.write("Hosted first Operator pepper continuity verification passed.\n");
    })
    .catch(() => {
      process.stderr.write("Hosted first Operator pepper continuity verification failed.\n");
      process.exitCode = 1;
    });
}
