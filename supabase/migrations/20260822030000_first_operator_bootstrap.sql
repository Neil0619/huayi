BEGIN;

ALTER TABLE public.invitations ALTER COLUMN created_by DROP NOT NULL;
ALTER TABLE public.invitations
  ADD COLUMN IF NOT EXISTS created_by_kind text NOT NULL DEFAULT 'operator';
DO $constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.invitations'::regclass
      AND conname = 'invitations_created_by_kind_check'
  ) THEN
    ALTER TABLE public.invitations ADD CONSTRAINT invitations_created_by_kind_check CHECK (
      (created_by_kind = 'operator' AND created_by IS NOT NULL)
      OR (created_by_kind = 'deployment-bootstrap' AND created_by IS NULL)
    );
  END IF;
END;
$constraint$;

CREATE TABLE IF NOT EXISTS huayi_private.first_operator_bootstrap (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  state text NOT NULL CHECK (state IN ('invited', 'completed')),
  current_invitation_id uuid NOT NULL REFERENCES public.invitations(id),
  revision integer NOT NULL CHECK (revision >= 1),
  issued_at timestamptz NOT NULL,
  completed_at timestamptz,
  operator_user_id uuid,
  operator_deleted_at timestamptz,
  CONSTRAINT first_operator_bootstrap_lifecycle_check CHECK (
    (state = 'invited' AND completed_at IS NULL AND operator_user_id IS NULL
      AND operator_deleted_at IS NULL)
    OR (
      state = 'completed' AND completed_at IS NOT NULL
      AND (
        (operator_user_id IS NOT NULL AND operator_deleted_at IS NULL)
        OR (operator_user_id IS NULL AND operator_deleted_at IS NOT NULL)
      )
    )
  )
);
ALTER TABLE huayi_private.first_operator_bootstrap
  ADD COLUMN IF NOT EXISTS operator_deleted_at timestamptz;
REVOKE ALL ON TABLE huayi_private.first_operator_bootstrap
  FROM PUBLIC, huayi_business, huayi_context_setter, huayi_runtime;

CREATE OR REPLACE FUNCTION huayi_private.clear_deleted_first_operator_identity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, huayi_private
AS $$
BEGIN
  UPDATE huayi_private.first_operator_bootstrap SET
    operator_user_id = NULL,
    operator_deleted_at = now()
  WHERE state = 'completed' AND operator_user_id = OLD.user_id;
  RETURN OLD;
END;
$$;
REVOKE ALL ON FUNCTION huayi_private.clear_deleted_first_operator_identity()
  FROM PUBLIC, huayi_business, huayi_context_setter, huayi_runtime;
DROP TRIGGER IF EXISTS user_profile_clear_first_operator_identity ON public.user_profiles;
CREATE TRIGGER user_profile_clear_first_operator_identity
BEFORE DELETE ON public.user_profiles
FOR EACH ROW EXECUTE FUNCTION huayi_private.clear_deleted_first_operator_identity();

