BEGIN;

ALTER TABLE huayi_private.hosted_acceptance_operations
  ADD COLUMN identity_scrubbed_at timestamptz;

ALTER TABLE huayi_private.hosted_acceptance_operations
  DROP CONSTRAINT hosted_acceptance_dispatch_evidence_check,
  DROP CONSTRAINT hosted_acceptance_receipt_evidence_check,
  ADD CONSTRAINT hosted_acceptance_dispatch_evidence_check CHECK (
    dispatch_attempted_at IS NULL
    OR owner_user_id IS NOT NULL
    OR identity_scrubbed_at IS NOT NULL
  ),
  ADD CONSTRAINT hosted_acceptance_receipt_evidence_check CHECK (
    receipt_digest IS NULL
    OR server_request_id IS NOT NULL
    OR identity_scrubbed_at IS NOT NULL
  ),
  ADD CONSTRAINT hosted_acceptance_identity_scrub_shape_check CHECK (
    identity_scrubbed_at IS NULL
    OR (
      state = 'terminal'
      AND owner_user_id IS NULL
      AND idempotency_key_hmac IS NULL
      AND server_request_id IS NULL
      AND dispatch_attempted_at IS NOT NULL
      AND receipt_digest IS NOT NULL
      AND terminal_at IS NOT NULL
      AND identity_scrubbed_at >= terminal_at + interval '24 hours'
    )
  );

