BEGIN;

-- A definite provider password-policy rejection has made no password change.
-- Release only its current lease, preserving the verified browser proof and expiry.
CREATE FUNCTION release_password_recovery_completion(
  recovery_flow_hash text,
  presented_lease_hash text,
  released_at timestamptz
) RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  UPDATE public.password_recovery_flows AS flows SET
    completion_lease_hash=NULL,completion_lease_expires_at=NULL
  WHERE flows.flow_hash=recovery_flow_hash AND flows.stage='verified'
    AND flows.completion_lease_hash=presented_lease_hash
    AND flows.completion_lease_expires_at>released_at
    AND flows.browser_expires_at>released_at AND flows.expires_at>released_at
  RETURNING true;
$$;

REVOKE ALL ON FUNCTION release_password_recovery_completion(text,text,timestamptz)
FROM PUBLIC,anon,authenticated,service_role,huayi_business,huayi_runtime;
GRANT EXECUTE ON FUNCTION release_password_recovery_completion(text,text,timestamptz)
TO huayi_context_setter;

COMMIT;