CREATE OR REPLACE FUNCTION huayi_private.issue_first_operator_invitation(
  new_invitation_id uuid,
  new_token_hash text,
  new_expires_at timestamptz,
  operation_time timestamptz
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, huayi_private
AS $$
BEGIN
  IF new_invitation_id IS NULL
    OR new_token_hash !~ '^[A-Za-z0-9_-]{43}$'
    OR operation_time IS NULL
    OR new_expires_at IS DISTINCT FROM operation_time + interval '72 hours'
  THEN RAISE EXCEPTION 'invalid first operator invitation'; END IF;

  LOCK TABLE huayi_private.first_operator_bootstrap IN ACCESS EXCLUSIVE MODE;
  IF EXISTS (SELECT 1 FROM huayi_private.first_operator_bootstrap)
    OR EXISTS (SELECT 1 FROM auth.users)
    OR EXISTS (SELECT 1 FROM auth.identities)
    OR EXISTS (SELECT 1 FROM public.user_profiles)
    OR EXISTS (SELECT 1 FROM public.admin_roles)
    OR EXISTS (SELECT 1 FROM public.invitations)
    OR EXISTS (SELECT 1 FROM public.invitation_claims)
    OR EXISTS (SELECT 1 FROM public.audit_events)
  THEN RAISE EXCEPTION 'first operator bootstrap state is not pristine'; END IF;

  INSERT INTO public.invitations(
    id,token_hash,expires_at,created_by,created_by_kind,created_at
  ) VALUES (
    new_invitation_id,new_token_hash,new_expires_at,NULL,'deployment-bootstrap',operation_time
  );
  INSERT INTO huayi_private.first_operator_bootstrap(
    singleton,state,current_invitation_id,revision,issued_at
  ) VALUES (true,'invited',new_invitation_id,1,operation_time);
  RETURN new_invitation_id;
END;
$$;

CREATE OR REPLACE FUNCTION huayi_private.replace_first_operator_invitation(
  new_invitation_id uuid,
  new_token_hash text,
  new_expires_at timestamptz,
  operation_time timestamptz
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, huayi_private
AS $$
DECLARE
  bootstrap huayi_private.first_operator_bootstrap%ROWTYPE;
  current_invitation public.invitations%ROWTYPE;
BEGIN
  IF new_invitation_id IS NULL
    OR new_token_hash !~ '^[A-Za-z0-9_-]{43}$'
    OR operation_time IS NULL
    OR new_expires_at IS DISTINCT FROM operation_time + interval '72 hours'
  THEN RAISE EXCEPTION 'invalid first operator invitation'; END IF;

  LOCK TABLE huayi_private.first_operator_bootstrap IN ACCESS EXCLUSIVE MODE;
  SELECT * INTO bootstrap FROM huayi_private.first_operator_bootstrap
  WHERE singleton = true FOR UPDATE;
  IF bootstrap.state IS DISTINCT FROM 'invited'
  THEN RAISE EXCEPTION 'first operator bootstrap is not replaceable'; END IF;

  SELECT * INTO current_invitation FROM public.invitations
  WHERE id = bootstrap.current_invitation_id FOR UPDATE;
  IF current_invitation.id IS NULL
    OR current_invitation.created_by_kind IS DISTINCT FROM 'deployment-bootstrap'
    OR current_invitation.created_by IS NOT NULL
    OR current_invitation.consumed_at IS NOT NULL
    OR current_invitation.revoked_at IS NOT NULL
    OR operation_time <= bootstrap.issued_at
    OR EXISTS (SELECT 1 FROM auth.users)
    OR EXISTS (SELECT 1 FROM auth.identities)
    OR EXISTS (SELECT 1 FROM public.user_profiles)
    OR EXISTS (SELECT 1 FROM public.admin_roles)
    OR EXISTS (SELECT 1 FROM public.invitation_claims)
    OR EXISTS (SELECT 1 FROM public.audit_events)
    OR (SELECT count(*) FROM public.invitations) <> bootstrap.revision
    OR EXISTS (
      SELECT 1 FROM public.invitations
      WHERE created_by_kind <> 'deployment-bootstrap' OR created_by IS NOT NULL
    )
  THEN RAISE EXCEPTION 'first operator invitation is not replaceable'; END IF;

  UPDATE public.invitations SET revoked_at = operation_time
  WHERE id = bootstrap.current_invitation_id;
  INSERT INTO public.invitations(
    id,token_hash,expires_at,created_by,created_by_kind,created_at
  ) VALUES (
    new_invitation_id,new_token_hash,new_expires_at,NULL,'deployment-bootstrap',operation_time
  );
  UPDATE huayi_private.first_operator_bootstrap SET
    current_invitation_id = new_invitation_id,
    revision = revision + 1,
    issued_at = operation_time
  WHERE singleton = true;
  RETURN new_invitation_id;
END;
$$;

CREATE OR REPLACE FUNCTION huayi_private.complete_first_operator_bootstrap(
  operation_time timestamptz
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, huayi_private
AS $$
DECLARE
  bootstrap huayi_private.first_operator_bootstrap%ROWTYPE;
  current_invitation public.invitations%ROWTYPE;
  claimed public.invitation_claims%ROWTYPE;
  candidate_user_id uuid;
  profile_created_at timestamptz;
  method_count integer;
BEGIN
  IF operation_time IS NULL THEN RAISE EXCEPTION 'invalid completion time'; END IF;

  LOCK TABLE huayi_private.first_operator_bootstrap IN ACCESS EXCLUSIVE MODE;
  SELECT * INTO bootstrap FROM huayi_private.first_operator_bootstrap
  WHERE singleton = true FOR UPDATE;
  IF bootstrap.state IS DISTINCT FROM 'invited'
  THEN RAISE EXCEPTION 'first operator bootstrap is not completable'; END IF;

  SELECT * INTO current_invitation FROM public.invitations
  WHERE id = bootstrap.current_invitation_id FOR UPDATE;
  SELECT * INTO claimed FROM public.invitation_claims
  WHERE invitation_id = bootstrap.current_invitation_id FOR UPDATE;
  candidate_user_id := claimed.finalized_user_id;

  SELECT created_at INTO profile_created_at FROM public.user_profiles
  WHERE user_id = candidate_user_id AND owner_user_id = candidate_user_id
    AND status = 'active' FOR UPDATE;
  SELECT count(*) INTO method_count FROM public.account_sign_in_methods
  WHERE owner_user_id = candidate_user_id;

  IF current_invitation.id IS NULL
    OR current_invitation.created_by_kind IS DISTINCT FROM 'deployment-bootstrap'
    OR current_invitation.created_by IS NOT NULL
    OR current_invitation.consumed_at IS NULL
    OR current_invitation.revoked_at IS NOT NULL
    OR (SELECT count(*) FROM public.invitations) <> bootstrap.revision
    OR EXISTS (
      SELECT 1 FROM public.invitations
      WHERE created_by_kind <> 'deployment-bootstrap' OR created_by IS NOT NULL
    )
    OR (SELECT count(*) FROM public.invitation_claims) <> 1
    OR claimed.ticket_hash IS NULL
    OR claimed.bound_user_id IS NULL
    OR claimed.bound_user_id IS DISTINCT FROM candidate_user_id
    OR (SELECT count(*) FROM auth.users) <> 1
    OR NOT EXISTS (SELECT 1 FROM auth.users WHERE id = candidate_user_id)
    OR NOT EXISTS (SELECT 1 FROM auth.identities)
    OR EXISTS (SELECT 1 FROM auth.identities WHERE user_id <> candidate_user_id)
    OR (SELECT count(*) FROM public.user_profiles) <> 1
    OR profile_created_at IS NULL
    OR method_count NOT BETWEEN 1 AND 2
    OR EXISTS (
      SELECT 1 FROM public.account_sign_in_methods WHERE owner_user_id <> candidate_user_id
    )
    OR (SELECT count(*) FROM public.quota_grants) <> 1
    OR (SELECT count(*) FROM public.quota_grants
        WHERE user_id = candidate_user_id AND owner_user_id = candidate_user_id
          AND source = 'default' AND superseded_at IS NULL
          AND period_start <= profile_created_at AND profile_created_at < period_end) <> 1
    OR EXISTS (SELECT 1 FROM public.admin_roles)
    OR EXISTS (SELECT 1 FROM public.audit_events)
  THEN RAISE EXCEPTION 'first operator candidate is invalid'; END IF;

  INSERT INTO public.admin_roles(user_id,role,created_at)
  VALUES(candidate_user_id,'operator',operation_time);
  UPDATE huayi_private.first_operator_bootstrap SET
    state = 'completed',
    completed_at = operation_time,
    operator_user_id = candidate_user_id,
    operator_deleted_at = NULL
  WHERE singleton = true;
  RETURN candidate_user_id;
END;
$$;

REVOKE ALL ON FUNCTION huayi_private.issue_first_operator_invitation(
  uuid,text,timestamptz,timestamptz
) FROM PUBLIC, huayi_business, huayi_context_setter, huayi_runtime;
REVOKE ALL ON FUNCTION huayi_private.replace_first_operator_invitation(
  uuid,text,timestamptz,timestamptz
) FROM PUBLIC, huayi_business, huayi_context_setter, huayi_runtime;
REVOKE ALL ON FUNCTION huayi_private.complete_first_operator_bootstrap(timestamptz)
  FROM PUBLIC, huayi_business, huayi_context_setter, huayi_runtime;

COMMIT;
