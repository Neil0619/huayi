BEGIN;

CREATE TABLE public.shanbay_backfill_accounts (
  owner_user_id uuid PRIMARY KEY REFERENCES public.user_profiles(user_id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  daily_hour integer NOT NULL DEFAULT 8 CHECK (daily_hour BETWEEN 0 AND 23),
  revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
  scope_id uuid NOT NULL DEFAULT gen_random_uuid(),
  last_checked_at timestamptz
);
CREATE TABLE public.shanbay_backfill_sources (
  owner_user_id uuid NOT NULL REFERENCES public.shanbay_backfill_accounts(owner_user_id) ON DELETE CASCADE,
  headword text NOT NULL CHECK (headword ~ '^[a-z]+([''-][a-z]+)*$'),
  record jsonb NOT NULL CHECK (record->>'headword'=headword),
  PRIMARY KEY (owner_user_id,headword)
);
CREATE TABLE public.shanbay_backfill_targets (
  owner_user_id uuid NOT NULL REFERENCES public.shanbay_backfill_accounts(owner_user_id) ON DELETE CASCADE,
  headword text NOT NULL CHECK (headword ~ '^[a-z]+([''-][a-z]+)*$'),
  record jsonb NOT NULL CHECK (record->>'headword'=headword),
  PRIMARY KEY (owner_user_id,headword)
);
CREATE TABLE public.shanbay_backfill_batches (
  owner_user_id uuid NOT NULL REFERENCES public.shanbay_backfill_accounts(owner_user_id) ON DELETE CASCADE,
  token text NOT NULL,
  record jsonb NOT NULL CHECK (record->>'token'=token),
  PRIMARY KEY (owner_user_id,token)
);

ALTER TABLE public.shanbay_backfill_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shanbay_backfill_accounts FORCE ROW LEVEL SECURITY;
CREATE POLICY shanbay_backfill_accounts_owner ON public.shanbay_backfill_accounts
  USING (owner_user_id=huayi_private.current_owner_user_id()) WITH CHECK (owner_user_id=huayi_private.current_owner_user_id());
ALTER TABLE public.shanbay_backfill_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shanbay_backfill_sources FORCE ROW LEVEL SECURITY;
CREATE POLICY shanbay_backfill_sources_owner ON public.shanbay_backfill_sources
  USING (owner_user_id=huayi_private.current_owner_user_id()) WITH CHECK (owner_user_id=huayi_private.current_owner_user_id());
ALTER TABLE public.shanbay_backfill_targets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shanbay_backfill_targets FORCE ROW LEVEL SECURITY;
CREATE POLICY shanbay_backfill_targets_owner ON public.shanbay_backfill_targets
  USING (owner_user_id=huayi_private.current_owner_user_id()) WITH CHECK (owner_user_id=huayi_private.current_owner_user_id());
ALTER TABLE public.shanbay_backfill_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shanbay_backfill_batches FORCE ROW LEVEL SECURITY;
CREATE POLICY shanbay_backfill_batches_owner ON public.shanbay_backfill_batches
  USING (owner_user_id=huayi_private.current_owner_user_id()) WITH CHECK (owner_user_id=huayi_private.current_owner_user_id());
REVOKE ALL ON public.shanbay_backfill_accounts,public.shanbay_backfill_sources,
  public.shanbay_backfill_targets,public.shanbay_backfill_batches FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.shanbay_backfill_accounts,public.shanbay_backfill_sources,
  public.shanbay_backfill_targets,public.shanbay_backfill_batches TO huayi_business;

-- Only a positive Shanbay receipt is evidence. Job completion and Eudic receipts are not.
INSERT INTO public.shanbay_backfill_accounts(owner_user_id)
  SELECT DISTINCT items.owner_user_id FROM public.external_wordbook_items items
  JOIN public.external_wordbook_jobs jobs ON jobs.id=items.job_id
  WHERE jobs.target='shanbay' AND jobs.direction='export' AND items.state='delivered'
    AND items.receipt->>'target'='shanbay' AND items.receipt->>'outcome'='confirmed';
INSERT INTO public.shanbay_backfill_targets(owner_user_id,headword,record)
  SELECT items.owner_user_id,lower(trim(items.payload_snapshot->>'headword')),
    jsonb_build_object('headword',lower(trim(items.payload_snapshot->>'headword')),
      'confirmedAt',to_char(min(items.updated_at) AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
  FROM public.external_wordbook_items items JOIN public.external_wordbook_jobs jobs ON jobs.id=items.job_id
  WHERE jobs.target='shanbay' AND jobs.direction='export' AND items.state='delivered'
    AND items.receipt->>'target'='shanbay' AND items.receipt->>'outcome'='confirmed'
    AND lower(trim(items.payload_snapshot->>'headword')) ~ '^[a-z]+([''-][a-z]+)*$'
  GROUP BY items.owner_user_id,lower(trim(items.payload_snapshot->>'headword'));

CREATE FUNCTION public.authenticate_backfill_extension(presented_token_hash text)
RETURNS TABLE(user_id uuid,install_id_hash text)
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
  UPDATE public.extension_sessions sessions SET last_used_at=now()
  FROM public.user_profiles profiles
  WHERE sessions.token_hash=presented_token_hash AND profiles.user_id=sessions.user_id
    AND profiles.status='active' AND sessions.revoked_at IS NULL AND sessions.expires_at>now()
  RETURNING sessions.user_id,sessions.install_id_hash;
$$;
REVOKE ALL ON FUNCTION public.authenticate_backfill_extension(text) FROM PUBLIC,anon,authenticated,service_role,huayi_business;
GRANT EXECUTE ON FUNCTION public.authenticate_backfill_extension(text) TO huayi_context_setter;

CREATE FUNCTION public.begin_backfill_write(account_user_id uuid,idempotency_key text,request_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE existing public.idempotency_records%ROWTYPE;
BEGIN
  IF char_length(idempotency_key) NOT BETWEEN 1 AND 128 OR request_hash !~ '^[0-9a-f]{64}$'
    THEN RAISE EXCEPTION 'invalid idempotent write'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(account_user_id::text||':shanbay-backfill:'||idempotency_key,3));
  SELECT * INTO existing FROM public.idempotency_records
    WHERE owner_user_id=account_user_id AND operation='shanbay-backfill' AND key=idempotency_key;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF existing.request_hash<>request_hash THEN RAISE EXCEPTION 'idempotency conflict'; END IF;
  RETURN existing.response;
END;
$$;
REVOKE ALL ON FUNCTION public.begin_backfill_write(uuid,text,text) FROM PUBLIC,anon,authenticated,service_role,huayi_business;
GRANT EXECUTE ON FUNCTION public.begin_backfill_write(uuid,text,text) TO huayi_context_setter;

COMMIT;
