BEGIN;

CREATE FUNCTION admin_recover_expired_invitation_token(
  actor_user_id uuid,
  target_invitation_id uuid,
  idempotency_key text,
  presented_request_hash text,
  new_token_hash text,
  operation_time timestamptz,
  response_expires_at timestamptz,
  audit_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  existing jsonb;
  result jsonb;
  invitation public.invitations%ROWTYPE;
  claimed public.invitation_claims%ROWTYPE;
  flow public.auth_flows%ROWTYPE;
  bound_email text;
BEGIN
  IF actor_user_id IS NULL
    OR target_invitation_id IS NULL
    OR idempotency_key IS NULL
    OR presented_request_hash IS NULL
    OR new_token_hash IS NULL
    OR operation_time IS NULL
    OR response_expires_at IS NULL
    OR audit_id IS NULL
    OR public.require_admin_operator(actor_user_id) IS DISTINCT FROM 'operator'
    OR char_length(idempotency_key) NOT BETWEEN 1 AND 128
    OR presented_request_hash !~ '^[0-9a-f]{64}$'
    OR new_token_hash !~ '^[A-Za-z0-9_-]{43}$'
    OR response_expires_at <= operation_time
    OR response_expires_at > operation_time + interval '7 days'
  THEN RAISE EXCEPTION 'administrator required'; END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    actor_user_id::text || ':admin.invitation-token-recover:' || idempotency_key, 4
  ));
  SELECT records.response INTO existing
  FROM public.idempotency_records AS records
  WHERE records.owner_user_id = actor_user_id
    AND records.operation = 'admin.invitation-token-recover'
    AND records.key = idempotency_key
    AND records.request_hash = presented_request_hash;
  IF FOUND THEN RETURN existing; END IF;
  IF EXISTS (
    SELECT 1 FROM public.idempotency_records AS records
    WHERE records.owner_user_id = actor_user_id
      AND records.operation = 'admin.invitation-token-recover'
      AND records.key = idempotency_key
  ) THEN RAISE EXCEPTION 'idempotency conflict'; END IF;

  SELECT * INTO invitation
  FROM public.invitations
  WHERE id = target_invitation_id
  FOR UPDATE;
  IF invitation.id IS NULL
    OR invitation.created_by_kind IS DISTINCT FROM 'operator'
    OR invitation.revoked_at IS NOT NULL
    OR invitation.consumed_at IS NOT NULL
    OR invitation.expires_at > operation_time
    OR invitation.token_hash !~ '^[A-Za-z0-9_-]{43}$'
    OR invitation.token_hash = new_token_hash
    OR EXISTS (SELECT 1 FROM public.invitations WHERE token_hash = new_token_hash)
    OR EXISTS (
      SELECT 1 FROM public.audit_events
      WHERE action = 'invitation.token-recovered' AND subject_id = invitation.id
    )
    OR (SELECT count(*) FROM public.invitation_claims
        WHERE invitation_id = invitation.id) <> 1
  THEN RAISE EXCEPTION 'invitation token recovery state changed'; END IF;

  SELECT * INTO claimed
  FROM public.invitation_claims
  WHERE invitation_id = invitation.id
  FOR UPDATE;
  IF claimed.ticket_hash IS NULL
    OR claimed.bound_user_id IS NULL
    OR claimed.bound_email IS NULL
    OR claimed.finalized_user_id IS NOT NULL
    OR claimed.expires_at > operation_time
    OR (SELECT count(*) FROM public.invitation_claims
        WHERE bound_user_id = claimed.bound_user_id) <> 1
    OR (SELECT count(*) FROM public.auth_flows
        WHERE ticket_hash = claimed.ticket_hash AND kind = 'invite-registration') <> 1
  THEN RAISE EXCEPTION 'invitation token recovery state changed'; END IF;

  SELECT * INTO flow
  FROM public.auth_flows
  WHERE ticket_hash = claimed.ticket_hash AND kind = 'invite-registration'
  FOR UPDATE;
  IF flow.flow_hash IS NULL
    OR flow.consumed_at IS NOT NULL
    OR flow.owner_user_id IS NOT NULL
    OR flow.expires_at > operation_time
  THEN RAISE EXCEPTION 'invitation token recovery state changed'; END IF;

  SELECT lower(users.email) INTO bound_email
  FROM auth.users AS users
  WHERE users.id = claimed.bound_user_id
    AND users.email IS NOT NULL
    AND users.email = lower(users.email)
    AND users.email_confirmed_at IS NULL
  FOR UPDATE;
  IF bound_email IS NULL
    OR claimed.bound_email IS DISTINCT FROM bound_email
    OR (SELECT count(*) FROM auth.users AS users
        WHERE lower(users.email) = bound_email) <> 1
    OR (SELECT count(*) FROM auth.identities AS identities
        WHERE identities.user_id = claimed.bound_user_id) <> 1
    OR NOT EXISTS (
      SELECT 1 FROM auth.identities AS identities
      WHERE identities.user_id = claimed.bound_user_id AND identities.provider = 'email'
    )
    OR EXISTS (SELECT 1 FROM public.user_profiles
        WHERE user_id = claimed.bound_user_id OR email = bound_email)
    OR EXISTS (SELECT 1 FROM public.account_sign_in_methods
        WHERE owner_user_id = claimed.bound_user_id)
    OR EXISTS (SELECT 1 FROM public.password_recovery_flows
        WHERE owner_user_id = claimed.bound_user_id)
    OR EXISTS (SELECT 1 FROM public.security_notification_outbox
        WHERE owner_user_id = claimed.bound_user_id)
    OR EXISTS (SELECT 1 FROM public.web_sessions
        WHERE owner_user_id = claimed.bound_user_id)
    OR EXISTS (SELECT 1 FROM public.account_data_export_jobs
        WHERE owner_user_id = claimed.bound_user_id)
    OR EXISTS (SELECT 1 FROM public.account_deletion_jobs
        WHERE subject_user_id = claimed.bound_user_id)
    OR EXISTS (SELECT 1 FROM public.extension_sessions
        WHERE owner_user_id = claimed.bound_user_id)
    OR EXISTS (SELECT 1 FROM public.extension_pairings
        WHERE owner_user_id = claimed.bound_user_id)
    OR EXISTS (SELECT 1 FROM public.admin_roles
        WHERE user_id = claimed.bound_user_id)
    OR EXISTS (SELECT 1 FROM public.audit_events AS events
        WHERE events.actor_user_id = claimed.bound_user_id
          OR events.subject_id = claimed.bound_user_id)
    OR EXISTS (SELECT 1 FROM public.study_captures
        WHERE owner_user_id = claimed.bound_user_id)
    OR EXISTS (SELECT 1 FROM public.analysis_records
        WHERE owner_user_id = claimed.bound_user_id)
    OR EXISTS (SELECT 1 FROM public.learning_items
        WHERE owner_user_id = claimed.bound_user_id)
    OR EXISTS (SELECT 1 FROM public.word_entries
        WHERE owner_user_id = claimed.bound_user_id)
    OR EXISTS (SELECT 1 FROM public.practice_sessions
        WHERE owner_user_id = claimed.bound_user_id)
    OR EXISTS (SELECT 1 FROM public.quota_grants
        WHERE owner_user_id = claimed.bound_user_id)
    OR EXISTS (SELECT 1 FROM public.quota_reservations
        WHERE owner_user_id = claimed.bound_user_id)
    OR EXISTS (SELECT 1 FROM public.usage_ledger
        WHERE owner_user_id = claimed.bound_user_id)
    OR EXISTS (SELECT 1 FROM public.model_rate_limit_events
        WHERE owner_user_id = claimed.bound_user_id)
  THEN RAISE EXCEPTION 'invitation token recovery state changed'; END IF;

  UPDATE public.invitations
  SET token_hash = new_token_hash
  WHERE id = invitation.id AND token_hash = invitation.token_hash;
  IF NOT FOUND THEN RAISE EXCEPTION 'invitation token recovery state changed'; END IF;

  result = jsonb_build_object('id', invitation.id::text, 'recovered', true);
  INSERT INTO public.audit_events(id,actor_user_id,action,subject_id,safe_details,created_at)
  VALUES(
    audit_id,actor_user_id,'invitation.token-recovered',invitation.id,'{}'::jsonb,operation_time
  );
  INSERT INTO public.idempotency_records(
    owner_user_id,operation,key,request_hash,response,expires_at,created_at
  ) VALUES(
    actor_user_id,'admin.invitation-token-recover',idempotency_key,presented_request_hash,
    result,response_expires_at,operation_time
  );
  RETURN result;
END;
$$;

ALTER FUNCTION admin_recover_expired_invitation_token(
  uuid,uuid,text,text,text,timestamptz,timestamptz,uuid
) OWNER TO postgres;
REVOKE ALL ON FUNCTION admin_recover_expired_invitation_token(
  uuid,uuid,text,text,text,timestamptz,timestamptz,uuid
) FROM PUBLIC,anon,authenticated,service_role,huayi_business,huayi_runtime;
GRANT EXECUTE ON FUNCTION admin_recover_expired_invitation_token(
  uuid,uuid,text,text,text,timestamptz,timestamptz,uuid
) TO huayi_context_setter;

COMMIT;
