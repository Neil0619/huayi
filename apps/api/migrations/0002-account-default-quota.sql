BEGIN;

CREATE OR REPLACE FUNCTION ensure_current_default_quota(
  account_user_id uuid,
  operation_time timestamptz
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  current_grant_id uuid;
  current_period_start timestamptz;
  current_period_end timestamptz;
BEGIN
  IF operation_time IS NULL THEN RAISE EXCEPTION 'invalid quota period'; END IF;
  PERFORM 1 FROM public.user_profiles
  WHERE user_id=account_user_id AND status<>'deleting'
  FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;

  current_period_start :=
    date_trunc('month',operation_time AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
  current_period_end := current_period_start + interval '1 month';

  INSERT INTO public.quota_grants(
    id,user_id,owner_user_id,period_start,period_end,limit_micro_usd,source
  ) VALUES(
    gen_random_uuid(),account_user_id,account_user_id,current_period_start,current_period_end,
    1000000,'default'
  )
  ON CONFLICT(user_id,period_start) WHERE superseded_at IS NULL DO NOTHING
  RETURNING id INTO current_grant_id;

  IF current_grant_id IS NULL THEN
    SELECT id INTO current_grant_id FROM public.quota_grants
    WHERE user_id=account_user_id AND period_start=current_period_start
      AND superseded_at IS NULL;
  END IF;
  RETURN current_grant_id;
END;
$$;

REVOKE ALL ON FUNCTION ensure_current_default_quota(uuid,timestamptz)
FROM PUBLIC,huayi_business,huayi_context_setter,huayi_runtime;

CREATE OR REPLACE FUNCTION complete_auth_flow(
  presented_flow_hash text,
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
  flow public.auth_flows%ROWTYPE;
  claimed public.invitation_claims%ROWTYPE;
  invitation public.invitations%ROWTYPE;
BEGIN
  SELECT * INTO flow FROM public.auth_flows
  WHERE flow_hash = presented_flow_hash
    AND consumed_at IS NULL
    AND expires_at > now()
  FOR UPDATE;
  IF flow.flow_hash IS NULL THEN RETURN NULL; END IF;
  IF flow.kind='login' THEN
    PERFORM 1 FROM public.user_profiles AS profiles
    JOIN public.account_sign_in_methods AS methods
      ON methods.owner_user_id=profiles.user_id AND methods.method='google'
    WHERE profiles.user_id=account_user_id AND profiles.status IN ('active','disabled')
    FOR UPDATE OF profiles;
    IF NOT FOUND THEN RETURN NULL; END IF;
    UPDATE public.user_profiles SET email=account_email,updated_at=now()
    WHERE user_id=account_user_id;
    UPDATE public.auth_flows SET consumed_at=now() WHERE flow_hash=presented_flow_hash;
    RETURN account_user_id;
  END IF;
  SELECT * INTO claimed FROM public.invitation_claims
  WHERE ticket_hash = flow.ticket_hash FOR UPDATE;
  SELECT * INTO invitation FROM public.invitations
  WHERE id = claimed.invitation_id FOR UPDATE;
  IF claimed.ticket_hash IS NULL OR claimed.expires_at <= now()
    OR invitation.id IS NULL OR invitation.expires_at <= now()
    OR invitation.revoked_at IS NOT NULL
    OR (invitation.consumed_at IS NOT NULL AND claimed.finalized_user_id IS NULL)
    OR (claimed.bound_user_id IS NOT NULL AND claimed.bound_user_id <> account_user_id)
    OR (claimed.finalized_user_id IS NOT NULL AND claimed.finalized_user_id <> account_user_id)
  THEN RETURN NULL; END IF;
  PERFORM 1 FROM public.user_profiles WHERE user_id=account_user_id FOR UPDATE;
  IF FOUND THEN RETURN NULL; END IF;
  INSERT INTO public.user_profiles(
    user_id,owner_user_id,email,status,timezone,daily_goal
  ) VALUES(
    account_user_id,account_user_id,account_email,'active',account_timezone,account_daily_goal
  );
  INSERT INTO public.account_sign_in_methods(owner_user_id,method)
  VALUES(account_user_id,'google');
  PERFORM public.ensure_current_default_quota(account_user_id,now());
  UPDATE public.auth_flows SET consumed_at=now()
  WHERE flow_hash=presented_flow_hash;
  UPDATE public.invitation_claims
  SET bound_user_id=account_user_id,finalized_user_id=account_user_id
  WHERE ticket_hash=flow.ticket_hash;
  UPDATE public.invitations SET consumed_at=now()
  WHERE id=claimed.invitation_id AND consumed_at IS NULL;
  RETURN account_user_id;
END;
$$;

CREATE OR REPLACE FUNCTION finalize_invitation(
  presented_ticket_hash text,
  account_user_id uuid,
  account_email text,
  account_timezone text,
  account_daily_goal integer,
  sign_in_method text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  claimed public.invitation_claims%ROWTYPE;
  invitation public.invitations%ROWTYPE;
BEGIN
  SELECT * INTO claimed FROM public.invitation_claims
  WHERE ticket_hash=presented_ticket_hash FOR UPDATE;
  SELECT * INTO invitation FROM public.invitations
  WHERE id=claimed.invitation_id FOR UPDATE;
  IF claimed.ticket_hash IS NULL OR claimed.expires_at <= now()
    OR invitation.id IS NULL OR invitation.expires_at <= now()
    OR invitation.revoked_at IS NOT NULL
    OR (invitation.consumed_at IS NOT NULL AND claimed.finalized_user_id IS NULL)
    OR claimed.bound_user_id IS DISTINCT FROM account_user_id
  THEN RETURN NULL; END IF;
  IF claimed.finalized_user_id IS NOT NULL THEN
    IF claimed.finalized_user_id=account_user_id AND EXISTS(
      SELECT 1 FROM public.account_sign_in_methods
      WHERE owner_user_id=account_user_id AND method=sign_in_method
    ) THEN RETURN account_user_id; END IF;
    RETURN NULL;
  END IF;
  IF sign_in_method NOT IN ('password','google') THEN RETURN NULL; END IF;
  PERFORM 1 FROM public.user_profiles WHERE user_id=account_user_id FOR UPDATE;
  IF FOUND THEN RETURN NULL; END IF;
  INSERT INTO public.user_profiles(
    user_id,owner_user_id,email,status,timezone,daily_goal
  ) VALUES(
    account_user_id,account_user_id,account_email,'active',account_timezone,account_daily_goal
  );
  INSERT INTO public.account_sign_in_methods(owner_user_id,method)
  VALUES(account_user_id,sign_in_method);
  PERFORM public.ensure_current_default_quota(account_user_id,now());
  UPDATE public.invitation_claims SET finalized_user_id=account_user_id
  WHERE ticket_hash=presented_ticket_hash;
  UPDATE public.invitations SET consumed_at=now()
  WHERE id=claimed.invitation_id AND consumed_at IS NULL;
  RETURN account_user_id;
END;
$$;

SELECT public.ensure_current_default_quota(profiles.user_id,now())
FROM public.user_profiles AS profiles
WHERE profiles.status<>'deleting';

COMMIT;
