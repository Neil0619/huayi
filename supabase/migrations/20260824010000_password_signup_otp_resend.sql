BEGIN;

ALTER TABLE public.invitation_claims
ADD COLUMN bound_email text
CHECK (bound_email IS NULL OR bound_email = lower(bound_email));

DO $$
BEGIN
  IF to_regclass('auth.users') IS NOT NULL THEN
    UPDATE public.invitation_claims AS claims
    SET bound_email = lower(auth_user.email)
    FROM auth.users AS auth_user
    WHERE claims.bound_user_id = auth_user.id
      AND auth_user.email IS NOT NULL;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION bind_auth_identity(
  presented_ticket_hash text,
  account_user_id uuid
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  bound_user uuid;
  normalized_email text;
BEGIN
  SELECT lower(auth_user.email) INTO normalized_email
  FROM auth.users AS auth_user
  WHERE auth_user.id = account_user_id
    AND auth_user.email IS NOT NULL
  FOR UPDATE;
  IF normalized_email IS NULL THEN RETURN NULL; END IF;

  PERFORM 1
  FROM public.invitation_claims AS claims
  JOIN public.invitations AS invitations ON invitations.id = claims.invitation_id
  WHERE claims.ticket_hash = presented_ticket_hash
    AND claims.expires_at > now()
    AND claims.finalized_user_id IS NULL
    AND invitations.expires_at > now()
    AND invitations.revoked_at IS NULL
    AND invitations.consumed_at IS NULL
  FOR UPDATE OF claims, invitations;
  IF NOT FOUND THEN RETURN NULL; END IF;
  UPDATE public.invitation_claims AS claims
  SET bound_user_id = account_user_id,
      bound_email = normalized_email
  WHERE claims.ticket_hash = presented_ticket_hash
    AND (claims.bound_user_id IS NULL OR claims.bound_user_id = account_user_id)
    AND (claims.bound_email IS NULL OR claims.bound_email = normalized_email)
  RETURNING claims.bound_user_id INTO bound_user;
  RETURN bound_user;
END;
$$;

CREATE FUNCTION renew_interrupted_password_confirmation(
  invitation_token_hash text,
  new_flow_hash text,
  new_expires_at timestamptz
) RETURNS TABLE(account_email text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  invitation public.invitations%ROWTYPE;
  claimed public.invitation_claims%ROWTYPE;
  flow public.auth_flows%ROWTYPE;
  bound_email text;
BEGIN
  IF invitation_token_hash IS NULL
    OR new_flow_hash IS NULL
    OR new_expires_at IS NULL
    OR new_expires_at <= now()
    OR new_expires_at > now() + interval '15 minutes'
  THEN RETURN; END IF;

  SELECT * INTO invitation
  FROM public.invitations
  WHERE token_hash = invitation_token_hash
  FOR UPDATE;
  IF invitation.id IS NULL
    OR invitation.expires_at <= now()
    OR invitation.expires_at < new_expires_at
    OR invitation.revoked_at IS NOT NULL
    OR invitation.consumed_at IS NOT NULL
  THEN RETURN; END IF;

  IF (SELECT count(*) FROM public.invitation_claims
      WHERE invitation_id = invitation.id) <> 1
  THEN RETURN; END IF;
  SELECT * INTO claimed
  FROM public.invitation_claims
  WHERE invitation_id = invitation.id
  FOR UPDATE;
  IF claimed.ticket_hash IS NULL
    OR claimed.bound_user_id IS NULL
    OR claimed.finalized_user_id IS NOT NULL
  THEN RETURN; END IF;

  IF (SELECT count(*) FROM public.auth_flows
      WHERE ticket_hash = claimed.ticket_hash
        AND kind = 'invite-registration') <> 1
  THEN RETURN; END IF;
  SELECT * INTO flow
  FROM public.auth_flows
  WHERE ticket_hash = claimed.ticket_hash
    AND kind = 'invite-registration'
  FOR UPDATE;
  IF flow.flow_hash IS NULL
    OR flow.consumed_at IS NOT NULL
    OR flow.flow_hash = new_flow_hash
    OR EXISTS (
      SELECT 1 FROM public.auth_flows
      WHERE flow_hash = new_flow_hash
    )
  THEN RETURN; END IF;

  SELECT lower(auth_user.email) INTO bound_email
  FROM auth.users AS auth_user
  WHERE auth_user.id = claimed.bound_user_id
    AND auth_user.email IS NOT NULL
    AND auth_user.email = lower(auth_user.email)
    AND auth_user.email_confirmed_at IS NULL
  FOR UPDATE;
  IF bound_email IS NULL
    OR claimed.bound_email IS NULL
    OR claimed.bound_email IS DISTINCT FROM bound_email
    OR (SELECT count(*) FROM auth.identities
        WHERE user_id = claimed.bound_user_id) <> 1
    OR NOT EXISTS (
      SELECT 1 FROM auth.identities
      WHERE user_id = claimed.bound_user_id AND provider = 'email'
    )
    OR EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE user_id = claimed.bound_user_id OR email = bound_email
    )
    OR EXISTS (
      SELECT 1 FROM public.account_sign_in_methods
      WHERE owner_user_id = claimed.bound_user_id
    )
    OR EXISTS (
      SELECT 1 FROM public.quota_grants
      WHERE owner_user_id = claimed.bound_user_id
    )
    OR EXISTS (
      SELECT 1 FROM public.web_sessions
      WHERE owner_user_id = claimed.bound_user_id
    )
    OR EXISTS (
      SELECT 1 FROM public.extension_sessions
      WHERE owner_user_id = claimed.bound_user_id
    )
    OR EXISTS (
      SELECT 1 FROM public.admin_roles
      WHERE user_id = claimed.bound_user_id
    )
    OR EXISTS (
      SELECT 1 FROM public.account_deletion_jobs
      WHERE subject_user_id = claimed.bound_user_id
    )
    OR EXISTS (
      SELECT 1 FROM public.audit_events
      WHERE actor_user_id = claimed.bound_user_id
        OR subject_id = claimed.bound_user_id
    )
  THEN RETURN; END IF;

  UPDATE public.invitation_claims
  SET expires_at = new_expires_at
  WHERE ticket_hash = claimed.ticket_hash;
  UPDATE public.auth_flows
  SET flow_hash = new_flow_hash, expires_at = new_expires_at
  WHERE flow_hash = flow.flow_hash;
  RETURN QUERY SELECT bound_email;
END;
$$;

REVOKE ALL ON FUNCTION renew_interrupted_password_confirmation(
  text,text,timestamptz
) FROM PUBLIC,huayi_business,huayi_runtime;
GRANT EXECUTE ON FUNCTION renew_interrupted_password_confirmation(
  text,text,timestamptz
) TO huayi_context_setter;

COMMIT;
