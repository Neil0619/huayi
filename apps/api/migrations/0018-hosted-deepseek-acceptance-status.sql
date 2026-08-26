BEGIN;

CREATE FUNCTION huayi_private.read_hosted_acceptance_status()
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, huayi_private
AS $$
DECLARE
  current_operation_count integer;
  current_operation_state text;
  latest_operation_state text;
BEGIN
  SELECT count(*)::integer, min(operation.state)
  INTO current_operation_count, current_operation_state
  FROM huayi_private.hosted_acceptance_operations operation
  WHERE operation.state IS DISTINCT FROM 'terminal';

  IF current_operation_count > 1 THEN
    RAISE EXCEPTION 'hosted acceptance status unavailable';
  ELSIF current_operation_count = 1 THEN
    IF current_operation_state IS NULL
      OR current_operation_state NOT IN ('ready', 'running', 'cleanup-pending')
    THEN
      RAISE EXCEPTION 'hosted acceptance status unavailable';
    END IF;
    RETURN current_operation_state;
  END IF;

  SELECT operation.state
  INTO latest_operation_state
  FROM huayi_private.hosted_acceptance_operations operation
  ORDER BY operation.created_at DESC, operation.id DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN 'absent';
  ELSIF latest_operation_state IS DISTINCT FROM 'terminal' THEN
    RAISE EXCEPTION 'hosted acceptance status unavailable';
  END IF;

  RETURN latest_operation_state;
END;
$$;

REVOKE ALL ON FUNCTION huayi_private.read_hosted_acceptance_status()
FROM
  PUBLIC,
  anon,
  authenticated,
  service_role,
  huayi_business,
  huayi_context_setter,
  huayi_runtime,
  huayi_hosted_acceptance_executor;
GRANT EXECUTE ON FUNCTION huayi_private.read_hosted_acceptance_status()
TO huayi_hosted_acceptance_executor;

COMMIT;
