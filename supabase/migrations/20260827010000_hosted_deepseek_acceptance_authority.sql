BEGIN;

CREATE ROLE huayi_hosted_acceptance_executor NOLOGIN NOINHERIT NOBYPASSRLS;
REVOKE ALL ON SCHEMA huayi_private FROM huayi_hosted_acceptance_executor;
GRANT USAGE ON SCHEMA huayi_private TO huayi_hosted_acceptance_executor;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA huayi_private
REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

CREATE TABLE huayi_private.hosted_acceptance_operations (
  id uuid PRIMARY KEY,
  approval_digest text NOT NULL UNIQUE CHECK (approval_digest ~ '^[0-9a-f]{64}$'),
  candidate_commit text NOT NULL CHECK (candidate_commit ~ '^[0-9a-f]{40}$'),
  maximum_reservation_micro_usd bigint NOT NULL CHECK (maximum_reservation_micro_usd > 0),
  payload_digest text NOT NULL CHECK (payload_digest ~ '^[0-9a-f]{64}$'),
  api_deployment_id text NOT NULL CHECK (api_deployment_id ~ '^dpl_[A-Za-z0-9]+$'),
  api_source_commit text NOT NULL CHECK (api_source_commit ~ '^[0-9a-f]{40}$'),
  web_deployment_id text NOT NULL CHECK (web_deployment_id ~ '^dpl_[A-Za-z0-9]+$'),
  web_source_commit text NOT NULL CHECK (web_source_commit ~ '^[0-9a-f]{40}$'),
  state text NOT NULL DEFAULT 'ready'
    CHECK (state IN ('ready', 'running', 'cleanup-pending', 'terminal')),
  owner_user_id uuid,
  idempotency_key_hmac text CHECK (
    idempotency_key_hmac IS NULL OR idempotency_key_hmac ~ '^[0-9a-f]{64}$'
  ),
  dispatch_attempted_at timestamptz,
  server_request_id uuid UNIQUE,
  receipt_digest text CHECK (receipt_digest IS NULL OR receipt_digest ~ '^[0-9a-f]{64}$'),
  lease_generation bigint NOT NULL DEFAULT 0 CHECK (lease_generation >= 0),
  lease_token_hash text CHECK (
    lease_token_hash IS NULL OR lease_token_hash ~ '^[0-9a-f]{64}$'
  ),
  lease_expires_at timestamptz,
  safe_error_code text CHECK (
    safe_error_code IS NULL OR safe_error_code IN (
      'approval_invalid',
      'deployment_untrusted',
      'lease_lost',
      'recent_auth_failed',
      'fuse_failed',
      'dispatch_uncertain',
      'stream_invalid',
      'receipt_invalid',
      'cleanup_pending',
      'internal_safe_failure'
    )
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  terminal_at timestamptz,
  retention_expires_at timestamptz NOT NULL DEFAULT (now() + interval '90 days'),
  CONSTRAINT hosted_acceptance_deployment_pair_check CHECK (
    api_deployment_id <> web_deployment_id
  ),
  CONSTRAINT hosted_acceptance_owner_idempotency_pair_check CHECK (
    (owner_user_id IS NULL) = (idempotency_key_hmac IS NULL)
  ),
  CONSTRAINT hosted_acceptance_dispatch_evidence_check CHECK (
    dispatch_attempted_at IS NULL OR owner_user_id IS NOT NULL
  ),
  CONSTRAINT hosted_acceptance_request_evidence_check CHECK (
    server_request_id IS NULL OR dispatch_attempted_at IS NOT NULL
  ),
  CONSTRAINT hosted_acceptance_receipt_evidence_check CHECK (
    receipt_digest IS NULL OR server_request_id IS NOT NULL
  ),
  CONSTRAINT hosted_acceptance_lease_state_check CHECK (
    (state = 'ready' AND lease_generation = 0
      AND lease_token_hash IS NULL AND lease_expires_at IS NULL)
    OR (state = 'running' AND lease_generation >= 1
      AND lease_token_hash IS NOT NULL AND lease_expires_at IS NOT NULL)
    OR (state = 'cleanup-pending' AND lease_generation >= 1
      AND lease_token_hash IS NULL AND lease_expires_at IS NULL)
    OR (state = 'terminal' AND lease_token_hash IS NULL AND lease_expires_at IS NULL)
  ),
  CONSTRAINT hosted_acceptance_terminal_time_check CHECK (
    (state = 'terminal') = (terminal_at IS NOT NULL)
  ),
  CONSTRAINT hosted_acceptance_time_order_check CHECK (
    updated_at >= created_at
    AND (terminal_at IS NULL OR terminal_at >= created_at)
    AND retention_expires_at = created_at + interval '90 days'
  )
);

CREATE UNIQUE INDEX hosted_acceptance_one_non_terminal_operation
  ON huayi_private.hosted_acceptance_operations ((true))
  WHERE state <> 'terminal';
CREATE UNIQUE INDEX hosted_acceptance_one_idempotency_hmac
  ON huayi_private.hosted_acceptance_operations (idempotency_key_hmac)
  WHERE idempotency_key_hmac IS NOT NULL;

CREATE TABLE huayi_private.hosted_acceptance_cleanup_obligations (
  operation_id uuid PRIMARY KEY
    REFERENCES huayi_private.hosted_acceptance_operations(id) ON DELETE RESTRICT,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'claimed', 'completed')),
  desired_kill_switch_enabled boolean NOT NULL DEFAULT true
    CHECK (desired_kill_switch_enabled),
  claim_generation bigint NOT NULL DEFAULT 0 CHECK (claim_generation >= 0),
  claim_token_hash text CHECK (
    claim_token_hash IS NULL OR claim_token_hash ~ '^[0-9a-f]{64}$'
  ),
  claim_expires_at timestamptz,
  armed_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hosted_acceptance_cleanup_claim_state_check CHECK (
    (state = 'pending' AND claim_generation = 0
      AND claim_token_hash IS NULL AND claim_expires_at IS NULL)
    OR (state = 'claimed' AND claim_generation >= 1
      AND claim_token_hash IS NOT NULL AND claim_expires_at IS NOT NULL)
    OR (state = 'completed' AND claim_token_hash IS NULL AND claim_expires_at IS NULL)
  ),
  CONSTRAINT hosted_acceptance_cleanup_time_check CHECK (
    updated_at >= armed_at
    AND (state = 'completed') = (completed_at IS NOT NULL)
    AND (completed_at IS NULL OR completed_at >= armed_at)
  )
);

