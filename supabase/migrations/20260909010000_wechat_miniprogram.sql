-- WeChat identities are separate from the password/Google Web sign-in methods.
-- Existing account IDs and all learning-data owners remain unchanged.
ALTER TABLE public.user_profiles ALTER COLUMN email DROP NOT NULL;

CREATE TABLE public.wechat_identities (
  app_id text NOT NULL,
  subject_hash text NOT NULL,
  owner_user_id uuid NOT NULL REFERENCES public.user_profiles(user_id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (app_id,subject_hash),
  UNIQUE (app_id,owner_user_id)
);
CREATE TABLE public.wechat_onboarding (
  ticket_hash text PRIMARY KEY,
  binding_hash text NOT NULL UNIQUE,
  app_id text NOT NULL,
  subject_hash text NOT NULL,
  approved_owner_id uuid REFERENCES public.user_profiles(user_id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL DEFAULT now()+interval '10 minutes',
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.miniprogram_sessions (
  id uuid PRIMARY KEY,
  token_hash text NOT NULL UNIQUE,
  owner_user_id uuid NOT NULL REFERENCES public.user_profiles(user_id) ON DELETE CASCADE,
  app_id text NOT NULL,
  subject_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now()+interval '24 hours',
  reauthenticated_at timestamptz,
  revoked_at timestamptz,
  FOREIGN KEY (app_id,subject_hash) REFERENCES public.wechat_identities(app_id,subject_hash) ON DELETE CASCADE
);
CREATE INDEX miniprogram_sessions_owner ON public.miniprogram_sessions(owner_user_id);
ALTER TABLE public.wechat_identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wechat_identities FORCE ROW LEVEL SECURITY;
ALTER TABLE public.wechat_onboarding ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wechat_onboarding FORCE ROW LEVEL SECURITY;
ALTER TABLE public.miniprogram_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.miniprogram_sessions FORCE ROW LEVEL SECURITY;

CREATE FUNCTION public.begin_wechat_login(
  expected_app_id text, expected_subject_hash text, new_ticket_hash text,
  new_binding_hash text, new_session_id uuid, new_token_hash text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE account_id uuid; account_status text; expiry timestamptz;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(expected_app_id||':'||expected_subject_hash,29));
  SELECT identities.owner_user_id,profiles.status INTO account_id,account_status
    FROM public.wechat_identities identities
    JOIN public.user_profiles profiles ON profiles.user_id=identities.owner_user_id
    WHERE identities.app_id=expected_app_id AND identities.subject_hash=expected_subject_hash
    FOR UPDATE OF profiles;
  IF FOUND THEN
    IF account_status<>'active' THEN RETURN NULL; END IF;
    expiry:=now()+interval '24 hours';
    INSERT INTO public.miniprogram_sessions(id,token_hash,owner_user_id,app_id,subject_hash,expires_at)
      VALUES(new_session_id,new_token_hash,account_id,expected_app_id,expected_subject_hash,expiry);
    RETURN jsonb_build_object('state','authenticated','expiresAt',expiry);
  END IF;
  expiry:=now()+interval '10 minutes';
  INSERT INTO public.wechat_onboarding(ticket_hash,binding_hash,app_id,subject_hash,expires_at)
    VALUES(new_ticket_hash,new_binding_hash,expected_app_id,expected_subject_hash,expiry);
  RETURN jsonb_build_object('state','onboarding','expiresAt',expiry);
END;
$$;

CREATE FUNCTION public.complete_wechat_onboarding(
  presented_ticket_hash text, onboarding_mode text, new_user_id uuid,
  new_session_id uuid, new_token_hash text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE flow public.wechat_onboarding%ROWTYPE; account_id uuid; expiry timestamptz;
BEGIN
  SELECT * INTO flow FROM public.wechat_onboarding
    WHERE ticket_hash=presented_ticket_hash AND expires_at>now() AND consumed_at IS NULL FOR UPDATE;
  IF NOT FOUND OR onboarding_mode NOT IN ('independent','linked') THEN RETURN NULL; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(flow.app_id||':'||flow.subject_hash,29));
  IF EXISTS(SELECT 1 FROM public.wechat_identities WHERE app_id=flow.app_id AND subject_hash=flow.subject_hash)
    THEN RETURN NULL; END IF;
  IF onboarding_mode='independent' THEN
    IF flow.approved_owner_id IS NOT NULL THEN RETURN NULL; END IF;
    account_id:=new_user_id;
    INSERT INTO public.user_profiles(user_id,owner_user_id,email,status,timezone,daily_goal)
      VALUES(account_id,account_id,NULL,'active','Asia/Shanghai',5);
    PERFORM public.ensure_current_default_quota(account_id,now());
  ELSE
    account_id:=flow.approved_owner_id;
    PERFORM 1 FROM public.user_profiles WHERE user_id=account_id AND status='active' FOR UPDATE;
    IF NOT FOUND OR EXISTS(SELECT 1 FROM public.wechat_identities WHERE app_id=flow.app_id AND owner_user_id=account_id)
      THEN RETURN NULL; END IF;
  END IF;
  INSERT INTO public.wechat_identities(app_id,subject_hash,owner_user_id)
    VALUES(flow.app_id,flow.subject_hash,account_id);
  expiry:=now()+interval '24 hours';
  INSERT INTO public.miniprogram_sessions(id,token_hash,owner_user_id,app_id,subject_hash,expires_at)
    VALUES(new_session_id,new_token_hash,account_id,flow.app_id,flow.subject_hash,expiry);
  UPDATE public.wechat_onboarding SET consumed_at=now() WHERE ticket_hash=presented_ticket_hash;
  RETURN jsonb_build_object('state','authenticated','expiresAt',expiry);
END;
$$;

CREATE FUNCTION public.wechat_binding_status(presented_ticket_hash text)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT CASE WHEN approved_owner_id IS NULL THEN 'pending' ELSE 'approved' END
    FROM public.wechat_onboarding
    WHERE ticket_hash=presented_ticket_hash AND expires_at>now() AND consumed_at IS NULL;
$$;

CREATE FUNCTION public.approve_wechat_binding(
  presented_binding_hash text, presented_web_session_hash text, expected_owner_id uuid
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE flow public.wechat_onboarding%ROWTYPE;
BEGIN
  SELECT * INTO flow FROM public.wechat_onboarding
    WHERE binding_hash=presented_binding_hash AND expires_at>now() AND consumed_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(flow.app_id||':'||flow.subject_hash,29));
  PERFORM 1 FROM public.web_sessions sessions
    JOIN public.user_profiles profiles ON profiles.user_id=sessions.user_id
    WHERE sessions.session_hash=presented_web_session_hash AND sessions.user_id=expected_owner_id
      AND sessions.revoked_at IS NULL AND sessions.expires_at>now() AND sessions.access_scope='full'
      AND sessions.reauthenticated_method IN ('password','google')
      AND sessions.reauthenticated_at>=now()-interval '15 minutes' AND profiles.status='active'
    FOR UPDATE OF sessions,profiles;
  IF NOT FOUND OR (flow.approved_owner_id IS NOT NULL AND flow.approved_owner_id<>expected_owner_id)
    OR EXISTS(SELECT 1 FROM public.wechat_identities WHERE app_id=flow.app_id
      AND (subject_hash=flow.subject_hash OR owner_user_id=expected_owner_id)) THEN RETURN false; END IF;
  UPDATE public.wechat_onboarding SET approved_owner_id=expected_owner_id WHERE ticket_hash=flow.ticket_hash;
  RETURN true;
END;
$$;

CREATE FUNCTION public.authenticate_miniprogram_session(presented_token_hash text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT jsonb_build_object('userId',sessions.owner_user_id,'reauthenticatedAt',sessions.reauthenticated_at)
    FROM public.miniprogram_sessions sessions
    JOIN public.user_profiles profiles ON profiles.user_id=sessions.owner_user_id
    JOIN public.wechat_identities identities ON identities.app_id=sessions.app_id
      AND identities.subject_hash=sessions.subject_hash AND identities.owner_user_id=sessions.owner_user_id
    WHERE sessions.token_hash=presented_token_hash AND sessions.revoked_at IS NULL
      AND sessions.expires_at>now() AND profiles.status='active';
$$;

CREATE FUNCTION public.reauthenticate_miniprogram_session(
  presented_token_hash text, expected_app_id text, expected_subject_hash text
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  UPDATE public.miniprogram_sessions sessions SET reauthenticated_at=now()
    FROM public.user_profiles profiles
    WHERE sessions.token_hash=presented_token_hash AND sessions.app_id=expected_app_id
      AND sessions.subject_hash=expected_subject_hash AND sessions.revoked_at IS NULL
      AND sessions.expires_at>now() AND profiles.user_id=sessions.owner_user_id AND profiles.status='active';
  RETURN FOUND;
END;
$$;

CREATE FUNCTION public.revoke_miniprogram_session(presented_token_hash text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
  UPDATE public.miniprogram_sessions SET revoked_at=now()
    WHERE token_hash=presented_token_hash AND revoked_at IS NULL;
$$;

-- Each real security event invalidates all mini-program sessions. Ordinary Web
-- logout and recent-auth session rotation deliberately do not trigger this.
CREATE FUNCTION huayi_private.revoke_miniprogram_on_security_event()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE account_id uuid;
BEGIN
  IF TG_TABLE_NAME='user_profiles' THEN
    IF NEW.status='active' THEN RETURN NEW; END IF;
    account_id:=NEW.user_id;
  ELSIF TG_TABLE_NAME='password_recovery_flows' THEN
    IF NEW.stage<>'completed' OR OLD.stage='completed' THEN RETURN NEW; END IF;
    account_id:=NEW.owner_user_id;
  ELSE
    IF TG_OP='DELETE' THEN account_id:=OLD.owner_user_id; ELSE account_id:=NEW.owner_user_id; END IF;
  END IF;
  UPDATE public.miniprogram_sessions SET revoked_at=now()
    WHERE owner_user_id=account_id AND revoked_at IS NULL;
  UPDATE public.wechat_onboarding SET consumed_at=now()
    WHERE approved_owner_id=account_id AND consumed_at IS NULL;
  IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$$;
CREATE TRIGGER miniprogram_profile_revocation AFTER UPDATE OF status ON public.user_profiles
  FOR EACH ROW EXECUTE FUNCTION huayi_private.revoke_miniprogram_on_security_event();
CREATE TRIGGER miniprogram_recovery_revocation AFTER UPDATE OF stage ON public.password_recovery_flows
  FOR EACH ROW EXECUTE FUNCTION huayi_private.revoke_miniprogram_on_security_event();
CREATE TRIGGER miniprogram_link_revocation AFTER INSERT OR UPDATE OR DELETE ON public.account_sign_in_methods
  FOR EACH ROW EXECUTE FUNCTION huayi_private.revoke_miniprogram_on_security_event();

ALTER TABLE public.account_deletion_jobs ADD COLUMN delete_auth_user boolean NOT NULL DEFAULT true;
CREATE FUNCTION huayi_private.capture_deletion_auth_identity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  NEW.delete_auth_user:=EXISTS(SELECT 1 FROM public.account_sign_in_methods
    WHERE owner_user_id=NEW.subject_user_id AND method IN ('password','google'));
  RETURN NEW;
END;
$$;
CREATE TRIGGER capture_deletion_auth_identity BEFORE INSERT ON public.account_deletion_jobs
  FOR EACH ROW EXECUTE FUNCTION huayi_private.capture_deletion_auth_identity();
CREATE FUNCTION public.miniprogram_deletion_auth_required(job_id uuid,presented_lease_hash text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT delete_auth_user FROM public.account_deletion_jobs WHERE id=job_id
    AND state='running' AND lease_token_hash=presented_lease_hash AND lease_expires_at>now();
$$;

CREATE FUNCTION public.prune_miniprogram_auth()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  DELETE FROM public.wechat_onboarding WHERE ticket_hash IN
    (SELECT ticket_hash FROM public.wechat_onboarding WHERE expires_at<=now() LIMIT 100);
  DELETE FROM public.miniprogram_sessions WHERE id IN
    (SELECT id FROM public.miniprogram_sessions WHERE expires_at<=now() OR revoked_at IS NOT NULL LIMIT 100);
END;
$$;

-- Do not inherit broad function grants from a hosted database's defaults.
DO $$
DECLARE signature text; role_name text;
BEGIN
  FOREACH signature IN ARRAY ARRAY[
    'public.begin_wechat_login(text,text,text,text,uuid,text)',
    'public.complete_wechat_onboarding(text,text,uuid,uuid,text)',
    'public.wechat_binding_status(text)',
    'public.approve_wechat_binding(text,text,uuid)',
    'public.authenticate_miniprogram_session(text)',
    'public.reauthenticate_miniprogram_session(text,text,text)',
    'public.revoke_miniprogram_session(text)',
    'public.miniprogram_deletion_auth_required(uuid,text)',
    'public.prune_miniprogram_auth()'
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
REVOKE ALL ON FUNCTION huayi_private.revoke_miniprogram_on_security_event() FROM PUBLIC,huayi_business,huayi_context_setter;
REVOKE ALL ON FUNCTION huayi_private.capture_deletion_auth_identity() FROM PUBLIC,huayi_business,huayi_context_setter;
REVOKE ALL ON public.wechat_identities,public.wechat_onboarding,public.miniprogram_sessions FROM PUBLIC,huayi_business,huayi_context_setter;

DO $$
DECLARE role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
      EXECUTE format('REVOKE ALL ON public.wechat_identities,public.wechat_onboarding,public.miniprogram_sessions FROM %I',role_name);
    END IF;
  END LOOP;
END;
$$;
