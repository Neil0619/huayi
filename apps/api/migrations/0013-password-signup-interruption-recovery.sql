BEGIN;

CREATE OR REPLACE FUNCTION claim_invitation(
  invitation_token_hash text,
  new_ticket_hash text,
  ticket_expires_at timestamptz
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE claimed_id uuid;
BEGIN
  SELECT id INTO claimed_id
  FROM public.invitations
  WHERE token_hash = invitation_token_hash
    AND expires_at > now()
    AND revoked_at IS NULL
    AND consumed_at IS NULL
  FOR UPDATE;
  IF claimed_id IS NULL THEN RETURN NULL; END IF;
  IF EXISTS (
    SELECT 1 FROM public.invitation_claims
    WHERE invitation_id = claimed_id
      AND finalized_user_id IS NULL
      AND (
        expires_at > now()
        OR bound_user_id IS NOT NULL
      )
  ) THEN RETURN NULL; END IF;
  DELETE FROM public.invitation_claims
  WHERE invitation_id = claimed_id
    AND finalized_user_id IS NULL
    AND bound_user_id IS NULL
    AND expires_at <= now();
  INSERT INTO public.invitation_claims (ticket_hash, invitation_id, expires_at)
  VALUES (new_ticket_hash, claimed_id, ticket_expires_at)
  ON CONFLICT (ticket_hash) DO NOTHING;
  RETURN claimed_id;
END;
$$;

CREATE FUNCTION resume_interrupted_password_registration(
  invitation_token_hash text,
  account_user_id uuid,
  account_email text,
  account_timezone text,
  account_daily_goal integer
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  invitation public.invitations%ROWTYPE;
  claimed public.invitation_claims%ROWTYPE;
  flow public.auth_flows%ROWTYPE;
BEGIN
  IF account_user_id IS NULL
    OR account_email IS NULL
    OR account_email <> lower(account_email)
    OR account_timezone IS NULL
    OR account_daily_goal NOT BETWEEN 1 AND 100
  THEN RETURN NULL; END IF;

  SELECT * INTO invitation
  FROM public.invitations
  WHERE token_hash = invitation_token_hash
  FOR UPDATE;
  IF invitation.id IS NULL
    OR invitation.expires_at <= now()
    OR invitation.revoked_at IS NOT NULL
    OR invitation.consumed_at IS NOT NULL
  THEN RETURN NULL; END IF;

  IF (SELECT count(*) FROM public.invitation_claims
      WHERE invitation_id = invitation.id) <> 1
  THEN RETURN NULL; END IF;
  SELECT * INTO claimed
  FROM public.invitation_claims
  WHERE invitation_id = invitation.id
  FOR UPDATE;
  IF claimed.ticket_hash IS NULL
    OR claimed.expires_at > now()
    OR claimed.finalized_user_id IS NOT NULL
    OR claimed.bound_user_id IS DISTINCT FROM account_user_id
  THEN RETURN NULL; END IF;

  IF (SELECT count(*) FROM public.auth_flows
      WHERE ticket_hash = claimed.ticket_hash
        AND kind = 'invite-registration') <> 1
  THEN RETURN NULL; END IF;
  SELECT * INTO flow
  FROM public.auth_flows
  WHERE ticket_hash = claimed.ticket_hash
    AND kind = 'invite-registration'
  FOR UPDATE;
  IF flow.flow_hash IS NULL
    OR flow.expires_at > now()
    OR flow.consumed_at IS NOT NULL
  THEN RETURN NULL; END IF;

  PERFORM 1
  FROM auth.users AS auth_user
  WHERE auth_user.id = account_user_id
    AND lower(auth_user.email) = account_email
    AND auth_user.email_confirmed_at IS NOT NULL
  FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF (SELECT count(*) FROM auth.identities
      WHERE user_id = account_user_id) <> 1
    OR NOT EXISTS (
      SELECT 1 FROM auth.identities
      WHERE user_id = account_user_id AND provider = 'email'
    )
    OR EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE user_id = account_user_id OR email = account_email
    )
    OR EXISTS (
      SELECT 1 FROM public.account_sign_in_methods WHERE owner_user_id = account_user_id
    )
    OR EXISTS (SELECT 1 FROM public.quota_grants WHERE owner_user_id = account_user_id)
    OR EXISTS (SELECT 1 FROM public.web_sessions WHERE owner_user_id = account_user_id)
    OR EXISTS (SELECT 1 FROM public.extension_sessions WHERE owner_user_id = account_user_id)
    OR EXISTS (SELECT 1 FROM public.admin_roles WHERE user_id = account_user_id)
    OR EXISTS (
      SELECT 1 FROM public.account_deletion_jobs WHERE subject_user_id = account_user_id
    )
    OR EXISTS (
      SELECT 1 FROM public.audit_events
      WHERE actor_user_id = account_user_id OR subject_id = account_user_id
    )
  THEN RETURN NULL; END IF;

  INSERT INTO public.user_profiles(
    user_id,owner_user_id,email,status,timezone,daily_goal
  ) VALUES(
    account_user_id,account_user_id,account_email,'active',account_timezone,account_daily_goal
  );
  INSERT INTO public.account_sign_in_methods(owner_user_id,method)
  VALUES(account_user_id,'password');
  PERFORM public.ensure_current_default_quota(account_user_id,now());
  UPDATE public.auth_flows
  SET consumed_at = now()
  WHERE flow_hash = flow.flow_hash;
  UPDATE public.invitation_claims
  SET finalized_user_id = account_user_id
  WHERE ticket_hash = claimed.ticket_hash;
  UPDATE public.invitations
  SET consumed_at = now()
  WHERE id = invitation.id;
  RETURN account_user_id;
END;
$$;

REVOKE ALL ON FUNCTION resume_interrupted_password_registration(
  text,uuid,text,text,integer
) FROM PUBLIC,huayi_business,huayi_runtime;
GRANT EXECUTE ON FUNCTION resume_interrupted_password_registration(
  text,uuid,text,text,integer
) TO huayi_context_setter;

COMMIT;