CREATE INDEX hosted_acceptance_cleanup_claim_index
  ON huayi_private.hosted_acceptance_cleanup_obligations (
    state,
    claim_expires_at,
    armed_at,
    operation_id
  );

CREATE FUNCTION huayi_private.enforce_hosted_acceptance_operation_state()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, huayi_private
AS $$
DECLARE
  old_state_rank integer;
  new_state_rank integer;
BEGIN
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
  IF (
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

CREATE TRIGGER hosted_acceptance_operation_state_guard
BEFORE UPDATE ON huayi_private.hosted_acceptance_operations
FOR EACH ROW EXECUTE FUNCTION huayi_private.enforce_hosted_acceptance_operation_state();

CREATE FUNCTION huayi_private.enforce_hosted_acceptance_cleanup_state()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, huayi_private
AS $$
DECLARE
  old_state_rank integer;
  new_state_rank integer;
BEGIN
  IF NEW.operation_id IS DISTINCT FROM OLD.operation_id
    OR NEW.desired_kill_switch_enabled IS DISTINCT FROM OLD.desired_kill_switch_enabled
    OR NEW.armed_at IS DISTINCT FROM OLD.armed_at
  THEN
    RAISE EXCEPTION 'hosted acceptance cleanup identity is immutable';
  END IF;

  old_state_rank := CASE OLD.state
    WHEN 'pending' THEN 0
    WHEN 'claimed' THEN 1
    WHEN 'completed' THEN 2
    ELSE NULL
  END;
  new_state_rank := CASE NEW.state
    WHEN 'pending' THEN 0
    WHEN 'claimed' THEN 1
    WHEN 'completed' THEN 2
    ELSE NULL
  END;
  IF old_state_rank IS NULL OR new_state_rank IS NULL OR new_state_rank < old_state_rank THEN
    RAISE EXCEPTION 'invalid hosted acceptance cleanup state transition';
  END IF;
  IF OLD.state = 'completed' THEN
    RAISE EXCEPTION 'completed hosted acceptance cleanup is immutable';
  END IF;
  IF NEW.state = 'claimed' THEN
    IF NEW.state IS DISTINCT FROM OLD.state
      OR ROW(NEW.claim_generation, NEW.claim_token_hash, NEW.claim_expires_at)
        IS DISTINCT FROM ROW(
          OLD.claim_generation,
          OLD.claim_token_hash,
          OLD.claim_expires_at
        )
    THEN
      IF NEW.claim_generation <> OLD.claim_generation + 1
        OR ROW(NEW.claim_token_hash, NEW.claim_expires_at)
          IS NOT DISTINCT FROM ROW(OLD.claim_token_hash, OLD.claim_expires_at)
      THEN
        RAISE EXCEPTION 'hosted acceptance cleanup claim is not fenced';
      END IF;
    END IF;
  ELSIF NEW.claim_generation IS DISTINCT FROM OLD.claim_generation THEN
    RAISE EXCEPTION 'stale hosted acceptance cleanup claim generation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER hosted_acceptance_cleanup_state_guard
BEFORE UPDATE ON huayi_private.hosted_acceptance_cleanup_obligations
FOR EACH ROW EXECUTE FUNCTION huayi_private.enforce_hosted_acceptance_cleanup_state();

ALTER TABLE huayi_private.hosted_acceptance_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE huayi_private.hosted_acceptance_operations FORCE ROW LEVEL SECURITY;
ALTER TABLE huayi_private.hosted_acceptance_cleanup_obligations ENABLE ROW LEVEL SECURITY;
ALTER TABLE huayi_private.hosted_acceptance_cleanup_obligations FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE
  huayi_private.hosted_acceptance_operations,
  huayi_private.hosted_acceptance_cleanup_obligations
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
  huayi_private.enforce_hosted_acceptance_operation_state(),
  huayi_private.enforce_hosted_acceptance_cleanup_state()
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
