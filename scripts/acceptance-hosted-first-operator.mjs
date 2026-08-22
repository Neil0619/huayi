import { createHash, randomBytes, randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";

import {
  hostedAcceptancePoolerUrl,
  hostedAcceptanceProjectRef,
  requirePostgresPassword,
  runHostedPsql,
  sqlLiteral,
} from "./acceptance-hosted-foundation.mjs";

export const firstOperatorStatusArgument = `--status-first-operator-${hostedAcceptanceProjectRef}`;
export const firstOperatorInviteConfirmation = `--confirm-first-operator-invitation-${hostedAcceptanceProjectRef}`;
export const firstOperatorReplaceConfirmation = `--confirm-replace-unclaimed-first-operator-invitation-${hostedAcceptanceProjectRef}`;
export const firstOperatorCompleteConfirmation = `--confirm-complete-first-operator-${hostedAcceptanceProjectRef}`;

const hostedWebOrigin = "https://app.acceptance.seen-said.cn";
const statuses = new Set([
  "empty",
  "invited",
  "registering",
  "registered",
  "completed",
  "completed-operator-deleted",
  "invalid",
]);

function requirePepper(environment) {
  const pepper = environment.HUAYI_SECRET_PEPPER;
  if (
    typeof pepper !== "string" ||
    pepper.length < 32 ||
    pepper.length > 512 ||
    pepper.includes("\0")
  ) {
    throw new Error("Hosted acceptance secret pepper is unavailable.");
  }
  return pepper;
}

function hashInvitation(token, pepper) {
  return createHash("sha256").update(pepper).update("\0").update(token).digest("base64url");
}

export function hostedFirstOperatorInvitationUrl(token) {
  return `${hostedWebOrigin}/join#${token}`;
}

export function renderFirstOperatorStatusSql() {
  return `
SELECT CASE
  WHEN (SELECT count(*) FROM huayi_private.first_operator_bootstrap) = 0
    AND (SELECT count(*) FROM auth.users) = 0
    AND (SELECT count(*) FROM auth.identities) = 0
    AND (SELECT count(*) FROM public.user_profiles) = 0
    AND (SELECT count(*) FROM public.admin_roles) = 0
    AND (SELECT count(*) FROM public.invitations) = 0
    AND (SELECT count(*) FROM public.invitation_claims) = 0
  THEN 'empty'
  WHEN (SELECT state FROM huayi_private.first_operator_bootstrap WHERE singleton = true) = 'invited'
    AND (SELECT consumed_at FROM public.invitations WHERE id = (
      SELECT current_invitation_id FROM huayi_private.first_operator_bootstrap WHERE singleton = true
    )) IS NULL
    AND (SELECT count(*) FROM auth.users) = 0
    AND (SELECT count(*) FROM auth.identities) = 0
    AND (SELECT count(*) FROM public.user_profiles) = 0
    AND (SELECT count(*) FROM public.admin_roles) = 0
    AND (SELECT count(*) FROM public.invitation_claims) = 0
  THEN 'invited'
  WHEN (SELECT state FROM huayi_private.first_operator_bootstrap WHERE singleton = true) = 'invited'
    AND (SELECT consumed_at FROM public.invitations WHERE id = (
      SELECT current_invitation_id FROM huayi_private.first_operator_bootstrap WHERE singleton = true
    )) IS NULL
    AND (SELECT count(*) FROM public.user_profiles) = 0
    AND (SELECT count(*) FROM public.admin_roles) = 0
    AND (
      (SELECT count(*) FROM public.invitation_claims) > 0
      OR (SELECT count(*) FROM auth.users) > 0
      OR (SELECT count(*) FROM auth.identities) > 0
    )
  THEN 'registering'
  WHEN (SELECT state FROM huayi_private.first_operator_bootstrap WHERE singleton = true) = 'invited'
    AND (SELECT consumed_at FROM public.invitations WHERE id = (
      SELECT current_invitation_id FROM huayi_private.first_operator_bootstrap WHERE singleton = true
    )) IS NOT NULL
    AND (SELECT count(*) FROM auth.users) = 1
    AND (SELECT count(*) FROM auth.identities) >= 1
    AND (SELECT count(*) FROM public.user_profiles) = 1
    AND (SELECT count(*) FROM public.admin_roles) = 0
    AND (SELECT count(*) FROM public.invitation_claims) = 1
    AND (SELECT count(*) FROM public.invitation_claims
         WHERE invitation_id = (
           SELECT current_invitation_id FROM huayi_private.first_operator_bootstrap
           WHERE singleton = true
         ) AND bound_user_id IS NOT NULL AND bound_user_id = finalized_user_id) = 1
    AND (SELECT count(*) FROM auth.users WHERE id = (
      SELECT finalized_user_id FROM public.invitation_claims WHERE invitation_id = (
        SELECT current_invitation_id FROM huayi_private.first_operator_bootstrap
        WHERE singleton = true
      )
    )) = 1
    AND NOT EXISTS (SELECT 1 FROM auth.identities WHERE user_id <> (
      SELECT finalized_user_id FROM public.invitation_claims WHERE invitation_id = (
        SELECT current_invitation_id FROM huayi_private.first_operator_bootstrap
        WHERE singleton = true
      )
    ))
    AND (SELECT count(*) FROM public.user_profiles
         WHERE user_id = owner_user_id AND status = 'active' AND user_id = (
           SELECT finalized_user_id FROM public.invitation_claims WHERE invitation_id = (
             SELECT current_invitation_id FROM huayi_private.first_operator_bootstrap
             WHERE singleton = true
           )
         )) = 1
    AND (SELECT count(*) FROM public.account_sign_in_methods) BETWEEN 1 AND 2
    AND NOT EXISTS (SELECT 1 FROM public.account_sign_in_methods WHERE owner_user_id <> (
      SELECT finalized_user_id FROM public.invitation_claims WHERE invitation_id = (
        SELECT current_invitation_id FROM huayi_private.first_operator_bootstrap
        WHERE singleton = true
      )
    ))
    AND (SELECT count(*) FROM public.quota_grants) = 1
  THEN 'registered'
  WHEN (SELECT state FROM huayi_private.first_operator_bootstrap WHERE singleton = true) = 'completed'
    AND (SELECT operator_user_id FROM huayi_private.first_operator_bootstrap
         WHERE singleton = true) IS NOT NULL
    AND (SELECT operator_deleted_at FROM huayi_private.first_operator_bootstrap
         WHERE singleton = true) IS NULL
    AND (SELECT count(*) FROM public.admin_roles WHERE role = 'operator' AND user_id = (
      SELECT operator_user_id FROM huayi_private.first_operator_bootstrap WHERE singleton = true
    )) = 1
    AND (SELECT count(*) FROM public.admin_roles) = 1
  THEN 'completed'
  WHEN (SELECT state FROM huayi_private.first_operator_bootstrap WHERE singleton = true) = 'completed'
    AND (SELECT operator_deleted_at FROM huayi_private.first_operator_bootstrap
         WHERE singleton = true) IS NOT NULL
    AND (SELECT count(*) FROM public.admin_roles) = 0
    AND (SELECT count(*) FROM public.user_profiles) = 0
  THEN 'completed-operator-deleted'
  ELSE 'invalid'
END;
`;
}

export function renderFirstOperatorInvitationSql({
  action,
  expiresAt,
  invitationId,
  issuedAt,
  tokenHash,
}) {
  const functionName =
    action === "invite" ? "issue_first_operator_invitation" : "replace_first_operator_invitation";
  return `
BEGIN;
SELECT huayi_private.${functionName}(
  ${sqlLiteral(invitationId)},${sqlLiteral(tokenHash)},
  ${sqlLiteral(expiresAt.toISOString())}::timestamptz,
  ${sqlLiteral(issuedAt.toISOString())}::timestamptz
);
COMMIT;
`;
}

export function renderFirstOperatorCompleteSql(operationTime) {
  return `
BEGIN;
SELECT huayi_private.complete_first_operator_bootstrap(
  ${sqlLiteral(operationTime.toISOString())}::timestamptz
);
COMMIT;
`;
}

function databaseEnvironment(environment) {
  return {
    HUAYI_HOSTED_DATABASE_CA_CERTIFICATE: environment.HUAYI_HOSTED_DATABASE_CA_CERTIFICATE,
    PGPASSWORD: environment.PGPASSWORD,
  };
}

export async function runHostedFirstOperator({
  arguments_ = process.argv.slice(2),
  environment = process.env,
  now = () => new Date(),
  randomBytes_ = randomBytes,
  randomUuid = randomUUID,
  runPsql = runHostedPsql,
} = {}) {
  if (arguments_.length === 1 && arguments_[0] === "--plan") {
    return { outcome: "planned" };
  }

  const [action, confirmation] = arguments_;
  const expectedConfirmation =
    action === "status"
      ? firstOperatorStatusArgument
      : action === "invite"
        ? firstOperatorInviteConfirmation
        : action === "replace"
          ? firstOperatorReplaceConfirmation
          : action === "complete"
            ? firstOperatorCompleteConfirmation
            : undefined;
  if (arguments_.length !== 2 || confirmation !== expectedConfirmation) {
    throw new Error("Hosted first Operator arguments are invalid.");
  }

  requirePostgresPassword(environment);
  const sharedCall = {
    databaseUrl: hostedAcceptancePoolerUrl,
    environment: databaseEnvironment(environment),
  };

  if (action === "status") {
    const result = await runPsql({
      ...sharedCall,
      captureOutput: true,
      input: renderFirstOperatorStatusSql(),
    });
    const status = result.stdout.trim();
    if (result.code !== 0 || !statuses.has(status)) {
      throw new Error("Hosted first Operator status failed.");
    }
    return { outcome: "status", status };
  }

  if (action === "complete") {
    const result = await runPsql({
      ...sharedCall,
      captureOutput: false,
      input: renderFirstOperatorCompleteSql(now()),
    });
    if (result.code !== 0) throw new Error("Hosted first Operator completion failed.");
    return { outcome: "completed" };
  }

  const issuedAt = now();
  const token = randomBytes_(32).toString("base64url");
  const result = await runPsql({
    ...sharedCall,
    captureOutput: false,
    input: renderFirstOperatorInvitationSql({
      action,
      expiresAt: new Date(issuedAt.getTime() + 72 * 60 * 60 * 1_000),
      invitationId: randomUuid(),
      issuedAt,
      tokenHash: hashInvitation(token, requirePepper(environment)),
    }),
  });
  if (result.code !== 0) throw new Error("Hosted first Operator invitation failed.");
  return {
    invitationUrl: hostedFirstOperatorInvitationUrl(token),
    outcome: action === "invite" ? "invited" : "replaced",
  };
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runHostedFirstOperator()
    .then((result) => {
      if (result.outcome === "planned") {
        process.stdout.write("Hosted first Operator plan is ready; no remote changes were made.\n");
      } else if (result.outcome === "status") {
        process.stdout.write(`Hosted first Operator status: ${result.status}.\n`);
      } else if (result.outcome === "completed") {
        process.stdout.write("Hosted first Operator bootstrap completed.\n");
      } else {
        process.stdout.write(`${result.invitationUrl}\n`);
      }
    })
    .catch(() => {
      process.stderr.write("Hosted first Operator operation failed.\n");
      process.exitCode = 1;
    });
}
