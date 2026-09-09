-- A password login in the mini-program proves the existing Web account directly.
-- No new profile, Web session, quota grant or recent-auth privilege is created.
CREATE FUNCTION public.complete_wechat_password_binding(
  presented_ticket_hash text, authenticated_user_id uuid,
  new_session_id uuid, new_token_hash text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE flow public.wechat_onboarding%ROWTYPE; expiry timestamptz;
BEGIN
  SELECT * INTO flow FROM public.wechat_onboarding
    WHERE ticket_hash=presented_ticket_hash AND expires_at>clock_timestamp()
      AND consumed_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(flow.app_id||':'||flow.subject_hash,29));
  PERFORM 1 FROM public.user_profiles profiles
    JOIN public.account_sign_in_methods methods ON methods.owner_user_id=profiles.user_id
    WHERE profiles.user_id=authenticated_user_id AND profiles.status='active'
      AND methods.method='password' FOR UPDATE OF profiles,methods;
  IF NOT FOUND OR flow.expires_at<=clock_timestamp()
    OR (flow.approved_owner_id IS NOT NULL AND flow.approved_owner_id<>authenticated_user_id)
    OR EXISTS(SELECT 1 FROM public.wechat_identities WHERE app_id=flow.app_id
      AND (subject_hash=flow.subject_hash OR owner_user_id=authenticated_user_id))
    THEN RETURN NULL; END IF;
  INSERT INTO public.wechat_identities(app_id,subject_hash,owner_user_id)
    VALUES(flow.app_id,flow.subject_hash,authenticated_user_id);
  expiry:=clock_timestamp()+interval '24 hours';
  INSERT INTO public.miniprogram_sessions(id,token_hash,owner_user_id,app_id,subject_hash,expires_at)
    VALUES(new_session_id,new_token_hash,authenticated_user_id,flow.app_id,flow.subject_hash,expiry);
  UPDATE public.wechat_onboarding SET consumed_at=clock_timestamp() WHERE ticket_hash=presented_ticket_hash;
  RETURN jsonb_build_object('state','authenticated','expiresAt',expiry);
END;
$$;

-- Compatibility for existing clients: an active full Web login is sufficient.
-- Origin, CSRF and explicit confirmation remain enforced by the API.
CREATE OR REPLACE FUNCTION public.approve_wechat_binding(
  presented_binding_hash text, presented_web_session_hash text, expected_owner_id uuid
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE flow public.wechat_onboarding%ROWTYPE; web_expiry timestamptz;
BEGIN
  SELECT * INTO flow FROM public.wechat_onboarding
    WHERE binding_hash=presented_binding_hash AND expires_at>clock_timestamp()
      AND consumed_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(flow.app_id||':'||flow.subject_hash,29));
  SELECT sessions.expires_at INTO web_expiry FROM public.web_sessions sessions
    JOIN public.user_profiles profiles ON profiles.user_id=sessions.user_id
    WHERE sessions.session_hash=presented_web_session_hash AND sessions.user_id=expected_owner_id
      AND sessions.revoked_at IS NULL AND sessions.expires_at>clock_timestamp()
      AND sessions.access_scope='full' AND profiles.status='active'
    FOR UPDATE OF sessions,profiles;
  IF NOT FOUND OR web_expiry<=clock_timestamp() OR flow.expires_at<=clock_timestamp()
    OR (flow.approved_owner_id IS NOT NULL AND flow.approved_owner_id<>expected_owner_id)
    OR EXISTS(SELECT 1 FROM public.wechat_identities WHERE app_id=flow.app_id
      AND (subject_hash=flow.subject_hash OR owner_user_id=expected_owner_id)) THEN RETURN false; END IF;
  UPDATE public.wechat_onboarding SET approved_owner_id=expected_owner_id WHERE ticket_hash=flow.ticket_hash;
  RETURN true;
END;
$$;

-- Managed database defaults must not expose this authority through PostgREST.
DO $$
DECLARE signature text; role_name text;
BEGIN
  FOREACH signature IN ARRAY ARRAY[
    'public.complete_wechat_password_binding(text,uuid,uuid,text)',
    'public.approve_wechat_binding(text,text,uuid)'
  ] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,huayi_business',signature);
    FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
      IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I',signature,role_name);
      END IF;
    END LOOP;
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO huayi_context_setter',signature);
  END LOOP;
END;
$$;