CREATE OR REPLACE FUNCTION huayi_private.enforce_hosted_acceptance_operation_state()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, huayi_private
AS $$
DECLARE
  old_state_rank integer;
  new_state_rank integer;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.identity_scrubbed_at IS NOT NULL THEN
      RAISE EXCEPTION 'hosted acceptance identity cannot be inserted as scrubbed';
    END IF;
    RETURN NEW;
  END IF;

  IF ROW(
    NEW.id,
    NEW.approval_digest,
    NEW.candidate_commit,
    NEW.maximum_reservation_micro_usd,
    NEW.payload_digest,
    NEW.api_deployment_id,
    NEW.api_source_commit,
    NEW.web_deployment_id,
    NEW.web_source_commit,
    NEW.created_at,
    NEW.retention_expires_at
  ) IS DISTINCT FROM ROW(
    OLD.id,
    OLD.approval_digest,
    OLD.candidate_commit,
    OLD.maximum_reservation_micro_usd,
    OLD.payload_digest,
    OLD.api_deployment_id,
    OLD.api_source_commit,
    OLD.web_deployment_id,
    OLD.web_source_commit,
    OLD.created_at,
    OLD.retention_expires_at
  ) THEN
    RAISE EXCEPTION 'hosted acceptance operation identity is immutable';
  END IF;

  old_state_rank := CASE OLD.state
    WHEN 'ready' THEN 0
    WHEN 'running' THEN 1
    WHEN 'cleanup-pending' THEN 2
    WHEN 'terminal' THEN 3
    ELSE NULL
  END;
  new_state_rank := CASE NEW.state
    WHEN 'ready' THEN 0
    WHEN 'running' THEN 1
    WHEN 'cleanup-pending' THEN 2
    WHEN 'terminal' THEN 3
    ELSE NULL
  END;
  IF old_state_rank IS NULL OR new_state_rank IS NULL OR new_state_rank < old_state_rank THEN
    RAISE EXCEPTION 'invalid hosted acceptance operation state transition';
  END IF;

  IF NEW.state = 'running' THEN
    IF NEW.state IS DISTINCT FROM OLD.state
      OR ROW(NEW.lease_generation, NEW.lease_token_hash, NEW.lease_expires_at)
        IS DISTINCT FROM ROW(
          OLD.lease_generation,
          OLD.lease_token_hash,
          OLD.lease_expires_at
        )
    THEN
      IF NEW.lease_generation <> OLD.lease_generation + 1
        OR ROW(NEW.lease_token_hash, NEW.lease_expires_at)
          IS NOT DISTINCT FROM ROW(OLD.lease_token_hash, OLD.lease_expires_at)
      THEN
        RAISE EXCEPTION 'hosted acceptance operation lease is not fenced';
      END IF;
    END IF;
  ELSIF NEW.lease_generation IS DISTINCT FROM OLD.lease_generation THEN
    RAISE EXCEPTION 'stale hosted acceptance operation lease generation';
  END IF;

  IF OLD.dispatch_attempted_at IS NOT NULL
    AND NEW.dispatch_attempted_at IS DISTINCT FROM OLD.dispatch_attempted_at
  THEN
    RAISE EXCEPTION 'hosted acceptance dispatch marker is immutable';
  END IF;
  IF OLD.receipt_digest IS NOT NULL
    AND NEW.receipt_digest IS DISTINCT FROM OLD.receipt_digest
  THEN
    RAISE EXCEPTION 'hosted acceptance receipt is immutable';
  END IF;
  IF OLD.state = 'terminal'
    AND ROW(NEW.safe_error_code, NEW.updated_at, NEW.terminal_at)
      IS DISTINCT FROM ROW(OLD.safe_error_code, OLD.updated_at, OLD.terminal_at)
  THEN
    RAISE EXCEPTION 'terminal hosted acceptance operation is immutable';
  END IF;

  IF OLD.identity_scrubbed_at IS NOT NULL THEN
    RAISE EXCEPTION 'scrubbed hosted acceptance identity is immutable';
  ELSIF NEW.identity_scrubbed_at IS NOT NULL THEN
    IF OLD.state <> 'terminal'
      OR NEW.state <> 'terminal'
      OR OLD.owner_user_id IS NULL
      OR OLD.idempotency_key_hmac IS NULL
      OR OLD.server_request_id IS NULL
      OR OLD.receipt_digest IS NULL
      OR NEW.owner_user_id IS NOT NULL
      OR NEW.idempotency_key_hmac IS NOT NULL
      OR NEW.server_request_id IS NOT NULL
      OR NEW.identity_scrubbed_at < OLD.terminal_at + interval '24 hours'
      OR NEW.identity_scrubbed_at > clock_timestamp()
    THEN
      RAISE EXCEPTION 'invalid hosted acceptance identity scrub';
    END IF;
  ELSIF OLD.state = 'terminal'
    AND ROW(NEW.owner_user_id, NEW.idempotency_key_hmac, NEW.server_request_id)
      IS DISTINCT FROM ROW(
        OLD.owner_user_id,
        OLD.idempotency_key_hmac,
        OLD.server_request_id
      )
  THEN
    RAISE EXCEPTION 'terminal hosted acceptance request identity is immutable';
  ELSIF (
    ROW(NEW.owner_user_id, NEW.idempotency_key_hmac)
      IS DISTINCT FROM ROW(OLD.owner_user_id, OLD.idempotency_key_hmac)
    AND (OLD.owner_user_id IS NOT NULL OR OLD.idempotency_key_hmac IS NOT NULL)
  ) OR (
    NEW.server_request_id IS DISTINCT FROM OLD.server_request_id
    AND OLD.server_request_id IS NOT NULL
  )
  THEN
    RAISE EXCEPTION 'hosted acceptance request identity is immutable';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER hosted_acceptance_operation_state_guard
  ON huayi_private.hosted_acceptance_operations;
CREATE TRIGGER hosted_acceptance_operation_state_guard
BEFORE INSERT OR UPDATE ON huayi_private.hosted_acceptance_operations
FOR EACH ROW EXECUTE FUNCTION huayi_private.enforce_hosted_acceptance_operation_state();

REVOKE ALL ON FUNCTION huayi_private.enforce_hosted_acceptance_operation_state()
FROM
  PUBLIC,
  anon,
  authenticated,
  service_role,
  huayi_business,
  huayi_context_setter,
  huayi_runtime,
  huayi_hosted_acceptance_executor;

COMMIT;
