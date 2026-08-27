BEGIN;

DO $empty_authority$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM huayi_private.hosted_acceptance_operations
  ) THEN
    RAISE EXCEPTION 'hosted acceptance HMAC upgrade requires empty authority';
  END IF;
END;
$empty_authority$;

ALTER TABLE huayi_private.hosted_acceptance_operations
  ADD COLUMN idempotency_hmac_context text,
  ADD COLUMN idempotency_hmac_version integer,
  ADD CONSTRAINT hosted_acceptance_idempotency_hmac_version_check CHECK (
    (idempotency_key_hmac IS NULL
      AND idempotency_hmac_context IS NULL
      AND idempotency_hmac_version IS NULL)
    OR
    (idempotency_key_hmac IS NOT NULL
      AND idempotency_hmac_context = 'huayi.hosted-deepseek-one-shot.idempotency.v1'
      AND idempotency_hmac_version IS NOT NULL
      AND idempotency_hmac_version >= 1)
  );

CREATE FUNCTION huayi_private.hosted_acceptance_token_hash(raw_token text)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
SECURITY DEFINER
SET search_path = pg_catalog, huayi_private
AS $$
  SELECT encode(sha256(convert_to(raw_token, 'UTF8')), 'hex')
$$;

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
      OR NEW.idempotency_hmac_context IS NOT NULL
      OR NEW.idempotency_hmac_version IS NOT NULL
      OR NEW.server_request_id IS NOT NULL
      OR NEW.identity_scrubbed_at < OLD.terminal_at + interval '24 hours'
      OR NEW.identity_scrubbed_at > clock_timestamp()
    THEN
      RAISE EXCEPTION 'invalid hosted acceptance identity scrub';
    END IF;
  ELSIF OLD.state = 'terminal'
    AND ROW(
      NEW.owner_user_id,
      NEW.idempotency_key_hmac,
      NEW.idempotency_hmac_context,
      NEW.idempotency_hmac_version,
      NEW.server_request_id
    ) IS DISTINCT FROM ROW(
      OLD.owner_user_id,
      OLD.idempotency_key_hmac,
      OLD.idempotency_hmac_context,
      OLD.idempotency_hmac_version,
      OLD.server_request_id
    )
  THEN
    RAISE EXCEPTION 'terminal hosted acceptance request identity is immutable';
  ELSIF (
    ROW(
      NEW.owner_user_id,
      NEW.idempotency_key_hmac,
      NEW.idempotency_hmac_context,
      NEW.idempotency_hmac_version
    ) IS DISTINCT FROM ROW(
      OLD.owner_user_id,
      OLD.idempotency_key_hmac,
      OLD.idempotency_hmac_context,
      OLD.idempotency_hmac_version
    )
    AND (OLD.owner_user_id IS NOT NULL OR OLD.idempotency_key_hmac IS NOT NULL)
  ) OR (
    NEW.server_request_id IS DISTINCT FROM OLD.server_request_id
    AND OLD.server_request_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'hosted acceptance request identity is immutable';
  END IF;

  RETURN NEW;
END;
$$;

CREATE FUNCTION huayi_private.claim_hosted_acceptance_operation(
  new_operation_id uuid,
  new_approval_digest text,
  new_candidate_commit text,
  new_maximum_reservation_micro_usd bigint,
  new_payload_digest text,
  new_api_deployment_id text,
  new_api_source_commit text,
  new_web_deployment_id text,
  new_web_source_commit text,
  new_idempotency_key_hmac text,
  new_idempotency_hmac_version integer,
  new_lease_token text
) RETURNS TABLE(
  operation_id uuid,
  owner_user_id uuid,
  lease_generation bigint,
  lease_expires_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, huayi_private
AS $$
DECLARE
  operation_time timestamptz := clock_timestamp();
  operator_count integer;
  operator_user_id uuid;
BEGIN
  IF new_operation_id IS NULL
    OR new_approval_digest !~ '^[0-9a-f]{64}$'
    OR new_candidate_commit !~ '^[0-9a-f]{40}$'
    OR new_maximum_reservation_micro_usd <= 0
    OR new_payload_digest !~ '^[0-9a-f]{64}$'
    OR new_api_deployment_id !~ '^dpl_[A-Za-z0-9]+$'
    OR new_api_source_commit !~ '^[0-9a-f]{40}$'
    OR new_web_deployment_id !~ '^dpl_[A-Za-z0-9]+$'
    OR new_web_source_commit !~ '^[0-9a-f]{40}$'
    OR new_api_deployment_id = new_web_deployment_id
    OR new_idempotency_key_hmac !~ '^[0-9a-f]{64}$'
    OR new_idempotency_hmac_version IS NULL
    OR new_idempotency_hmac_version < 1
    OR new_lease_token !~ '^[A-Za-z0-9_-]{8,128}$'
  THEN
    RAISE EXCEPTION 'invalid hosted acceptance claim';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('hosted-deepseek-acceptance', 0));
  SELECT count(*)::integer, min(bootstrap.operator_user_id::text)::uuid
  INTO operator_count, operator_user_id
  FROM huayi_private.first_operator_bootstrap bootstrap
  JOIN public.user_profiles profiles
    ON profiles.user_id = bootstrap.operator_user_id
  JOIN public.admin_roles roles
    ON roles.user_id = bootstrap.operator_user_id AND roles.role = 'operator'
  WHERE bootstrap.singleton
    AND bootstrap.state = 'completed'
    AND bootstrap.operator_deleted_at IS NULL
    AND profiles.status = 'active';
  IF operator_count <> 1 OR operator_user_id IS NULL THEN
    RAISE EXCEPTION 'hosted acceptance operator unavailable';
  END IF;

  INSERT INTO huayi_private.hosted_acceptance_operations(
    id,
    approval_digest,
    candidate_commit,
    maximum_reservation_micro_usd,
    payload_digest,
    api_deployment_id,
    api_source_commit,
    web_deployment_id,
    web_source_commit,
    state,
    owner_user_id,
    idempotency_key_hmac,
    idempotency_hmac_context,
    idempotency_hmac_version,
    lease_generation,
    lease_token_hash,
    lease_expires_at,
    created_at,
    updated_at,
    retention_expires_at
  ) VALUES (
    new_operation_id,
    new_approval_digest,
    new_candidate_commit,
    new_maximum_reservation_micro_usd,
    new_payload_digest,
    new_api_deployment_id,
    new_api_source_commit,
    new_web_deployment_id,
    new_web_source_commit,
    'running',
    operator_user_id,
    new_idempotency_key_hmac,
    'huayi.hosted-deepseek-one-shot.idempotency.v1',
    new_idempotency_hmac_version,
    1,
    huayi_private.hosted_acceptance_token_hash(new_lease_token),
    operation_time + interval '120 seconds',
    operation_time,
    operation_time,
    operation_time + interval '90 days'
  );

  RETURN QUERY SELECT
    new_operation_id,
    operator_user_id,
    1::bigint,
    operation_time + interval '120 seconds';
END;
$$;

CREATE FUNCTION huayi_private.arm_hosted_acceptance_cleanup(
  requested_operation_id uuid,
  requested_lease_generation bigint,
  requested_lease_token text,
  new_cleanup_token text
) RETURNS TABLE(
  operation_id uuid,
  claim_generation bigint,
  armed_at timestamptz,
  claim_expires_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, huayi_private
AS $$
DECLARE
  operation huayi_private.hosted_acceptance_operations%ROWTYPE;
  operation_time timestamptz := clock_timestamp();
BEGIN
  IF requested_lease_token !~ '^[A-Za-z0-9_-]{8,128}$'
    OR new_cleanup_token IS DISTINCT FROM requested_lease_token
  THEN RAISE EXCEPTION 'invalid hosted acceptance cleanup arm'; END IF;
  SELECT * INTO operation
  FROM huayi_private.hosted_acceptance_operations
  WHERE id = requested_operation_id
  FOR UPDATE;
  IF operation.state IS DISTINCT FROM 'running'
    OR operation.lease_generation IS DISTINCT FROM requested_lease_generation
    OR operation.lease_token_hash IS DISTINCT FROM
      huayi_private.hosted_acceptance_token_hash(requested_lease_token)
    OR operation.lease_expires_at <= operation_time + interval '110 seconds'
  THEN RAISE EXCEPTION 'hosted acceptance operation fence rejected'; END IF;

  INSERT INTO huayi_private.hosted_acceptance_cleanup_obligations(
    operation_id,
    armed_at,
    updated_at
  ) VALUES (
    requested_operation_id,
    operation_time,
    operation_time
  );
  RETURN QUERY SELECT
    requested_operation_id,
    operation.lease_generation,
    operation_time,
    operation.lease_expires_at;
END;
$$;

CREATE FUNCTION huayi_private.mark_hosted_acceptance_dispatch(
  requested_operation_id uuid,
  requested_lease_generation bigint,
  requested_lease_token text,
  requested_payload_digest text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, huayi_private
AS $$
DECLARE
  operation huayi_private.hosted_acceptance_operations%ROWTYPE;
  operation_time timestamptz := clock_timestamp();
BEGIN
  SELECT * INTO operation
  FROM huayi_private.hosted_acceptance_operations
  WHERE id = requested_operation_id
  FOR UPDATE;
  IF operation.state IS DISTINCT FROM 'running'
    OR operation.lease_generation IS DISTINCT FROM requested_lease_generation
    OR operation.lease_token_hash IS DISTINCT FROM
      huayi_private.hosted_acceptance_token_hash(requested_lease_token)
    OR operation.lease_expires_at <= operation_time
    OR operation.payload_digest IS DISTINCT FROM requested_payload_digest
    OR operation.dispatch_attempted_at IS NOT NULL
  THEN RAISE EXCEPTION 'hosted acceptance dispatch rejected'; END IF;
  UPDATE huayi_private.hosted_acceptance_operations
  SET dispatch_attempted_at = operation_time, updated_at = operation_time
  WHERE id = requested_operation_id;
  RETURN requested_operation_id;
END;
$$;

CREATE FUNCTION huayi_private.bind_hosted_acceptance_request(
  requested_operation_id uuid,
  requested_lease_generation bigint,
  requested_lease_token text,
  requested_owner_user_id uuid,
  requested_server_request_id uuid,
  requested_idempotency_key text,
  requested_idempotency_key_hmac text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, huayi_private
AS $$
DECLARE
  operation huayi_private.hosted_acceptance_operations%ROWTYPE;
  request_idempotency_key text;
  request_owner_id uuid;
  request_hash text;
  operation_time timestamptz := clock_timestamp();
BEGIN
  SELECT * INTO operation
  FROM huayi_private.hosted_acceptance_operations
  WHERE id = requested_operation_id
  FOR UPDATE;
  SELECT requests.owner_user_id, requests.idempotency_key, requests.request_hash
  INTO request_owner_id, request_idempotency_key, request_hash
  FROM public.analysis_requests requests
  WHERE requests.id = requested_server_request_id;
  IF operation.state IS DISTINCT FROM 'running'
    OR operation.lease_generation IS DISTINCT FROM requested_lease_generation
    OR operation.lease_token_hash IS DISTINCT FROM
      huayi_private.hosted_acceptance_token_hash(requested_lease_token)
    OR operation.lease_expires_at <= operation_time
    OR operation.owner_user_id IS DISTINCT FROM requested_owner_user_id
    OR requested_idempotency_key IS NULL
    OR requested_idempotency_key !~ '^[A-Za-z0-9._:-]{8,128}$'
    OR operation.idempotency_key_hmac IS DISTINCT FROM requested_idempotency_key_hmac
    OR operation.dispatch_attempted_at IS NULL
    OR operation.server_request_id IS NOT NULL
    OR request_owner_id IS DISTINCT FROM operation.owner_user_id
    OR request_idempotency_key IS DISTINCT FROM requested_idempotency_key
    OR request_hash IS DISTINCT FROM operation.payload_digest
  THEN RAISE EXCEPTION 'hosted acceptance request binding rejected'; END IF;
  UPDATE huayi_private.hosted_acceptance_operations
  SET server_request_id = requested_server_request_id, updated_at = operation_time
  WHERE id = requested_operation_id;
  RETURN requested_server_request_id;
END;
$$;

CREATE FUNCTION huayi_private.record_hosted_acceptance_settlement(
  requested_operation_id uuid,
  requested_lease_generation bigint,
  requested_lease_token text,
  requested_server_request_id uuid,
  new_receipt_digest text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, huayi_private
AS $$
DECLARE
  operation huayi_private.hosted_acceptance_operations%ROWTYPE;
  operation_time timestamptz := clock_timestamp();
BEGIN
  SELECT * INTO operation
  FROM huayi_private.hosted_acceptance_operations
  WHERE id = requested_operation_id
  FOR UPDATE;
  IF operation.state IS DISTINCT FROM 'running'
    OR operation.lease_generation IS DISTINCT FROM requested_lease_generation
    OR operation.lease_token_hash IS DISTINCT FROM
      huayi_private.hosted_acceptance_token_hash(requested_lease_token)
    OR operation.lease_expires_at <= operation_time
    OR operation.server_request_id IS DISTINCT FROM requested_server_request_id
    OR new_receipt_digest !~ '^[0-9a-f]{64}$'
  THEN RAISE EXCEPTION 'hosted acceptance settlement rejected'; END IF;
  IF operation.receipt_digest IS NOT NULL THEN
    IF operation.receipt_digest IS DISTINCT FROM new_receipt_digest THEN
      RAISE EXCEPTION 'hosted acceptance settlement rejected';
    END IF;
    RETURN requested_server_request_id;
  END IF;
  UPDATE huayi_private.hosted_acceptance_operations
  SET receipt_digest = new_receipt_digest, updated_at = operation_time
  WHERE id = requested_operation_id;
  RETURN requested_server_request_id;
END;
$$;

CREATE FUNCTION huayi_private.complete_hosted_acceptance_operation(
  requested_operation_id uuid,
  requested_lease_generation bigint,
  requested_lease_token text,
  requested_outcome text,
  requested_safe_error_code text
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, huayi_private
AS $$
DECLARE
  operation huayi_private.hosted_acceptance_operations%ROWTYPE;
  cleanup_state text;
  operation_time timestamptz := clock_timestamp();
BEGIN
  SELECT * INTO operation
  FROM huayi_private.hosted_acceptance_operations
  WHERE id = requested_operation_id
  FOR UPDATE;
  SELECT cleanup.state INTO cleanup_state
  FROM huayi_private.hosted_acceptance_cleanup_obligations cleanup
  WHERE cleanup.operation_id = requested_operation_id;
  IF operation.state IS DISTINCT FROM 'running'
    OR operation.lease_generation IS DISTINCT FROM requested_lease_generation
    OR operation.lease_token_hash IS DISTINCT FROM
      huayi_private.hosted_acceptance_token_hash(requested_lease_token)
    OR operation.lease_expires_at <= operation_time
    OR requested_outcome IS NULL
    OR requested_outcome NOT IN ('accepted', 'failed', 'failed-cleanup-pending')
    OR (requested_outcome = 'accepted'
      AND (operation.receipt_digest IS NULL OR cleanup_state IS DISTINCT FROM 'completed'))
    OR (requested_outcome = 'failed'
      AND cleanup_state IS NOT NULL
      AND cleanup_state IS DISTINCT FROM 'completed')
    OR (requested_outcome = 'failed-cleanup-pending'
      AND cleanup_state IS NOT NULL
      AND cleanup_state IS DISTINCT FROM 'pending'
      AND cleanup_state IS DISTINCT FROM 'claimed')
  THEN RAISE EXCEPTION 'hosted acceptance completion rejected'; END IF;

  IF requested_outcome = 'failed-cleanup-pending' AND cleanup_state IS NULL THEN
    INSERT INTO huayi_private.hosted_acceptance_cleanup_obligations(
      operation_id,
      armed_at,
      updated_at
    ) VALUES (
      requested_operation_id,
      operation_time,
      operation_time
    );
    cleanup_state := 'pending';
  END IF;

  IF requested_outcome = 'failed-cleanup-pending' THEN
    UPDATE huayi_private.hosted_acceptance_operations
    SET state = 'cleanup-pending',
        lease_token_hash = NULL,
        lease_expires_at = NULL,
        safe_error_code = 'cleanup_pending',
        updated_at = operation_time
    WHERE id = requested_operation_id;
  ELSE
    UPDATE huayi_private.hosted_acceptance_operations
    SET state = 'terminal',
        lease_token_hash = NULL,
        lease_expires_at = NULL,
        safe_error_code = CASE
          WHEN requested_outcome = 'accepted' THEN NULL
          ELSE COALESCE(requested_safe_error_code, 'internal_safe_failure')
        END,
        updated_at = operation_time,
        terminal_at = operation_time
    WHERE id = requested_operation_id;
  END IF;
  RETURN requested_outcome;
END;
$$;

CREATE FUNCTION huayi_private.claim_hosted_acceptance_cleanup(
  new_cleanup_token text,
  new_operation_token text
) RETURNS TABLE(
  operation_id uuid,
  cleanup_claim_generation bigint,
  cleanup_claim_expires_at timestamptz,
  cleanup_already_completed boolean,
  armed_at timestamptz,
  operation_state text,
  operation_lease_generation bigint,
  operation_lease_expires_at timestamptz,
  candidate_commit text,
  maximum_reservation_micro_usd bigint,
  owner_user_id uuid,
  payload_digest text,
  idempotency_key_hmac text,
  idempotency_hmac_context text,
  idempotency_hmac_version integer,
  operation_created_at timestamptz,
  dispatch_attempted boolean,
  settlement_recorded boolean,
  server_request_id uuid,
  api_deployment_id text,
  api_source_commit text,
  web_deployment_id text,
  web_source_commit text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, huayi_private
AS $$
DECLARE
  incomplete_count integer;
  cleanup huayi_private.hosted_acceptance_cleanup_obligations%ROWTYPE;
  operation huayi_private.hosted_acceptance_operations%ROWTYPE;
  operation_time timestamptz := clock_timestamp();
  next_cleanup_generation bigint;
  next_operation_generation bigint;
  next_operation_expiry timestamptz;
BEGIN
  IF new_cleanup_token !~ '^[A-Za-z0-9_-]{8,128}$'
    OR new_operation_token !~ '^[A-Za-z0-9_-]{8,128}$'
  THEN RAISE EXCEPTION 'invalid hosted acceptance recovery claim'; END IF;
  SELECT count(*)::integer INTO incomplete_count
  FROM huayi_private.hosted_acceptance_cleanup_obligations obligations
  JOIN huayi_private.hosted_acceptance_operations operations
    ON operations.id = obligations.operation_id
  WHERE obligations.state IS DISTINCT FROM 'completed'
    OR (obligations.state = 'completed' AND operations.state = 'running');
  IF incomplete_count <> 1 THEN
    RAISE EXCEPTION 'hosted acceptance recovery unavailable';
  END IF;
  SELECT obligations.* INTO cleanup
  FROM huayi_private.hosted_acceptance_cleanup_obligations obligations
  JOIN huayi_private.hosted_acceptance_operations operations
    ON operations.id = obligations.operation_id
  WHERE obligations.state IS DISTINCT FROM 'completed'
    OR (obligations.state = 'completed' AND operations.state = 'running')
  FOR UPDATE SKIP LOCKED;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'hosted acceptance recovery unavailable';
  END IF;
  SELECT * INTO operation
  FROM huayi_private.hosted_acceptance_operations operations
  WHERE operations.id = cleanup.operation_id
  FOR UPDATE;
  IF operation.state NOT IN ('running', 'cleanup-pending')
    OR (
      cleanup.state = 'claimed'
      AND cleanup.claim_expires_at > operation_time
    )
    OR (
      operation.state = 'running'
      AND operation.lease_expires_at > operation_time
    )
  THEN RAISE EXCEPTION 'hosted acceptance recovery unavailable'; END IF;

  IF cleanup.state = 'completed' THEN
    next_cleanup_generation := greatest(cleanup.claim_generation, 1);
  ELSE
    next_cleanup_generation := cleanup.claim_generation + 1;
    UPDATE huayi_private.hosted_acceptance_cleanup_obligations
    SET state = 'claimed',
        claim_generation = next_cleanup_generation,
        claim_token_hash = huayi_private.hosted_acceptance_token_hash(new_cleanup_token),
        claim_expires_at = operation_time + interval '60 seconds',
        updated_at = operation_time
    WHERE hosted_acceptance_cleanup_obligations.operation_id = cleanup.operation_id;
  END IF;

  IF operation.state = 'running' THEN
    next_operation_generation := operation.lease_generation + 1;
    next_operation_expiry := operation_time + interval '60 seconds';
    UPDATE huayi_private.hosted_acceptance_operations
    SET lease_generation = next_operation_generation,
        lease_token_hash = huayi_private.hosted_acceptance_token_hash(new_operation_token),
        lease_expires_at = next_operation_expiry,
        updated_at = operation_time
    WHERE hosted_acceptance_operations.id = operation.id;
  ELSE
    next_operation_generation := operation.lease_generation;
    next_operation_expiry := NULL;
  END IF;

  RETURN QUERY SELECT
    operation.id,
    next_cleanup_generation,
    operation_time + interval '60 seconds',
    cleanup.state = 'completed',
    cleanup.armed_at,
    operation.state,
    next_operation_generation,
    next_operation_expiry,
    operation.candidate_commit,
    operation.maximum_reservation_micro_usd,
    operation.owner_user_id,
    operation.payload_digest,
    operation.idempotency_key_hmac,
    operation.idempotency_hmac_context,
    operation.idempotency_hmac_version,
    operation.created_at,
    operation.dispatch_attempted_at IS NOT NULL,
    operation.receipt_digest IS NOT NULL,
    operation.server_request_id,
    operation.api_deployment_id,
    operation.api_source_commit,
    operation.web_deployment_id,
    operation.web_source_commit;
END;
$$;

CREATE FUNCTION huayi_private.complete_hosted_acceptance_cleanup(
  requested_operation_id uuid,
  requested_claim_generation bigint,
  requested_cleanup_token text,
  restoration_observed_at timestamptz
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, huayi_private
AS $$
DECLARE
  cleanup huayi_private.hosted_acceptance_cleanup_obligations%ROWTYPE;
  operation_state text;
  operation_time timestamptz := clock_timestamp();
BEGIN
  SELECT * INTO cleanup
  FROM huayi_private.hosted_acceptance_cleanup_obligations obligations
  WHERE obligations.operation_id = requested_operation_id
  FOR UPDATE;
  SELECT operations.state INTO operation_state
  FROM huayi_private.hosted_acceptance_operations operations
  WHERE operations.id = requested_operation_id
  FOR UPDATE;
  IF requested_claim_generation IS NULL
    OR requested_cleanup_token IS NULL
    OR restoration_observed_at IS NULL
    OR (
      cleanup.state = 'pending'
      AND NOT EXISTS (
        SELECT 1
        FROM huayi_private.hosted_acceptance_operations operations
        WHERE operations.id = requested_operation_id
          AND operations.state = 'running'
          AND operations.lease_generation = requested_claim_generation
          AND operations.lease_token_hash =
            huayi_private.hosted_acceptance_token_hash(requested_cleanup_token)
          AND operations.lease_expires_at > operation_time
      )
    )
    OR (
      cleanup.state = 'claimed'
      AND (
        cleanup.claim_generation IS DISTINCT FROM requested_claim_generation
        OR cleanup.claim_token_hash IS DISTINCT FROM
          huayi_private.hosted_acceptance_token_hash(requested_cleanup_token)
        OR cleanup.claim_expires_at <= operation_time
      )
    )
    OR cleanup.state NOT IN ('pending', 'claimed')
    OR restoration_observed_at < cleanup.armed_at
    OR restoration_observed_at > operation_time
  THEN RAISE EXCEPTION 'hosted acceptance cleanup completion rejected'; END IF;
  UPDATE huayi_private.hosted_acceptance_cleanup_obligations
  SET state = 'completed',
      claim_token_hash = NULL,
      claim_expires_at = NULL,
      completed_at = operation_time,
      updated_at = operation_time
  WHERE operation_id = requested_operation_id;
  IF operation_state = 'cleanup-pending' THEN
    UPDATE huayi_private.hosted_acceptance_operations
    SET state = 'terminal',
        safe_error_code = 'cleanup_pending',
        updated_at = operation_time,
        terminal_at = operation_time
    WHERE id = requested_operation_id;
    operation_state := 'terminal';
  END IF;
  RETURN operation_state;
END;
$$;

CREATE FUNCTION huayi_private.retain_hosted_acceptance_evidence(maximum_rows integer)
RETURNS TABLE(scrubbed_count integer, deleted_count integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, huayi_private
AS $$
DECLARE
  candidate_id uuid;
  operation_time timestamptz := clock_timestamp();
BEGIN
  IF maximum_rows IS NULL OR maximum_rows < 1 OR maximum_rows > 100 THEN
    RAISE EXCEPTION 'invalid hosted acceptance retention batch';
  END IF;
  WITH candidates AS (
    SELECT operations.id
    FROM huayi_private.hosted_acceptance_operations operations
    WHERE operations.state = 'terminal'
      AND operations.identity_scrubbed_at IS NULL
      AND operations.owner_user_id IS NOT NULL
      AND operations.idempotency_key_hmac IS NOT NULL
      AND operations.server_request_id IS NOT NULL
      AND operations.receipt_digest IS NOT NULL
      AND operations.terminal_at <= operation_time - interval '24 hours'
      AND operations.retention_expires_at > operation_time
    ORDER BY operations.terminal_at, operations.id
    LIMIT maximum_rows
    FOR UPDATE SKIP LOCKED
  ), scrubbed AS (
    UPDATE huayi_private.hosted_acceptance_operations operations
    SET owner_user_id = NULL,
        idempotency_key_hmac = NULL,
        idempotency_hmac_context = NULL,
        idempotency_hmac_version = NULL,
        server_request_id = NULL,
        identity_scrubbed_at = operation_time
    FROM candidates
    WHERE operations.id = candidates.id
    RETURNING operations.id
  ) SELECT count(*)::integer INTO scrubbed_count FROM scrubbed;

  deleted_count := 0;
  FOR candidate_id IN
    SELECT operations.id
    FROM huayi_private.hosted_acceptance_operations operations
    LEFT JOIN huayi_private.hosted_acceptance_cleanup_obligations cleanup
      ON cleanup.operation_id = operations.id
    WHERE operations.state = 'terminal'
      AND operations.retention_expires_at <= operation_time
      AND (cleanup.operation_id IS NULL OR cleanup.state = 'completed')
    ORDER BY operations.retention_expires_at, operations.id
    LIMIT greatest(maximum_rows - scrubbed_count, 0)
    FOR UPDATE OF operations SKIP LOCKED
  LOOP
    DELETE FROM huayi_private.hosted_acceptance_cleanup_obligations cleanup
    WHERE cleanup.operation_id = candidate_id
      AND cleanup.state = 'completed';
    DELETE FROM huayi_private.hosted_acceptance_operations operations
    WHERE operations.id = candidate_id;
    IF FOUND THEN deleted_count := deleted_count + 1; END IF;
  END LOOP;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION
  huayi_private.hosted_acceptance_token_hash(text),
  huayi_private.enforce_hosted_acceptance_operation_state()
FROM
  PUBLIC,
  anon,
  authenticated,
  service_role,
  huayi_business,
  huayi_context_setter,
  huayi_runtime,
  huayi_hosted_acceptance_executor;

REVOKE ALL ON FUNCTION
  huayi_private.claim_hosted_acceptance_operation(
    uuid,text,text,bigint,text,text,text,text,text,text,integer,text
  ),
  huayi_private.arm_hosted_acceptance_cleanup(uuid,bigint,text,text),
  huayi_private.mark_hosted_acceptance_dispatch(uuid,bigint,text,text),
  huayi_private.bind_hosted_acceptance_request(uuid,bigint,text,uuid,uuid,text,text),
  huayi_private.record_hosted_acceptance_settlement(uuid,bigint,text,uuid,text),
  huayi_private.complete_hosted_acceptance_operation(uuid,bigint,text,text,text),
  huayi_private.claim_hosted_acceptance_cleanup(text,text),
  huayi_private.complete_hosted_acceptance_cleanup(uuid,bigint,text,timestamptz),
  huayi_private.retain_hosted_acceptance_evidence(integer)
FROM
  PUBLIC,
  anon,
  authenticated,
  service_role,
  huayi_business,
  huayi_context_setter,
  huayi_runtime,
  huayi_hosted_acceptance_executor;

GRANT EXECUTE ON FUNCTION
  huayi_private.claim_hosted_acceptance_operation(
    uuid,text,text,bigint,text,text,text,text,text,text,integer,text
  ),
  huayi_private.arm_hosted_acceptance_cleanup(uuid,bigint,text,text),
  huayi_private.mark_hosted_acceptance_dispatch(uuid,bigint,text,text),
  huayi_private.bind_hosted_acceptance_request(uuid,bigint,text,uuid,uuid,text,text),
  huayi_private.record_hosted_acceptance_settlement(uuid,bigint,text,uuid,text),
  huayi_private.complete_hosted_acceptance_operation(uuid,bigint,text,text,text),
  huayi_private.claim_hosted_acceptance_cleanup(text,text),
  huayi_private.complete_hosted_acceptance_cleanup(uuid,bigint,text,timestamptz),
  huayi_private.retain_hosted_acceptance_evidence(integer)
TO huayi_hosted_acceptance_executor;

COMMIT;
