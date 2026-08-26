export function renderHostedIdentitySnapshotSql() {
  return `BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
WITH
ordinary_invitations AS (
  SELECT invitations.*,
    CASE
      WHEN invitations.consumed_at IS NOT NULL AND invitations.revoked_at IS NOT NULL
        THEN 'invalid'
      WHEN invitations.revoked_at IS NOT NULL THEN 'revoked'
      WHEN invitations.consumed_at IS NOT NULL THEN 'consumed'
      WHEN invitations.expires_at > now() THEN 'available'
      ELSE 'expired'
    END AS lifecycle_state
  FROM public.invitations
  WHERE invitations.created_by_kind = 'operator'
),
invitation_counts AS (
  SELECT count(*)::bigint AS total,
    count(*) FILTER (WHERE lifecycle_state = 'available')::bigint AS available,
    count(*) FILTER (WHERE lifecycle_state = 'expired')::bigint AS expired,
    count(*) FILTER (WHERE lifecycle_state = 'consumed')::bigint AS consumed,
    count(*) FILTER (WHERE lifecycle_state = 'revoked')::bigint AS revoked,
    count(*) FILTER (WHERE lifecycle_state = 'invalid')::bigint AS invalid
  FROM ordinary_invitations
),
latest_invitation AS (
  SELECT invitations.*
  FROM ordinary_invitations AS invitations
  ORDER BY invitations.created_at DESC,invitations.id DESC
  LIMIT 1
),
latest_claim_rows AS (
  SELECT claims.*
  FROM public.invitation_claims AS claims
  JOIN latest_invitation AS invitations ON invitations.id = claims.invitation_id
),
latest_claim_count AS (
  SELECT count(*)::bigint AS total FROM latest_claim_rows
),
latest_claim AS (
  SELECT claims.*
  FROM latest_claim_rows AS claims
  ORDER BY claims.created_at DESC,claims.ticket_hash DESC
  LIMIT 1
),
claim_state AS (
  SELECT counts.total,
    CASE
      WHEN counts.total = 0 THEN 'none'
      WHEN counts.total <> 1 THEN 'invalid'
      WHEN claims.finalized_user_id IS NOT NULL
        AND claims.finalized_user_id IS NOT DISTINCT FROM claims.bound_user_id THEN 'finalized'
      WHEN claims.finalized_user_id IS NOT NULL THEN 'invalid'
      WHEN claims.bound_user_id IS NULL AND claims.expires_at > now() THEN 'unbound-active'
      WHEN claims.bound_user_id IS NULL THEN 'unbound-expired'
      WHEN claims.expires_at > now() THEN 'bound-active'
      ELSE 'bound-expired'
    END AS state
  FROM latest_claim_count AS counts
  LEFT JOIN latest_claim AS claims ON true
),
subject AS (
  SELECT claims.bound_user_id AS user_id,claims.bound_email
  FROM latest_claim AS claims
  CROSS JOIN latest_claim_count AS counts
  WHERE counts.total = 1
    AND claims.bound_user_id IS NOT NULL
    AND (
      claims.finalized_user_id IS NULL
      OR claims.finalized_user_id IS NOT DISTINCT FROM claims.bound_user_id
    )
),
latest_flow_rows AS (
  SELECT flows.*
  FROM public.auth_flows AS flows
  JOIN latest_claim AS claims ON claims.ticket_hash = flows.ticket_hash
  CROSS JOIN latest_claim_count AS counts
  WHERE counts.total = 1 AND flows.kind = 'invite-registration'
),
latest_flow_count AS (
  SELECT count(*)::bigint AS total FROM latest_flow_rows
),
latest_flow AS (
  SELECT flows.*
  FROM latest_flow_rows AS flows
  ORDER BY flows.created_at DESC,flows.flow_hash DESC
  LIMIT 1
),
flow_state AS (
  SELECT counts.total,
    CASE
      WHEN counts.total = 0 THEN 'none'
      WHEN counts.total <> 1 THEN 'invalid'
      WHEN flows.consumed_at IS NOT NULL THEN 'consumed'
      WHEN flows.expires_at > now() THEN 'active'
      ELSE 'expired'
    END AS state
  FROM latest_flow_count AS counts
  LEFT JOIN latest_flow AS flows ON true
),
subject_auth_users AS (
  SELECT users.*
  FROM auth.users AS users
  JOIN subject ON subject.user_id = users.id
),
auth_user_state AS (
  SELECT count(*)::bigint AS total,
    CASE
      WHEN count(*) = 0 THEN 'none'
      WHEN count(*) <> 1 OR bool_or(email IS NULL OR email <> lower(email)) THEN 'invalid'
      WHEN bool_or(email_confirmed_at IS NULL) THEN 'unconfirmed'
      ELSE 'confirmed'
    END AS state
  FROM subject_auth_users
),
email_binding AS (
  SELECT EXISTS (
    SELECT 1
    FROM subject
    JOIN subject_auth_users AS users ON users.id = subject.user_id
    WHERE subject.bound_email IS NOT NULL
      AND subject.bound_email = lower(users.email)
      AND users.email = lower(users.email)
  ) AS exact
),
identity_counts AS (
  SELECT count(identities.id)::bigint AS total,
    count(identities.id) FILTER (WHERE identities.provider = 'email')::bigint AS email,
    count(identities.id) FILTER (WHERE identities.provider = 'google')::bigint AS google,
    count(identities.id) FILTER (
      WHERE identities.provider NOT IN ('email','google')
    )::bigint AS other
  FROM subject
  LEFT JOIN auth.identities AS identities ON identities.user_id = subject.user_id
),
subject_profiles AS (
  SELECT profiles.*
  FROM public.user_profiles AS profiles
  JOIN subject ON subject.user_id = profiles.user_id
),
profile_state AS (
  SELECT count(*)::bigint AS total,
    CASE
      WHEN count(*) = 0 THEN 'none'
      WHEN count(*) <> 1 OR NOT bool_and(EXISTS (
        SELECT 1 FROM subject_auth_users AS users
        WHERE users.id = subject_profiles.user_id AND users.email = subject_profiles.email
      )) THEN 'invalid'
      ELSE min(status)
    END AS state
  FROM subject_profiles
),
method_counts AS (
  SELECT count(methods.method)::bigint AS total,
    count(methods.method) FILTER (WHERE methods.method = 'password')::bigint AS password,
    count(methods.method) FILTER (WHERE methods.method = 'google')::bigint AS google
  FROM subject
  LEFT JOIN public.account_sign_in_methods AS methods
    ON methods.owner_user_id = subject.user_id
),
quota_counts AS (
  SELECT count(grants.id) FILTER (
    WHERE grants.superseded_at IS NULL
      AND grants.period_start <= now()
      AND grants.period_end > now()
  )::bigint AS current
  FROM subject
  LEFT JOIN public.quota_grants AS grants ON grants.owner_user_id = subject.user_id
),
active_session_counts AS (
  SELECT
    (SELECT count(*) FROM public.web_sessions AS sessions
      JOIN subject ON subject.user_id = sessions.owner_user_id
      WHERE sessions.revoked_at IS NULL AND sessions.expires_at > now())::bigint AS web,
    (SELECT count(*) FROM public.extension_sessions AS sessions
      JOIN subject ON subject.user_id = sessions.owner_user_id
      WHERE sessions.revoked_at IS NULL AND sessions.expires_at > now())::bigint AS extension
),
learning_counts AS (
  SELECT
    (SELECT count(*) FROM public.learning_items AS items
      JOIN subject ON subject.user_id = items.owner_user_id)::bigint AS items,
    (SELECT count(*) FROM public.analysis_records AS records
      JOIN subject ON subject.user_id = records.owner_user_id)::bigint AS analyses,
    (SELECT count(*) FROM public.practice_sessions AS sessions
      JOIN subject ON subject.user_id = sessions.owner_user_id)::bigint AS practices
),
registration_blockers AS (
  SELECT (
    (SELECT count(*) FROM public.user_profiles AS rows
      JOIN subject ON subject.user_id = rows.user_id)
    + (SELECT count(*) FROM public.account_sign_in_methods AS rows
      JOIN subject ON subject.user_id = rows.owner_user_id)
    + (SELECT count(*) FROM public.quota_grants AS rows
      JOIN subject ON subject.user_id = rows.owner_user_id)
    + (SELECT count(*) FROM public.web_sessions AS rows
      JOIN subject ON subject.user_id = rows.owner_user_id)
    + (SELECT count(*) FROM public.extension_sessions AS rows
      JOIN subject ON subject.user_id = rows.owner_user_id)
    + (SELECT count(*) FROM public.admin_roles AS rows
      JOIN subject ON subject.user_id = rows.user_id)
    + (SELECT count(*) FROM public.account_deletion_jobs AS rows
      JOIN subject ON subject.user_id = rows.subject_user_id)
    + (SELECT count(*) FROM public.audit_events AS rows
      JOIN subject ON subject.user_id = rows.actor_user_id OR subject.user_id = rows.subject_id)
  )::bigint AS total
),
eligibility AS (
  SELECT
    EXISTS (
      SELECT 1
      FROM latest_invitation AS invitations
      JOIN latest_claim AS claims ON true
      JOIN latest_flow AS flows ON flows.ticket_hash = claims.ticket_hash
      JOIN claim_state AS claim_shape ON claim_shape.total = 1
      JOIN flow_state AS flow_shape ON flow_shape.total = 1
      CROSS JOIN auth_user_state AS auth_state
      CROSS JOIN email_binding
      CROSS JOIN identity_counts AS identities
      CROSS JOIN registration_blockers AS blockers
      WHERE invitations.lifecycle_state = 'available'
        AND invitations.expires_at >= now() + interval '15 minutes'
        AND claims.bound_user_id IS NOT NULL
        AND claims.finalized_user_id IS NULL
        AND flows.consumed_at IS NULL
        AND auth_state.state = 'unconfirmed'
        AND email_binding.exact
        AND identities.total = 1 AND identities.email = 1
        AND blockers.total = 0
    ) AS otp_resend,
    EXISTS (
      SELECT 1
      FROM latest_invitation AS invitations
      JOIN latest_claim AS claims ON true
      JOIN latest_flow AS flows ON flows.ticket_hash = claims.ticket_hash
      JOIN claim_state AS claim_shape ON claim_shape.total = 1
      JOIN flow_state AS flow_shape ON flow_shape.total = 1
      CROSS JOIN auth_user_state AS auth_state
      CROSS JOIN identity_counts AS identities
      CROSS JOIN registration_blockers AS blockers
      WHERE invitations.lifecycle_state = 'available'
        AND claims.bound_user_id IS NOT NULL
        AND claims.finalized_user_id IS NULL
        AND claims.expires_at <= now()
        AND flows.expires_at <= now() AND flows.consumed_at IS NULL
        AND auth_state.state = 'confirmed'
        AND identities.total = 1 AND identities.email = 1
        AND blockers.total = 0
    ) AS interrupted_resume
),
account_state AS (
  SELECT EXISTS (
    SELECT 1
    FROM latest_invitation AS invitations
    JOIN latest_claim AS claims ON true
    JOIN latest_flow AS flows ON flows.ticket_hash = claims.ticket_hash
    JOIN claim_state AS claim_shape ON claim_shape.total = 1
    JOIN flow_state AS flow_shape ON flow_shape.total = 1
    CROSS JOIN auth_user_state AS auth_state
    CROSS JOIN email_binding
    CROSS JOIN identity_counts AS identities
    CROSS JOIN profile_state AS profile
    CROSS JOIN method_counts AS methods
    CROSS JOIN quota_counts AS quotas
    WHERE invitations.lifecycle_state = 'consumed'
      AND claims.bound_user_id IS NOT NULL
      AND claims.finalized_user_id IS NOT DISTINCT FROM claims.bound_user_id
      AND flows.consumed_at IS NOT NULL
      AND auth_state.state = 'confirmed'
      AND email_binding.exact
      AND identities.total BETWEEN 1 AND 2
      AND identities.email = 1 AND identities.google <= 1 AND identities.other = 0
      AND profile.state = 'active'
      AND methods.total BETWEEN 1 AND 2
      AND methods.password = 1 AND methods.google = identities.google
      AND quotas.current = 1
  ) AS finalized_exact
),
route_state AS (
  SELECT CASE
    WHEN NOT EXISTS (SELECT 1 FROM latest_invitation) THEN 'no-invitation'
    WHEN account_state.finalized_exact THEN 'account-established'
    WHEN eligibility.otp_resend THEN 'otp-resend'
    WHEN eligibility.interrupted_resume THEN 'resume-registration'
    WHEN (SELECT lifecycle_state FROM latest_invitation) = 'available'
      AND (SELECT total FROM latest_claim_count) = 0 THEN 'use-existing-link'
    WHEN (SELECT lifecycle_state FROM latest_invitation) IN ('expired','revoked')
      THEN 'replacement-review'
    ELSE 'stop-inconsistent'
  END AS state
  FROM eligibility CROSS JOIN account_state
),
snapshot_rows(ordinal,field_name,field_value) AS (
  VALUES
    (1,'ordinary_invitations_total',(SELECT total::text FROM invitation_counts)),
    (2,'ordinary_available_count',(SELECT available::text FROM invitation_counts)),
    (3,'ordinary_expired_count',(SELECT expired::text FROM invitation_counts)),
    (4,'ordinary_consumed_count',(SELECT consumed::text FROM invitation_counts)),
    (5,'ordinary_revoked_count',(SELECT revoked::text FROM invitation_counts)),
    (6,'ordinary_invalid_count',(SELECT invalid::text FROM invitation_counts)),
    (7,'latest_invitation_state',COALESCE(
      (SELECT lifecycle_state FROM latest_invitation),'none'
    )),
    (8,'latest_claim_count',(SELECT total::text FROM latest_claim_count)),
    (9,'latest_claim_state',(SELECT state FROM claim_state)),
    (10,'latest_registration_flow_count',(SELECT total::text FROM latest_flow_count)),
    (11,'latest_registration_flow_state',(SELECT state FROM flow_state)),
    (12,'subject_auth_user_state',(SELECT state FROM auth_user_state)),
    (13,'subject_email_binding_exact',
      (SELECT CASE WHEN exact THEN 't' ELSE 'f' END FROM email_binding)),
    (14,'subject_auth_identity_count',(SELECT total::text FROM identity_counts)),
    (15,'subject_email_identity_exact',(SELECT CASE WHEN email = 1
      THEN 't' ELSE 'f' END FROM identity_counts)),
    (16,'subject_profile_state',(SELECT state FROM profile_state)),
    (17,'subject_password_method_count',(SELECT password::text FROM method_counts)),
    (18,'subject_google_method_count',(SELECT google::text FROM method_counts)),
    (19,'subject_current_quota_count',(SELECT current::text FROM quota_counts)),
    (20,'subject_active_web_session_count',(SELECT web::text FROM active_session_counts)),
    (21,'subject_active_extension_session_count',
      (SELECT extension::text FROM active_session_counts)),
    (22,'subject_learning_item_count',(SELECT items::text FROM learning_counts)),
    (23,'subject_analysis_record_count',(SELECT analyses::text FROM learning_counts)),
    (24,'subject_practice_session_count',(SELECT practices::text FROM learning_counts)),
    (25,'subject_registration_blocker_count',
      (SELECT total::text FROM registration_blockers)),
    (26,'subject_learning_data_present',(SELECT CASE WHEN items + analyses + practices > 0
      THEN 't' ELSE 'f' END FROM learning_counts)),
    (27,'otp_resend_eligible',(SELECT CASE WHEN otp_resend
      THEN 't' ELSE 'f' END FROM eligibility)),
    (28,'interrupted_resume_eligible',(SELECT CASE WHEN interrupted_resume
      THEN 't' ELSE 'f' END FROM eligibility)),
    (29,'account_finalized_exact',(SELECT CASE WHEN finalized_exact
      THEN 't' ELSE 'f' END FROM account_state)),
    (30,'safe_route_state',(SELECT state FROM route_state))
)
SELECT field_name || '|' || field_value AS line
FROM snapshot_rows
ORDER BY ordinal;
ROLLBACK;
`;
}
