CREATE OR REPLACE FUNCTION replay_account_deletion(
  presented_request_key_hash text,
  presented_request_hash text,
  presented_session_hash text
) RETURNS timestamptz
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT jobs.requested_at
  FROM public.account_deletion_jobs AS jobs
  WHERE jobs.request_key_hash = presented_request_key_hash
    AND jobs.request_hash = presented_request_hash
    AND jobs.request_session_hash = presented_session_hash
    AND jobs.ack_expires_at > now()
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION replay_account_deletion(text, text, text)
  FROM PUBLIC, huayi_business;
GRANT EXECUTE ON FUNCTION replay_account_deletion(text, text, text)
  TO huayi_context_setter;
