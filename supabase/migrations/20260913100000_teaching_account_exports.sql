BEGIN;

ALTER TABLE public.account_data_export_jobs
  DROP CONSTRAINT account_data_export_jobs_format_version_check;
ALTER TABLE public.account_data_export_jobs
  ADD CONSTRAINT account_data_export_jobs_format_version_check CHECK (format_version IN (1,2,3));

-- Already deployed v2 runtimes cannot parse format 3, including after a lease expires.
CREATE OR REPLACE FUNCTION public.claim_account_export_v2(
  new_lease_hash text, new_lease_expires_at timestamptz
) RETURNS TABLE(id uuid, owner_user_id uuid, format_version integer, object_key text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE chosen public.account_data_export_jobs%ROWTYPE;
DECLARE candidate_key text;
BEGIN
  SELECT jobs.* INTO chosen FROM public.account_data_export_jobs jobs
  JOIN public.user_profiles profiles ON profiles.user_id=jobs.owner_user_id
  WHERE jobs.format_version IN (1,2) AND profiles.status IN ('active','disabled') AND
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

-- This capability is called only by workers that understand all three formats.
CREATE FUNCTION public.claim_account_export_v3(
  new_lease_hash text, new_lease_expires_at timestamptz
) RETURNS TABLE(id uuid, owner_user_id uuid, format_version integer, object_key text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE chosen public.account_data_export_jobs%ROWTYPE;
DECLARE candidate_key text;
BEGIN
  SELECT jobs.* INTO chosen FROM public.account_data_export_jobs jobs
  JOIN public.user_profiles profiles ON profiles.user_id=jobs.owner_user_id
  WHERE jobs.format_version IN (1,2,3) AND profiles.status IN ('active','disabled') AND
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

REVOKE ALL ON FUNCTION public.claim_account_export_v3(text,timestamptz)
  FROM PUBLIC,anon,authenticated,service_role,huayi_business;
GRANT EXECUTE ON FUNCTION public.claim_account_export_v3(text,timestamptz)
  TO huayi_context_setter;

COMMIT;
