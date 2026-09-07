BEGIN;

-- The API authenticates an independent browser proof inside this encrypted state.
-- Reading progress grants no application session and does not renew a claim.
CREATE FUNCTION read_password_signup_state(presented_flow_hash text)
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT flows.provider_state_ciphertext
  FROM public.auth_flows AS flows
  JOIN public.invitation_claims AS claims ON claims.ticket_hash = flows.ticket_hash
  JOIN public.invitations AS invitations ON invitations.id = claims.invitation_id
  WHERE flows.flow_hash = presented_flow_hash
    AND flows.kind = 'invite-registration'
    AND flows.consumed_at IS NULL
    AND claims.bound_user_id IS NOT NULL
    AND claims.finalized_user_id IS NULL
    AND claims.created_at + interval '1 day' > now()
    AND invitations.consumed_at IS NULL
    AND invitations.revoked_at IS NULL
    AND invitations.expires_at > now();
$$;

-- Keep the existing flow -> claim -> invitation lock order. A successful CAS
-- renews the short claim within the original invitation and 24-hour recovery cap.
CREATE FUNCTION compare_password_signup_state(
  presented_flow_hash text,
  expected_state text,
  next_state text
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  flow public.auth_flows;
  claimed public.invitation_claims;
  invitation public.invitations;
  deadline timestamptz;
BEGIN
  SELECT * INTO flow FROM public.auth_flows
  WHERE flow_hash = presented_flow_hash FOR UPDATE;
  IF flow.kind IS DISTINCT FROM 'invite-registration'
    OR flow.consumed_at IS NOT NULL
    OR flow.provider_state_ciphertext IS DISTINCT FROM expected_state
    OR expected_state IS NULL OR next_state IS NULL
  THEN RETURN NULL; END IF;
  SELECT * INTO claimed FROM public.invitation_claims
  WHERE ticket_hash = flow.ticket_hash FOR UPDATE;
  SELECT * INTO invitation FROM public.invitations
  WHERE id = claimed.invitation_id FOR UPDATE;
  IF claimed.bound_user_id IS NULL OR claimed.finalized_user_id IS NOT NULL
    OR claimed.created_at + interval '1 day' <= now()
    OR invitation.id IS NULL OR invitation.consumed_at IS NOT NULL
    OR invitation.revoked_at IS NOT NULL OR invitation.expires_at <= now()
  THEN RETURN NULL; END IF;
  deadline := LEAST(now() + interval '15 minutes', claimed.created_at + interval '1 day', invitation.expires_at);
  UPDATE public.invitation_claims SET expires_at = deadline
  WHERE ticket_hash = flow.ticket_hash;
  UPDATE public.auth_flows SET provider_state_ciphertext = next_state, expires_at = deadline
  WHERE flow_hash = presented_flow_hash;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION read_password_signup_state(text),compare_password_signup_state(text,text,text)
FROM PUBLIC,huayi_business,huayi_runtime;
GRANT EXECUTE ON FUNCTION read_password_signup_state(text),compare_password_signup_state(text,text,text)
TO huayi_context_setter;

COMMIT;
