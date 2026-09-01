export function renderHostedPostReloginSessionDiagnosticSql() {
  return `BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
WITH
migration_state AS (
  SELECT EXISTS (
    SELECT 1
    FROM supabase_migrations.schema_migrations
    WHERE version::text = '20260831010000'
  ) AS migration_0023_applied
),
ordinary_invitations AS (
  SELECT invitations.*
  FROM public.invitations AS invitations
  WHERE invitations.created_by_kind = 'operator'
),
ordinary_invitation_count AS (
  SELECT count(*)::bigint AS total FROM ordinary_invitations
),
target_invitation AS (
  SELECT invitations.*
  FROM ordinary_invitations AS invitations
  CROSS JOIN ordinary_invitation_count AS counts
  WHERE counts.total = 1
),
target_claim_rows AS (
  SELECT claims.*
  FROM public.invitation_claims AS claims
  JOIN target_invitation AS invitations ON invitations.id = claims.invitation_id
),
target_claim_count AS (
  SELECT count(*)::bigint AS total FROM target_claim_rows
),
target_claim AS (
  SELECT claims.*
  FROM target_claim_rows AS claims
  CROSS JOIN target_claim_count AS counts
  WHERE counts.total = 1
),
target_flow_rows AS (
  SELECT flows.*
  FROM public.auth_flows AS flows
  JOIN target_claim AS claims ON claims.ticket_hash = flows.ticket_hash
  WHERE flows.kind = 'invite-registration'
),
target_flow_count AS (
  SELECT count(*)::bigint AS total FROM target_flow_rows
),
target_flow AS (
  SELECT flows.*
  FROM target_flow_rows AS flows
  CROSS JOIN target_flow_count AS counts
  WHERE counts.total = 1
),
subject_auth_users AS (
  SELECT users.*
  FROM auth.users AS users
  JOIN target_claim AS claims ON claims.bound_user_id = users.id
),
subject_auth_user_count AS (
  SELECT count(*)::bigint AS total FROM subject_auth_users
),
subject_identity_counts AS (
  SELECT count(*)::bigint AS total,
    count(*) FILTER (WHERE identities.provider = 'email')::bigint AS email,
    count(*) FILTER (WHERE identities.provider = 'google')::bigint AS google,
    count(*) FILTER (WHERE identities.provider NOT IN ('email','google'))::bigint AS other
  FROM auth.identities AS identities
  JOIN target_claim AS claims ON claims.bound_user_id = identities.user_id
),
subject_profile_rows AS (
  SELECT profiles.*
  FROM public.user_profiles AS profiles
  JOIN target_claim AS claims ON claims.bound_user_id = profiles.user_id
),
subject_profile_count AS (
  SELECT count(*)::bigint AS total FROM subject_profile_rows
),
subject_method_counts AS (
  SELECT count(*)::bigint AS total,
    count(*) FILTER (WHERE methods.method = 'password')::bigint AS password,
    count(*) FILTER (WHERE methods.method = 'google')::bigint AS google
  FROM public.account_sign_in_methods AS methods
  JOIN target_claim AS claims ON claims.bound_user_id = methods.owner_user_id
),
subject_quota_counts AS (
  SELECT count(*) FILTER (
    WHERE grants.superseded_at IS NULL
      AND grants.period_start <= now()
      AND grants.period_end > now()
  )::bigint AS current
  FROM public.quota_grants AS grants
  JOIN target_claim AS claims ON claims.bound_user_id = grants.owner_user_id
),
account_contract AS (
  SELECT
    invitation_counts.total = 1 AS ordinary_invitation_unique,
    invitation_counts.total = 1
      AND claim_counts.total = 1
      AND flow_counts.total = 1
      AND auth_counts.total = 1
      AND profile_counts.total = 1
      AND identities.total = 1
      AND identities.email = 1
      AND identities.google = 0
      AND identities.other = 0
      AND methods.total = 1
      AND methods.password = 1
      AND methods.google = 0
      AND quotas.current = 1
      AND EXISTS (
        SELECT 1
        FROM target_invitation AS invitation
        WHERE invitation.consumed_at IS NOT NULL
          AND invitation.revoked_at IS NULL
      )
      AND EXISTS (
        SELECT 1
        FROM target_claim AS claim
        WHERE claim.bound_user_id IS NOT NULL
          AND claim.bound_email IS NOT NULL
          AND claim.finalized_user_id IS NOT DISTINCT FROM claim.bound_user_id
      )
      AND EXISTS (
        SELECT 1
        FROM target_flow AS flow
        WHERE flow.consumed_at IS NOT NULL
      )
      AND EXISTS (
        SELECT 1
        FROM subject_auth_users AS users
        JOIN target_claim AS claim ON claim.bound_user_id = users.id
        WHERE users.email_confirmed_at IS NOT NULL
          AND users.email IS NOT NULL
          AND users.email = lower(users.email)
          AND claim.bound_email = users.email
      )
      AND EXISTS (
        SELECT 1
        FROM subject_profile_rows AS profile
        JOIN target_claim AS claim ON claim.bound_user_id = profile.user_id
        WHERE profile.owner_user_id = profile.user_id
          AND profile.status = 'active'
          AND profile.email = claim.bound_email
      ) AS subject_account_exact
  FROM ordinary_invitation_count AS invitation_counts
  CROSS JOIN target_claim_count AS claim_counts
  CROSS JOIN target_flow_count AS flow_counts
  CROSS JOIN subject_auth_user_count AS auth_counts
  CROSS JOIN subject_profile_count AS profile_counts
  CROSS JOIN subject_identity_counts AS identities
  CROSS JOIN subject_method_counts AS methods
  CROSS JOIN subject_quota_counts AS quotas
),
subject AS (
  SELECT claim.bound_user_id AS user_id
  FROM target_claim AS claim
  CROSS JOIN account_contract AS contract
  WHERE contract.subject_account_exact
),
session_rows AS (
  SELECT sessions.*,
    sessions.owner_user_id = (SELECT user_id FROM subject) AS is_subject,
    EXISTS (
      SELECT 1
      FROM public.admin_roles AS roles
      WHERE roles.user_id = sessions.owner_user_id AND roles.role = 'operator'
    ) AS is_operator,
    CASE
      WHEN sessions.user_id IS DISTINCT FROM sessions.owner_user_id THEN 'invalid-owner'
      WHEN sessions.revoked_at IS NOT NULL THEN 'revoked'
      WHEN sessions.expires_at <= now() THEN 'expired'
      WHEN sessions.access_scope = 'full' THEN 'active-full'
      ELSE 'active-nonfull'
    END AS session_state
  FROM public.web_sessions AS sessions
),
session_counts AS (
  SELECT
    count(*)::bigint AS total,
    count(*) FILTER (
      WHERE session_state IN ('active-full','active-nonfull')
    )::bigint AS active,
    count(*) FILTER (WHERE is_subject)::bigint AS subject_total,
    count(*) FILTER (
      WHERE is_subject AND session_state IN ('active-full','active-nonfull')
    )::bigint AS subject_active,
    count(*) FILTER (WHERE is_subject AND session_state = 'active-full')::bigint
      AS subject_active_full,
    count(*) FILTER (WHERE is_subject AND session_state = 'active-nonfull')::bigint
      AS subject_active_nonfull,
    count(*) FILTER (WHERE is_subject AND session_state = 'revoked')::bigint
      AS subject_revoked,
    count(*) FILTER (WHERE is_subject AND session_state = 'expired')::bigint
      AS subject_expired,
    count(*) FILTER (
      WHERE is_subject IS FALSE AND session_state IN ('active-full','active-nonfull')
    )::bigint AS other_active,
    count(*) FILTER (
      WHERE is_subject IS FALSE
        AND is_operator
        AND session_state IN ('active-full','active-nonfull')
    )::bigint AS other_active_operator,
    count(*) FILTER (
      WHERE is_subject IS FALSE
        AND NOT is_operator
        AND session_state IN ('active-full','active-nonfull')
    )::bigint AS other_active_non_operator
  FROM session_rows
),
latest_subject_session AS (
  SELECT session_state
  FROM session_rows
  WHERE is_subject
  ORDER BY created_at DESC,id DESC
  LIMIT 1
),
session_contract AS (
  SELECT
    NOT EXISTS (
      SELECT 1 FROM session_rows
      WHERE user_id IS DISTINCT FROM owner_user_id
    ) AS owner_exact,
    counts.subject_total = counts.subject_active + counts.subject_revoked
      + counts.subject_expired AS subject_partition_exact,
    counts.active = counts.subject_active + counts.other_active
      AND counts.subject_active = counts.subject_active_full + counts.subject_active_nonfull
      AND counts.other_active = counts.other_active_operator
        + counts.other_active_non_operator AS active_partition_exact
  FROM session_counts AS counts
),
diagnostic_state AS (
  SELECT CASE
    WHEN NOT migration.migration_0023_applied
      OR NOT account.ordinary_invitation_unique
      OR NOT account.subject_account_exact THEN 'target-inconsistent'
    WHEN NOT contract.owner_exact
      OR NOT contract.subject_partition_exact
      OR NOT contract.active_partition_exact THEN 'session-contract-drift'
    WHEN counts.subject_active > 1 THEN 'subject-multiple-active'
    WHEN counts.subject_active = 1 AND counts.subject_active_nonfull > 0
      THEN 'subject-nonfull-active'
    WHEN counts.subject_active = 1 AND counts.other_active > 0
      THEN 'subject-and-other-active'
    WHEN counts.subject_active = 1 THEN 'subject-active'
    WHEN counts.other_active > 0 THEN 'other-active-only'
    ELSE 'no-active-session'
  END AS verdict
  FROM migration_state AS migration
  CROSS JOIN account_contract AS account
  CROSS JOIN session_counts AS counts
  CROSS JOIN session_contract AS contract
),
diagnostic_rows(ordinal,field_name,field_value) AS (
  VALUES
    (1,'migration_0023_applied',(SELECT CASE WHEN migration_0023_applied THEN 't' ELSE 'f' END
      FROM migration_state)),
    (2,'ordinary_invitation_unique',(SELECT CASE WHEN ordinary_invitation_unique THEN 't'
      ELSE 'f' END FROM account_contract)),
    (3,'subject_account_exact',(SELECT CASE WHEN subject_account_exact THEN 't' ELSE 'f' END
      FROM account_contract)),
    (4,'session_owner_contract_exact',(SELECT CASE WHEN owner_exact THEN 't' ELSE 'f' END
      FROM session_contract)),
    (5,'all_web_session_count',(SELECT total::text FROM session_counts)),
    (6,'all_active_web_session_count',(SELECT active::text FROM session_counts)),
    (7,'subject_web_session_count',(SELECT subject_total::text FROM session_counts)),
    (8,'subject_active_web_session_count',(SELECT subject_active::text FROM session_counts)),
    (9,'subject_active_full_session_count',(SELECT subject_active_full::text
      FROM session_counts)),
    (10,'subject_active_nonfull_session_count',(SELECT subject_active_nonfull::text
      FROM session_counts)),
    (11,'subject_revoked_web_session_count',(SELECT subject_revoked::text FROM session_counts)),
    (12,'subject_expired_web_session_count',(SELECT subject_expired::text FROM session_counts)),
    (13,'other_active_web_session_count',(SELECT other_active::text FROM session_counts)),
    (14,'other_active_operator_session_count',(SELECT other_active_operator::text
      FROM session_counts)),
    (15,'other_active_non_operator_session_count',(SELECT other_active_non_operator::text
      FROM session_counts)),
    (16,'subject_session_partition_exact',(SELECT CASE WHEN subject_partition_exact THEN 't'
      ELSE 'f' END FROM session_contract)),
    (17,'active_session_partition_exact',(SELECT CASE WHEN active_partition_exact THEN 't'
      ELSE 'f' END FROM session_contract)),
    (18,'subject_latest_session_state',COALESCE(
      (SELECT session_state FROM latest_subject_session),'none'
    )),
    (19,'diagnostic_verdict',(SELECT verdict FROM diagnostic_state))
)
SELECT field_name || '|' || field_value AS line
FROM diagnostic_rows
ORDER BY ordinal;
ROLLBACK;
`;
}
