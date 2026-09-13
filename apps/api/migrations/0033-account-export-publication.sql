BEGIN;

-- No owner or content and no cascading foreign key: an uncertain Storage write
-- must remain reclaimable even after the account and export job have been deleted.
CREATE TABLE huayi_private.account_export_candidates (
  object_key text PRIMARY KEY,
  export_id uuid,
  lease_hash text,
  retired boolean NOT NULL DEFAULT false,
  next_cleanup_at timestamptz NOT NULL DEFAULT now(),
  cleaned_at timestamptz
);
REVOKE ALL ON huayi_private.account_export_candidates
  FROM PUBLIC,anon,authenticated,service_role,huayi_business,huayi_context_setter;

-- Register outstanding legacy attempts. Upgrading must drain pre-migration workers;
-- SQL cannot retract a Storage delete already issued by an old process.
INSERT INTO huayi_private.account_export_candidates(object_key,export_id,lease_hash)
SELECT 'account-exports/'||id||'.ndjson',id,lease_token_hash
FROM public.account_data_export_jobs;

CREATE OR REPLACE FUNCTION public.claim_account_export(
  new_lease_hash text, new_lease_expires_at timestamptz
) RETURNS TABLE(id uuid, owner_user_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE chosen public.account_data_export_jobs%ROWTYPE;
BEGIN
  SELECT jobs.* INTO chosen FROM public.account_data_export_jobs jobs
  JOIN public.user_profiles profiles ON profiles.user_id=jobs.owner_user_id
  WHERE jobs.format_version=1 AND profiles.status IN ('active','disabled') AND jobs.state='pending'
    AND NOT EXISTS (SELECT 1 FROM huayi_private.account_export_candidates objects
      WHERE objects.object_key='account-exports/'||jobs.id||'.ndjson')
  ORDER BY jobs.created_at,jobs.id FOR UPDATE OF jobs SKIP LOCKED LIMIT 1;
  IF NOT FOUND THEN RETURN; END IF;
  UPDATE public.account_data_export_jobs jobs SET state='running',lease_token_hash=new_lease_hash,
    lease_expires_at=new_lease_expires_at,last_error_code=NULL,revision=revision+1,updated_at=now()
    WHERE jobs.id=chosen.id;
  INSERT INTO huayi_private.account_export_candidates(object_key,export_id,lease_hash)
    VALUES('account-exports/'||chosen.id||'.ndjson',chosen.id,new_lease_hash);
  RETURN QUERY SELECT chosen.id,chosen.owner_user_id;
END;
$$;

-- The explicit v2 worker returns its registered private object key.
DROP FUNCTION public.claim_account_export_v2(text,timestamptz);
CREATE FUNCTION public.claim_account_export_v2(
  new_lease_hash text, new_lease_expires_at timestamptz
) RETURNS TABLE(id uuid, owner_user_id uuid, format_version integer, object_key text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE chosen public.account_data_export_jobs%ROWTYPE;
DECLARE candidate_key text;
BEGIN
  SELECT jobs.* INTO chosen FROM public.account_data_export_jobs jobs
  JOIN public.user_profiles profiles ON profiles.user_id=jobs.owner_user_id
  WHERE profiles.status IN ('active','disabled') AND
    (jobs.state='pending' OR (jobs.state='running' AND jobs.lease_expires_at<=now()))
  ORDER BY jobs.created_at,jobs.id FOR UPDATE OF jobs SKIP LOCKED LIMIT 1;
  IF NOT FOUND THEN RETURN; END IF;
  candidate_key := 'account-exports/'||gen_random_uuid()||'.ndjson';
  UPDATE public.account_data_export_jobs jobs SET state='running',lease_token_hash=new_lease_hash,
    lease_expires_at=new_lease_expires_at,last_error_code=NULL,revision=revision+1,updated_at=now()
    WHERE jobs.id=chosen.id;
  INSERT INTO huayi_private.account_export_candidates(object_key,export_id,lease_hash)
    VALUES(candidate_key,chosen.id,new_lease_hash);
  RETURN QUERY SELECT chosen.id,chosen.owner_user_id,chosen.format_version,candidate_key;
END;
$$;

CREATE FUNCTION public.prepare_account_export_upload(export_id uuid,presented_lease_hash text,candidate_key text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE active_job public.account_data_export_jobs%ROWTYPE;
BEGIN
  SELECT * INTO active_job FROM public.account_data_export_jobs WHERE id=export_id FOR UPDATE;
  IF NOT FOUND OR active_job.state<>'running' OR active_job.lease_token_hash IS DISTINCT FROM presented_lease_hash
    OR active_job.lease_expires_at<=now() OR NOT EXISTS (
      SELECT 1 FROM public.user_profiles WHERE user_id=active_job.owner_user_id AND status IN ('active','disabled')
    ) THEN RETURN false; END IF;
  RETURN EXISTS (SELECT 1 FROM huayi_private.account_export_candidates objects
    WHERE objects.object_key=candidate_key AND objects.export_id=prepare_account_export_upload.export_id
      AND objects.lease_hash=presented_lease_hash AND NOT objects.retired);
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_account_export(
  export_id uuid,presented_lease_hash text,export_record_count integer,
  export_byte_length bigint,export_sha256 text,export_object_key text,export_expires_at timestamptz
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF NOT public.prepare_account_export_upload(export_id,presented_lease_hash,export_object_key)
    THEN RETURN false; END IF;
  UPDATE public.account_data_export_jobs SET state='ready',record_count=export_record_count,
    byte_length=export_byte_length,sha256=export_sha256,object_key=export_object_key,
    expires_at=export_expires_at,lease_token_hash=NULL,lease_expires_at=NULL,
    revision=revision+1,updated_at=now() WHERE id=export_id;
  RETURN true;
END;
$$;

CREATE FUNCTION public.reconcile_account_export_publication(
  export_id uuid,presented_lease_hash text,candidate_key text,expected_record_count integer,
  expected_byte_length bigint,expected_sha256 text
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE job public.account_data_export_jobs%ROWTYPE;
BEGIN
  SELECT * INTO job FROM public.account_data_export_jobs WHERE id=export_id FOR UPDATE;
  IF FOUND AND job.state='ready' AND job.object_key=candidate_key THEN
    IF job.record_count=expected_record_count AND job.byte_length=expected_byte_length
      AND job.sha256=expected_sha256 THEN RETURN 'published'; END IF;
    RAISE EXCEPTION 'export publication metadata mismatch';
  END IF;
  IF job.state='running' AND job.lease_token_hash=presented_lease_hash THEN
    PERFORM public.fail_account_export(export_id,presented_lease_hash,'object-write-failed');
  END IF;
  UPDATE huayi_private.account_export_candidates objects SET retired=true,next_cleanup_at=now()
    WHERE objects.object_key=candidate_key AND objects.export_id=reconcile_account_export_publication.export_id
      AND objects.lease_hash=presented_lease_hash;
  RETURN 'retired';
END;
$$;

CREATE FUNCTION public.claim_account_export_candidate_cleanup()
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE candidate record;
DECLARE job public.account_data_export_jobs%ROWTYPE;
BEGIN
  FOR candidate IN SELECT objects.object_key,objects.export_id
    FROM huayi_private.account_export_candidates objects
    LEFT JOIN public.account_data_export_jobs jobs ON jobs.id=objects.export_id
    WHERE objects.next_cleanup_at<=now() AND (objects.retired OR jobs.id IS NULL OR
      (NOT (jobs.state='ready' AND jobs.object_key=objects.object_key) AND
       NOT (jobs.state='running' AND jobs.lease_token_hash=objects.lease_hash AND jobs.lease_expires_at>now())))
    ORDER BY objects.cleaned_at NULLS FIRST,objects.next_cleanup_at,objects.object_key
  LOOP
    -- Match publication's job -> candidate lock order and recheck after locking.
    SELECT * INTO job FROM public.account_data_export_jobs WHERE id=candidate.export_id FOR UPDATE;
    PERFORM 1 FROM huayi_private.account_export_candidates objects
      WHERE objects.object_key=candidate.object_key AND objects.next_cleanup_at<=now()
      FOR UPDATE SKIP LOCKED;
    IF NOT FOUND THEN CONTINUE; END IF;
    IF job.state='ready' AND job.object_key=candidate.object_key THEN CONTINUE; END IF;
    IF job.state='running' AND job.lease_expires_at>now() AND EXISTS (
      SELECT 1 FROM huayi_private.account_export_candidates objects WHERE objects.object_key=candidate.object_key
        AND objects.lease_hash=job.lease_token_hash AND NOT objects.retired
    ) THEN CONTINUE; END IF;
    UPDATE huayi_private.account_export_candidates objects SET retired=true,
      next_cleanup_at=now()+interval '5 minutes' WHERE objects.object_key=candidate.object_key;
    RETURN candidate.object_key;
  END LOOP;
  RETURN NULL;
END;
$$;

CREATE FUNCTION public.finish_account_export_candidate_cleanup(candidate_key text)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
  -- An acknowledged remove is not proof that an earlier uncertain upload cannot arrive.
  -- Retain only the random key and cleanup timing; repeat deletion through the worker.
  UPDATE huayi_private.account_export_candidates SET export_id=NULL,lease_hash=NULL,
    cleaned_at=now(),next_cleanup_at=now()+interval '24 hours'
    WHERE object_key=candidate_key AND retired RETURNING true;
$$;

CREATE FUNCTION public.claim_account_deletion_v2(new_lease_hash text,new_lease_expires_at timestamptz)
RETURNS TABLE(job_id uuid,subject_user_id uuid,stage text,object_keys text[])
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  RETURN QUERY SELECT claimed.job_id,claimed.subject_user_id,claimed.stage,
    ARRAY(SELECT DISTINCT keys.key FROM (
      SELECT unnest(claimed.object_keys) AS key UNION ALL
      SELECT objects.object_key FROM huayi_private.account_export_candidates objects
        JOIN public.account_data_export_jobs jobs ON jobs.id=objects.export_id
        WHERE jobs.owner_user_id=claimed.subject_user_id
    ) keys ORDER BY keys.key)
    FROM public.claim_account_deletion(new_lease_hash,new_lease_expires_at) claimed;
END;
$$;

CREATE FUNCTION public.finish_account_export_deletion(deletion_job_id uuid,presented_lease_hash text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE account_user_id uuid;
BEGIN
  SELECT subject_user_id INTO account_user_id FROM public.account_deletion_jobs
    WHERE id=deletion_job_id AND state='running' AND stage='requested'
      AND lease_token_hash=presented_lease_hash FOR UPDATE;
  IF account_user_id IS NULL THEN RETURN false; END IF;
  UPDATE huayi_private.account_export_candidates objects SET retired=true,export_id=NULL,
    lease_hash=NULL,cleaned_at=now(),next_cleanup_at=now()+interval '24 hours'
    WHERE objects.export_id IN (SELECT id FROM public.account_data_export_jobs WHERE owner_user_id=account_user_id);
  RETURN public.advance_account_deletion(deletion_job_id,presented_lease_hash,'requested','exports-deleted');
END;
$$;

REVOKE ALL ON FUNCTION public.claim_account_export_v2(text,timestamptz),
  public.prepare_account_export_upload(uuid,text,text),
  public.reconcile_account_export_publication(uuid,text,text,integer,bigint,text),
  public.claim_account_export_candidate_cleanup(),public.finish_account_export_candidate_cleanup(text),
  public.claim_account_deletion_v2(text,timestamptz),public.finish_account_export_deletion(uuid,text)
  FROM PUBLIC,anon,authenticated,service_role,huayi_business;
GRANT EXECUTE ON FUNCTION public.claim_account_export_v2(text,timestamptz),
  public.prepare_account_export_upload(uuid,text,text),
  public.reconcile_account_export_publication(uuid,text,text,integer,bigint,text),
  public.claim_account_export_candidate_cleanup(),public.finish_account_export_candidate_cleanup(text),
  public.claim_account_deletion_v2(text,timestamptz),public.finish_account_export_deletion(uuid,text)
  TO huayi_context_setter;

COMMIT;
