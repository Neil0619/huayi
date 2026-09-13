BEGIN;

ALTER TABLE public.account_data_export_jobs
  DROP CONSTRAINT account_data_export_jobs_format_version_check;
ALTER TABLE public.account_data_export_jobs
  ADD CONSTRAINT account_data_export_jobs_format_version_check CHECK (format_version IN (1,2));

-- Keep legacy workers on format 1 during a mixed-version rollout. Their signature is frozen.
CREATE OR REPLACE FUNCTION public.claim_account_export(
  new_lease_hash text, new_lease_expires_at timestamptz
) RETURNS TABLE(id uuid, owner_user_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  RETURN QUERY WITH candidate AS (
    SELECT jobs.id FROM public.account_data_export_jobs jobs
    WHERE jobs.format_version=1 AND
      (jobs.state='pending' OR (jobs.state='running' AND jobs.lease_expires_at<=now()))
    ORDER BY jobs.created_at,jobs.id FOR UPDATE SKIP LOCKED LIMIT 1
  ) UPDATE public.account_data_export_jobs jobs SET
    state='running',lease_token_hash=new_lease_hash,lease_expires_at=new_lease_expires_at,
    last_error_code=NULL,revision=revision+1,updated_at=now()
    FROM candidate WHERE jobs.id=candidate.id RETURNING jobs.id,jobs.owner_user_id;
END;
$$;

CREATE FUNCTION public.claim_account_export_v2(
  new_lease_hash text, new_lease_expires_at timestamptz
) RETURNS TABLE(id uuid, owner_user_id uuid, format_version integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  RETURN QUERY WITH candidate AS (
    SELECT jobs.id FROM public.account_data_export_jobs jobs
    WHERE jobs.state='pending' OR (jobs.state='running' AND jobs.lease_expires_at<=now())
    ORDER BY jobs.created_at,jobs.id FOR UPDATE SKIP LOCKED LIMIT 1
  ) UPDATE public.account_data_export_jobs jobs SET
    state='running',lease_token_hash=new_lease_hash,lease_expires_at=new_lease_expires_at,
    last_error_code=NULL,revision=revision+1,updated_at=now()
    FROM candidate WHERE jobs.id=candidate.id
    RETURNING jobs.id,jobs.owner_user_id,jobs.format_version;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_account_export_v2(text,timestamptz)
  FROM PUBLIC,anon,authenticated,service_role,huayi_business;
GRANT EXECUTE ON FUNCTION public.claim_account_export_v2(text,timestamptz)
  TO huayi_context_setter;

COMMIT;
