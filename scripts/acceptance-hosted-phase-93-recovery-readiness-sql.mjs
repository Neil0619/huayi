export function renderHostedPhase93RecoveryReadinessSql() {
  return `BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
WITH
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
bound_user_claim_count AS (
  SELECT count(*)::bigint AS total
  FROM public.invitation_claims AS claims
  JOIN target_claim AS target ON target.bound_user_id = claims.bound_user_id
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
target_auth_users AS (
  SELECT users.*
  FROM auth.users AS users
  JOIN target_claim AS claims ON claims.bound_user_id = users.id
),
target_auth_user_count AS (
  SELECT count(*)::bigint AS total FROM target_auth_users
),
target_auth_user AS (
  SELECT users.*
  FROM target_auth_users AS users
  CROSS JOIN target_auth_user_count AS counts
  WHERE counts.total = 1
),
auth_email_count AS (
  SELECT count(*)::bigint AS total
  FROM auth.users AS users
  JOIN target_claim AS claims ON lower(users.email) = claims.bound_email
),
auth_identity_counts AS (
  SELECT count(*)::bigint AS total,
    count(*) FILTER (WHERE identities.provider = 'email')::bigint AS email
  FROM auth.identities AS identities
  JOIN target_claim AS claims ON claims.bound_user_id = identities.user_id
),
subject_counts AS (
  SELECT
    (SELECT count(*) FROM public.user_profiles AS rows
      JOIN target_claim AS claims
        ON rows.user_id = claims.bound_user_id OR rows.email = claims.bound_email)::bigint
      AS user_profiles,
    (SELECT count(*) FROM public.account_sign_in_methods AS rows
      JOIN target_claim AS claims ON claims.bound_user_id = rows.owner_user_id)::bigint
      AS account_sign_in_methods,
    (SELECT count(*) FROM public.password_recovery_flows AS rows
      JOIN target_claim AS claims ON claims.bound_user_id = rows.owner_user_id)::bigint
      AS password_recovery_flows,
    (SELECT count(*) FROM public.security_notification_outbox AS rows
      JOIN target_claim AS claims ON claims.bound_user_id = rows.owner_user_id)::bigint
      AS security_notification_outbox,
    (SELECT count(*) FROM public.web_sessions AS rows
      JOIN target_claim AS claims ON claims.bound_user_id = rows.owner_user_id)::bigint
      AS web_sessions,
    (SELECT count(*) FROM public.account_data_export_jobs AS rows
      JOIN target_claim AS claims ON claims.bound_user_id = rows.owner_user_id)::bigint
      AS account_data_export_jobs,
    (SELECT count(*) FROM public.account_deletion_jobs AS rows
      JOIN target_claim AS claims ON claims.bound_user_id = rows.subject_user_id)::bigint
      AS account_deletion_jobs,
    (SELECT count(*) FROM public.extension_sessions AS rows
      JOIN target_claim AS claims ON claims.bound_user_id = rows.owner_user_id)::bigint
      AS extension_sessions,
    (SELECT count(*) FROM public.extension_pairings AS rows
      JOIN target_claim AS claims ON claims.bound_user_id = rows.owner_user_id)::bigint
      AS extension_pairings,
    (SELECT count(*) FROM public.admin_roles AS rows
      JOIN target_claim AS claims ON claims.bound_user_id = rows.user_id)::bigint AS admin_roles,
    (SELECT count(*) FROM public.audit_events AS rows
      JOIN target_claim AS claims
        ON claims.bound_user_id = rows.actor_user_id OR claims.bound_user_id = rows.subject_id)::bigint
      AS subject_audit_events,
    (SELECT count(*) FROM public.study_captures AS rows
      JOIN target_claim AS claims ON claims.bound_user_id = rows.owner_user_id)::bigint
      AS study_captures,
    (SELECT count(*) FROM public.analysis_records AS rows
      JOIN target_claim AS claims ON claims.bound_user_id = rows.owner_user_id)::bigint
      AS analysis_records,
    (SELECT count(*) FROM public.learning_items AS rows
      JOIN target_claim AS claims ON claims.bound_user_id = rows.owner_user_id)::bigint
      AS learning_items,
    (SELECT count(*) FROM public.word_entries AS rows
      JOIN target_claim AS claims ON claims.bound_user_id = rows.owner_user_id)::bigint
      AS word_entries,
    (SELECT count(*) FROM public.practice_sessions AS rows
      JOIN target_claim AS claims ON claims.bound_user_id = rows.owner_user_id)::bigint
      AS practice_sessions,
    (SELECT count(*) FROM public.quota_grants AS rows
      JOIN target_claim AS claims ON claims.bound_user_id = rows.owner_user_id)::bigint
      AS quota_grants,
    (SELECT count(*) FROM public.quota_reservations AS rows
      JOIN target_claim AS claims ON claims.bound_user_id = rows.owner_user_id)::bigint
      AS quota_reservations,
    (SELECT count(*) FROM public.usage_ledger AS rows
      JOIN target_claim AS claims ON claims.bound_user_id = rows.owner_user_id)::bigint
      AS usage_ledger,
    (SELECT count(*) FROM public.model_rate_limit_events AS rows
      JOIN target_claim AS claims ON claims.bound_user_id = rows.owner_user_id)::bigint
      AS model_rate_limit_events
),
predicates AS (
  SELECT
    invitation_counts.total = 1 AS ordinary_invitation_unique,
    EXISTS (
      SELECT 1 FROM target_invitation AS invitation
      WHERE invitation.created_by_kind = 'operator'
        AND public.require_admin_operator(invitation.created_by) = 'operator'
        AND invitation.revoked_at IS NULL
        AND invitation.consumed_at IS NULL
        AND invitation.expires_at <= now()
    ) AS invitation_contract_exact,
    EXISTS (
      SELECT 1 FROM target_invitation AS invitation
      WHERE invitation.token_hash ~ '^[A-Za-z0-9_-]{43}$'
    ) AS invitation_token_hash_valid,
    claim_counts.total = 1 AS invitation_claim_unique,
    EXISTS (
      SELECT 1 FROM target_claim AS claim
      WHERE claim.ticket_hash IS NOT NULL
        AND claim.bound_user_id IS NOT NULL
        AND claim.bound_email IS NOT NULL
        AND claim.finalized_user_id IS NULL
        AND claim.expires_at <= now()
    ) AS claim_contract_exact,
    bound_claims.total = 1 AS bound_user_claim_unique,
    flow_counts.total = 1 AS registration_flow_unique,
    EXISTS (
      SELECT 1 FROM target_flow AS flow
      WHERE flow.flow_hash IS NOT NULL
        AND flow.kind = 'invite-registration'
        AND flow.consumed_at IS NULL
        AND flow.owner_user_id IS NULL
        AND flow.expires_at <= now()
    ) AS registration_flow_contract_exact,
    auth_counts.total = 1 AS auth_user_unique,
    EXISTS (
      SELECT 1
      FROM target_auth_user AS users
      JOIN target_claim AS claims ON claims.bound_user_id = users.id
      WHERE users.email IS NOT NULL
        AND users.email = lower(users.email)
        AND users.email_confirmed_at IS NULL
        AND claims.bound_email = users.email
    ) AS auth_email_contract_exact,
    email_counts.total = 1 AS auth_email_unique,
    identities.total = 1 AND identities.email = 1 AS auth_identity_unique_email,
    NOT EXISTS (
      SELECT 1
      FROM public.audit_events AS events
      JOIN target_invitation AS invitation ON invitation.id = events.subject_id
      WHERE events.action = 'invitation.token-recovered'
    ) AS previous_recovery_audit_absent,
    subjects.user_profiles = 0 AS user_profiles_absent,
    subjects.account_sign_in_methods = 0 AS account_sign_in_methods_absent,
    subjects.password_recovery_flows = 0 AS password_recovery_flows_absent,
    subjects.security_notification_outbox = 0 AS security_notification_outbox_absent,
    subjects.web_sessions = 0 AS web_sessions_absent,
    subjects.account_data_export_jobs = 0 AS account_data_export_jobs_absent,
    subjects.account_deletion_jobs = 0 AS account_deletion_jobs_absent,
    subjects.extension_sessions = 0 AS extension_sessions_absent,
    subjects.extension_pairings = 0 AS extension_pairings_absent,
    subjects.admin_roles = 0 AS admin_roles_absent,
    subjects.subject_audit_events = 0 AS subject_audit_events_absent,
    subjects.study_captures = 0 AS study_captures_absent,
    subjects.analysis_records = 0 AS analysis_records_absent,
    subjects.learning_items = 0 AS learning_items_absent,
    subjects.word_entries = 0 AS word_entries_absent,
    subjects.practice_sessions = 0 AS practice_sessions_absent,
    subjects.quota_grants = 0 AS quota_grants_absent,
    subjects.quota_reservations = 0 AS quota_reservations_absent,
    subjects.usage_ledger = 0 AS usage_ledger_absent,
    subjects.model_rate_limit_events = 0 AS model_rate_limit_events_absent
  FROM ordinary_invitation_count AS invitation_counts
  CROSS JOIN target_claim_count AS claim_counts
  CROSS JOIN bound_user_claim_count AS bound_claims
  CROSS JOIN target_flow_count AS flow_counts
  CROSS JOIN target_auth_user_count AS auth_counts
  CROSS JOIN auth_email_count AS email_counts
  CROSS JOIN auth_identity_counts AS identities
  CROSS JOIN subject_counts AS subjects
),
contract AS (
  SELECT predicates.*,
    ordinary_invitation_unique
      AND invitation_contract_exact
      AND invitation_token_hash_valid
      AND invitation_claim_unique
      AND claim_contract_exact
      AND bound_user_claim_unique
      AND registration_flow_unique
      AND registration_flow_contract_exact
      AND auth_user_unique
      AND auth_email_contract_exact
      AND auth_email_unique
      AND auth_identity_unique_email
      AND previous_recovery_audit_absent
      AND user_profiles_absent
      AND account_sign_in_methods_absent
      AND password_recovery_flows_absent
      AND security_notification_outbox_absent
      AND web_sessions_absent
      AND account_data_export_jobs_absent
      AND account_deletion_jobs_absent
      AND extension_sessions_absent
      AND extension_pairings_absent
      AND admin_roles_absent
      AND subject_audit_events_absent
      AND study_captures_absent
      AND analysis_records_absent
      AND learning_items_absent
      AND word_entries_absent
      AND practice_sessions_absent
      AND quota_grants_absent
      AND quota_reservations_absent
      AND usage_ledger_absent
      AND model_rate_limit_events_absent AS mutation_preconditions_exact
  FROM predicates
),
readiness_rows(ordinal,field_name,field_value) AS (
  SELECT ordinal,field_name,CASE WHEN predicate THEN 't' ELSE 'f' END
  FROM contract
  CROSS JOIN LATERAL (VALUES
    (1,'ordinary_invitation_unique',ordinary_invitation_unique),
    (2,'invitation_contract_exact',invitation_contract_exact),
    (3,'invitation_token_hash_valid',invitation_token_hash_valid),
    (4,'invitation_claim_unique',invitation_claim_unique),
    (5,'claim_contract_exact',claim_contract_exact),
    (6,'bound_user_claim_unique',bound_user_claim_unique),
    (7,'registration_flow_unique',registration_flow_unique),
    (8,'registration_flow_contract_exact',registration_flow_contract_exact),
    (9,'auth_user_unique',auth_user_unique),
    (10,'auth_email_contract_exact',auth_email_contract_exact),
    (11,'auth_email_unique',auth_email_unique),
    (12,'auth_identity_unique_email',auth_identity_unique_email),
    (13,'previous_recovery_audit_absent',previous_recovery_audit_absent),
    (14,'user_profiles_absent',user_profiles_absent),
    (15,'account_sign_in_methods_absent',account_sign_in_methods_absent),
    (16,'password_recovery_flows_absent',password_recovery_flows_absent),
    (17,'security_notification_outbox_absent',security_notification_outbox_absent),
    (18,'web_sessions_absent',web_sessions_absent),
    (19,'account_data_export_jobs_absent',account_data_export_jobs_absent),
    (20,'account_deletion_jobs_absent',account_deletion_jobs_absent),
    (21,'extension_sessions_absent',extension_sessions_absent),
    (22,'extension_pairings_absent',extension_pairings_absent),
    (23,'admin_roles_absent',admin_roles_absent),
    (24,'subject_audit_events_absent',subject_audit_events_absent),
    (25,'study_captures_absent',study_captures_absent),
    (26,'analysis_records_absent',analysis_records_absent),
    (27,'learning_items_absent',learning_items_absent),
    (28,'word_entries_absent',word_entries_absent),
    (29,'practice_sessions_absent',practice_sessions_absent),
    (30,'quota_grants_absent',quota_grants_absent),
    (31,'quota_reservations_absent',quota_reservations_absent),
    (32,'usage_ledger_absent',usage_ledger_absent),
    (33,'model_rate_limit_events_absent',model_rate_limit_events_absent),
    (34,'mutation_preconditions_exact',mutation_preconditions_exact)
  ) AS rows(ordinal,field_name,predicate)
  UNION ALL
  SELECT 35,'eligible_verdict',
    CASE WHEN mutation_preconditions_exact THEN 'eligible' ELSE 'not-eligible' END
  FROM contract
)
SELECT field_name || '|' || field_value AS line
FROM readiness_rows
ORDER BY ordinal;
ROLLBACK;
`;
}
