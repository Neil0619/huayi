import { createHash, randomBytes, randomUUID } from "node:crypto";
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

export const firstOperatorStatusArgument = `--status-first-operator-${hostedAcceptanceProjectRef}`;
export const firstOperatorVerifyArgument = `--verify-completed-first-operator-${hostedAcceptanceProjectRef}`;
export const firstOperatorInviteConfirmation = `--confirm-first-operator-invitation-${hostedAcceptanceProjectRef}`;
export const firstOperatorReplaceConfirmation = `--confirm-replace-unclaimed-first-operator-invitation-${hostedAcceptanceProjectRef}`;
export const firstOperatorCompleteConfirmation = `--confirm-complete-first-operator-${hostedAcceptanceProjectRef}`;

const hostedWebOrigin = "https://app.acceptance.seen-said.cn";
const statuses = new Set([
  "empty",
  "invited",
  "registering",
  "registration-interrupted",
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
    AND EXISTS (
      SELECT 1
      FROM public.invitations invitation
      JOIN huayi_private.first_operator_bootstrap bootstrap
        ON bootstrap.current_invitation_id = invitation.id
      WHERE invitation.created_by_kind = 'deployment-bootstrap'
        AND invitation.created_by IS NULL
        AND invitation.expires_at > now()
        AND invitation.consumed_at IS NULL
        AND invitation.revoked_at IS NULL
    )
    AND (SELECT count(*) FROM auth.users) = 0
    AND (SELECT count(*) FROM auth.identities) = 0
    AND (SELECT count(*) FROM public.user_profiles) = 0
    AND (SELECT count(*) FROM public.admin_roles) = 0
    AND (SELECT count(*) FROM public.invitation_claims) = 0
  THEN 'invited'
  WHEN (SELECT state FROM huayi_private.first_operator_bootstrap WHERE singleton = true) = 'invited'
    AND EXISTS (
      SELECT 1
      FROM public.invitations invitation
      JOIN huayi_private.first_operator_bootstrap bootstrap
        ON bootstrap.current_invitation_id = invitation.id
      WHERE invitation.created_by_kind = 'deployment-bootstrap'
        AND invitation.created_by IS NULL
        AND invitation.expires_at > now()
        AND invitation.consumed_at IS NULL
        AND invitation.revoked_at IS NULL
    )
    AND (SELECT count(*) FROM public.invitation_claims) = 1
    AND EXISTS (
      SELECT 1
      FROM public.invitation_claims claim
      JOIN huayi_private.first_operator_bootstrap bootstrap
        ON bootstrap.current_invitation_id = claim.invitation_id
      WHERE claim.expires_at <= now()
        AND claim.bound_user_id IS NOT NULL
        AND claim.finalized_user_id IS NULL
    )
    AND (SELECT count(*) FROM public.auth_flows) = 1
    AND EXISTS (
      SELECT 1
      FROM public.auth_flows auth_flow
      JOIN public.invitation_claims claim ON claim.ticket_hash = auth_flow.ticket_hash
      WHERE auth_flow.kind = 'invite-registration'
        AND auth_flow.expires_at <= now()
        AND auth_flow.consumed_at IS NULL
    )
    AND (SELECT count(*) FROM auth.users) = 1
    AND EXISTS (
      SELECT 1
      FROM auth.users auth_user
      JOIN public.invitation_claims claim ON claim.bound_user_id = auth_user.id
      WHERE auth_user.email_confirmed_at IS NOT NULL
    )
    AND (SELECT count(*) FROM auth.identities) = 1
    AND EXISTS (
      SELECT 1
      FROM auth.identities identity
      JOIN public.invitation_claims claim ON claim.bound_user_id = identity.user_id
      WHERE identity.provider = 'email'
    )
    AND (SELECT count(*) FROM public.user_profiles) = 0
    AND (SELECT count(*) FROM public.account_sign_in_methods) = 0
    AND (SELECT count(*) FROM public.quota_grants) = 0
    AND (SELECT count(*) FROM public.web_sessions) = 0
    AND (SELECT count(*) FROM public.extension_sessions) = 0
    AND (SELECT count(*) FROM public.admin_roles) = 0
    AND NOT EXISTS (
      SELECT 1
      FROM public.account_deletion_jobs deletion
      JOIN public.invitation_claims claim ON claim.bound_user_id = deletion.subject_user_id
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.audit_events audit
      JOIN public.invitation_claims claim
        ON claim.bound_user_id = audit.actor_user_id OR claim.bound_user_id = audit.subject_id
    )
  THEN 'registration-interrupted'
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

export function renderFirstOperatorVerificationSql() {
  return `
BEGIN READ ONLY;
WITH bootstrap AS MATERIALIZED (
  SELECT * FROM huayi_private.first_operator_bootstrap WHERE singleton = true
)
SELECT
  (SELECT count(*) FROM bootstrap) = 1
  AND EXISTS (
    SELECT 1 FROM bootstrap
    WHERE state = 'completed' AND completed_at IS NOT NULL
      AND operator_user_id IS NOT NULL AND operator_deleted_at IS NULL
  )
  AND (SELECT count(*) FROM public.invitations) = (SELECT revision FROM bootstrap)
  AND NOT EXISTS (
    SELECT 1 FROM public.invitations invitation, bootstrap
    WHERE invitation.created_by_kind <> 'deployment-bootstrap'
      OR invitation.created_by IS NOT NULL
      OR (
        invitation.id = bootstrap.current_invitation_id
        AND (invitation.consumed_at IS NULL OR invitation.revoked_at IS NOT NULL)
      )
      OR (
        invitation.id <> bootstrap.current_invitation_id
        AND (invitation.consumed_at IS NOT NULL OR invitation.revoked_at IS NULL)
      )
  )
  AND (SELECT count(*) FROM public.invitation_claims) = 1
  AND EXISTS (
    SELECT 1
    FROM bootstrap
    JOIN public.invitation_claims claim
      ON claim.invitation_id = bootstrap.current_invitation_id
    WHERE claim.ticket_hash IS NOT NULL
      AND claim.bound_user_id = bootstrap.operator_user_id
      AND claim.finalized_user_id = bootstrap.operator_user_id
  )
  AND (SELECT count(*) FROM auth.users) = 1
  AND EXISTS (
    SELECT 1 FROM auth.users auth_user, bootstrap
    WHERE auth_user.id = bootstrap.operator_user_id
      AND auth_user.email_confirmed_at IS NOT NULL
  )
  AND (SELECT count(*) FROM auth.identities) BETWEEN 1 AND 2
  AND NOT EXISTS (
    SELECT 1 FROM auth.identities identity, bootstrap
    WHERE identity.user_id <> bootstrap.operator_user_id
  )
  AND (SELECT count(*) FROM public.user_profiles) = 1
  AND EXISTS (
    SELECT 1 FROM public.user_profiles profile, bootstrap
    WHERE profile.user_id = bootstrap.operator_user_id
      AND profile.owner_user_id = bootstrap.operator_user_id
      AND profile.status = 'active'
  )
  AND (SELECT count(*) FROM public.account_sign_in_methods) = 1
  AND EXISTS (
    SELECT 1 FROM public.account_sign_in_methods sign_in_method, bootstrap
    WHERE sign_in_method.owner_user_id = bootstrap.operator_user_id
      AND sign_in_method.method = 'password'
  )
  AND (SELECT count(*) FROM public.quota_grants) = 1
  AND EXISTS (
    SELECT 1
    FROM public.quota_grants quota
    JOIN public.user_profiles profile ON profile.user_id = quota.user_id
    JOIN bootstrap ON bootstrap.operator_user_id = quota.user_id
    WHERE quota.owner_user_id = bootstrap.operator_user_id
      AND quota.source = 'default' AND quota.superseded_at IS NULL
      AND quota.limit_micro_usd = 1000000
      AND quota.period_start <= profile.created_at AND profile.created_at < quota.period_end
  )
  AND (SELECT count(*) FROM public.admin_roles) = 1
  AND EXISTS (
    SELECT 1 FROM public.admin_roles admin_role, bootstrap
    WHERE admin_role.user_id = bootstrap.operator_user_id AND admin_role.role = 'operator'
  )
  AND (SELECT count(*) FROM public.auth_flows) = 1
  AND EXISTS (
    SELECT 1
    FROM public.auth_flows auth_flow
    JOIN public.invitation_claims claim ON claim.ticket_hash = auth_flow.ticket_hash
    JOIN bootstrap ON bootstrap.current_invitation_id = claim.invitation_id
    WHERE auth_flow.kind = 'invite-registration' AND auth_flow.consumed_at IS NOT NULL
  )
  AND (SELECT count(*) FROM public.web_sessions) = 1
  AND EXISTS (
    SELECT 1 FROM public.web_sessions web_session, bootstrap
    WHERE web_session.user_id = bootstrap.operator_user_id
      AND web_session.owner_user_id = bootstrap.operator_user_id
      AND web_session.access_scope = 'full'
      AND web_session.revoked_at IS NULL
      AND web_session.reauthenticated_method IS NULL
  )
  AND (SELECT count(*) FROM public.runtime_controls) = 1
  AND EXISTS (
    SELECT 1 FROM public.runtime_controls runtime_control
    WHERE runtime_control.name = 'model_kill_switch' AND runtime_control.enabled
  )
  AND NOT EXISTS (SELECT 1 FROM public.audit_events)
  AND NOT EXISTS (SELECT 1 FROM public.study_captures)
  AND NOT EXISTS (SELECT 1 FROM public.learning_items)
  AND NOT EXISTS (SELECT 1 FROM public.analysis_requests)
  AND NOT EXISTS (SELECT 1 FROM public.quota_reservations)
  AND NOT EXISTS (SELECT 1 FROM public.usage_ledger)
  AND NOT EXISTS (SELECT 1 FROM public.model_rate_limit_events);
COMMIT;
`;
}

function databaseEnvironment(environment) {
  return {
    HUAYI_HOSTED_DATABASE_CA_CERTIFICATE: environment.HUAYI_HOSTED_DATABASE_CA_CERTIFICATE,
  };
}

export async function runHostedFirstOperator({
  arguments_ = process.argv.slice(2),
  environment = process.env,
  now = () => new Date(),
  randomBytes_ = randomBytes,
  randomUuid = randomUUID,
  readCredential = readHostedCredential,
  runPsql = runHostedPsql,
} = {}) {
  if (arguments_.length === 1 && arguments_[0] === "--plan") {
    return { outcome: "planned" };
  }

  const [action, confirmation] = arguments_;
  const expectedConfirmation =
    action === "status"
      ? firstOperatorStatusArgument
      : action === "verify"
        ? firstOperatorVerifyArgument
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

  rejectLegacyHostedCredentialEnvironment(environment);
  const password = await readCredential("supabase-admin-db-password", { environment });
  const sharedCall = {
    databaseUrl: hostedAcceptancePoolerUrl,
    environment: databaseEnvironment(environment),
    password,
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

  if (action === "verify") {
    const result = await runPsql({
      ...sharedCall,
      captureOutput: true,
      input: renderFirstOperatorVerificationSql(),
    });
    if (result.code !== 0 || result.stdout.trim() !== "t") {
      throw new Error("Hosted first Operator verification failed.");
    }
    return { outcome: "verified" };
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
      } else if (result.outcome === "verified") {
        process.stdout.write("Hosted first Operator post-completion verification passed.\n");
      } else {
        process.stdout.write(`${result.invitationUrl}\n`);
      }
    })
    .catch(() => {
      process.stderr.write(
        process.argv[2] === "verify"
          ? "Hosted first Operator post-completion verification failed.\n"
          : "Hosted first Operator operation failed.\n",
      );
      process.exitCode = 1;
    });
}
