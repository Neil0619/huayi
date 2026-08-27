BEGIN;

DO $unsafe_receipt$
BEGIN
  IF EXISTS (
    SELECT 1 FROM huayi_private.hosted_acceptance_operations
    WHERE receipt_digest IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'hosted acceptance evidence upgrade requires no existing receipt';
  END IF;
END;
$unsafe_receipt$;

ALTER TABLE huayi_private.hosted_acceptance_operations
  ADD COLUMN receipt_evidence jsonb,
  ADD CONSTRAINT hosted_acceptance_receipt_evidence_shape CHECK (
    receipt_evidence IS NULL OR receipt_digest IS NOT NULL
  );

CREATE FUNCTION huayi_private.enforce_hosted_acceptance_receipt_evidence()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, huayi_private
AS $$
BEGIN
  IF OLD.receipt_evidence IS NOT NULL
    AND NEW.receipt_evidence IS DISTINCT FROM OLD.receipt_evidence
  THEN
    IF OLD.identity_scrubbed_at IS NOT NULL
      OR NEW.identity_scrubbed_at IS NULL
      OR NEW.receipt_evidence IS NOT NULL
      OR NEW.owner_user_id IS NOT NULL
      OR NEW.idempotency_key_hmac IS NOT NULL
      OR NEW.server_request_id IS NOT NULL
    THEN
      RAISE EXCEPTION 'hosted acceptance receipt evidence is immutable';
    END IF;
  ELSIF OLD.receipt_evidence IS NULL AND NEW.receipt_evidence IS NOT NULL THEN
    IF NEW.identity_scrubbed_at IS NOT NULL
      OR NEW.receipt_digest IS NULL
      OR NEW.server_request_id IS NULL
      OR NEW.state IS DISTINCT FROM 'running'
    THEN
      RAISE EXCEPTION 'invalid hosted acceptance receipt evidence';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER hosted_acceptance_receipt_evidence_guard
BEFORE UPDATE ON huayi_private.hosted_acceptance_operations
FOR EACH ROW EXECUTE FUNCTION huayi_private.enforce_hosted_acceptance_receipt_evidence();

CREATE OR REPLACE FUNCTION huayi_private.bind_hosted_acceptance_request(
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
    OR (operation.server_request_id IS NOT NULL
      AND operation.server_request_id IS DISTINCT FROM requested_server_request_id)
    OR request_owner_id IS DISTINCT FROM operation.owner_user_id
    OR request_idempotency_key IS DISTINCT FROM requested_idempotency_key
    OR request_hash IS DISTINCT FROM operation.payload_digest
  THEN RAISE EXCEPTION 'hosted acceptance request binding rejected'; END IF;
  IF operation.server_request_id IS NULL THEN
    UPDATE huayi_private.hosted_acceptance_operations
    SET server_request_id = requested_server_request_id, updated_at = operation_time
    WHERE id = requested_operation_id;
  END IF;
  RETURN requested_server_request_id;
END;
$$;

CREATE FUNCTION huayi_private.reconcile_and_bind_hosted_acceptance_request(
  requested_operation_id uuid,
  requested_lease_generation bigint,
  requested_lease_token text,
  requested_owner_user_id uuid,
  requested_idempotency_key text,
  requested_payload_digest text
) RETURNS TABLE(request_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, huayi_private
AS $$
DECLARE
  operation huayi_private.hosted_acceptance_operations%ROWTYPE;
  match_count integer;
  matched_request_id uuid;
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
    OR operation.dispatch_attempted_at IS NULL
    OR operation.owner_user_id IS DISTINCT FROM requested_owner_user_id
    OR operation.payload_digest IS DISTINCT FROM requested_payload_digest
    OR requested_idempotency_key !~ '^[A-Za-z0-9._:-]{8,128}$'
  THEN RAISE EXCEPTION 'hosted acceptance reconciliation rejected'; END IF;

  SELECT count(*)::integer, min(requests.id::text)::uuid
  INTO match_count, matched_request_id
  FROM public.analysis_requests requests
  WHERE requests.owner_user_id = operation.owner_user_id
    AND requests.idempotency_key = requested_idempotency_key
    AND requests.request_hash = operation.payload_digest;
  IF match_count <> 1
    OR matched_request_id IS NULL
    OR (operation.server_request_id IS NOT NULL
      AND operation.server_request_id IS DISTINCT FROM matched_request_id)
  THEN RAISE EXCEPTION 'hosted acceptance reconciliation rejected'; END IF;
  IF operation.server_request_id IS NULL THEN
    UPDATE huayi_private.hosted_acceptance_operations
    SET server_request_id = matched_request_id, updated_at = operation_time
    WHERE id = requested_operation_id;
  END IF;
  RETURN QUERY SELECT matched_request_id;
END;
$$;

CREATE FUNCTION huayi_private.read_and_freeze_hosted_acceptance_settlement(
  requested_operation_id uuid,
  requested_lease_generation bigint,
  requested_lease_token text,
  requested_server_request_id uuid
) RETURNS TABLE(receipt jsonb, receipt_digest text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, huayi_private
AS $$
DECLARE
  operation huayi_private.hosted_acceptance_operations%ROWTYPE;
  request public.analysis_requests%ROWTYPE;
  reservation public.quota_reservations%ROWTYPE;
  price public.model_price_versions%ROWTYPE;
  record public.analysis_records%ROWTYPE;
  operation_time timestamptz := clock_timestamp();
  application_request_count integer;
  ledger_count integer;
  ledger_min_ordinal integer;
  ledger_max_ordinal integer;
  ledger_distinct_ordinals integer;
  ledger_contract boolean;
  ledger_entries jsonb;
  ledger_input_tokens bigint;
  ledger_output_tokens bigint;
  ledger_cost_micro_usd bigint;
  price_slot text;
  receipt_candidate jsonb;
  frozen_digest text;
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
    OR operation.dispatch_attempted_at IS NULL
    OR operation.server_request_id IS DISTINCT FROM requested_server_request_id
  THEN RAISE EXCEPTION 'hosted acceptance settlement rejected'; END IF;

  SELECT * INTO request FROM public.analysis_requests
  WHERE id = requested_server_request_id;
  SELECT * INTO reservation FROM public.quota_reservations
  WHERE id = request.reservation_id
    AND request_id = request.id
    AND owner_user_id = request.owner_user_id;
  SELECT * INTO price FROM public.model_price_versions WHERE id = request.price_version_id;
  SELECT * INTO record FROM public.analysis_records
  WHERE id::text = request.terminal_event #>> '{analysis,id}'
    AND owner_user_id = request.owner_user_id;
  SELECT count(*)::integer INTO application_request_count
  FROM public.analysis_requests requests
  WHERE requests.owner_user_id = operation.owner_user_id
    AND requests.idempotency_key = request.idempotency_key
    AND requests.request_hash = operation.payload_digest;
  SELECT count(*)::integer, min(ledger.call_ordinal), max(ledger.call_ordinal),
    count(DISTINCT ledger.call_ordinal)::integer,
    COALESCE(bool_and(
      ledger.user_id = operation.owner_user_id
      AND ledger.owner_user_id = operation.owner_user_id
      AND ledger.feature = 'analysis'
      AND ledger.price_version_id = request.price_version_id
      AND ledger.outcome = 'succeeded'
      AND ledger.input_tokens > 0
      AND ledger.cached_input_tokens >= 0
      AND ledger.cached_input_tokens <= ledger.input_tokens
      AND ledger.output_tokens > 0
      AND ledger.cost_micro_usd =
        ceil(((ledger.input_tokens-ledger.cached_input_tokens)::numeric
          * price.input_micro_usd_per_million)/1000000)::bigint
        + ceil((ledger.cached_input_tokens::numeric
          * price.cached_input_micro_usd_per_million)/1000000)::bigint
        + ceil((ledger.output_tokens::numeric
          * price.output_micro_usd_per_million)/1000000)::bigint
    ), false),
    jsonb_agg(jsonb_build_object(
      'cachedInputTokens',ledger.cached_input_tokens,
      'callOrdinal',ledger.call_ordinal,
      'costMicroUsd',ledger.cost_micro_usd,
      'id',ledger.id::text,
      'inputTokens',ledger.input_tokens,
      'outcome',ledger.outcome,
      'outputTokens',ledger.output_tokens,
      'ownerId',ledger.owner_user_id::text,
      'priceVersionId',ledger.price_version_id::text,
      'requestId',ledger.request_id::text
    ) ORDER BY ledger.call_ordinal),
    COALESCE(sum(ledger.input_tokens),0)::bigint,
    COALESCE(sum(ledger.output_tokens),0)::bigint,
    COALESCE(sum(ledger.cost_micro_usd),0)::bigint
  INTO ledger_count, ledger_min_ordinal, ledger_max_ordinal, ledger_distinct_ordinals,
    ledger_contract, ledger_entries, ledger_input_tokens, ledger_output_tokens,
    ledger_cost_micro_usd
  FROM public.usage_ledger ledger
  WHERE ledger.request_id = request.id;

  price_slot := CASE
    WHEN price.id = '8a7c5397-dbba-4e28-bc0d-107c4d04c3c3'::uuid
      AND ROW(price.input_micro_usd_per_million,price.cached_input_micro_usd_per_million,
        price.output_micro_usd_per_million,price.effective_from)
      = ROW(140000::bigint,2800::bigint,280000::bigint,
        '2026-08-16T15:59:59Z'::timestamptz) THEN 'legacy'
    WHEN price.id = 'dad0deb1-cbdc-4311-b3ad-b492c7ece757'::uuid
      AND ROW(price.input_micro_usd_per_million,price.cached_input_micro_usd_per_million,
        price.output_micro_usd_per_million,price.effective_from)
      = ROW(220000::bigint,7000::bigint,660000::bigint,
        '2026-08-16T16:00:00Z'::timestamptz) THEN 'off-peak'
    WHEN price.id = 'e4479ddf-f4da-4a75-825a-2b25c1a145cf'::uuid
      AND ROW(price.input_micro_usd_per_million,price.cached_input_micro_usd_per_million,
        price.output_micro_usd_per_million,price.effective_from)
      = ROW(440000::bigint,14000::bigint,1320000::bigint,
        '2026-08-16T16:00:01Z'::timestamptz) THEN 'peak'
    ELSE NULL
  END;

  IF request.id IS NULL
    OR request.owner_user_id IS DISTINCT FROM operation.owner_user_id
    OR request.request_hash IS DISTINCT FROM operation.payload_digest
    OR request.state IS DISTINCT FROM 'completed'
    OR request.terminal_event->>'type' IS DISTINCT FROM 'analysis.completed'
    OR request.dispatched_at IS NULL
    OR request.updated_at < operation.dispatch_attempted_at
    OR request.updated_at > operation.dispatch_attempted_at + interval '90 seconds'
    OR application_request_count <> 1
    OR reservation.id IS NULL
    OR reservation.user_id IS DISTINCT FROM operation.owner_user_id
    OR reservation.owner_user_id IS DISTINCT FROM operation.owner_user_id
    OR reservation.status IS DISTINCT FROM 'settled'
    OR reservation.reserved_micro_usd > operation.maximum_reservation_micro_usd
    OR price.id IS NULL
    OR price.provider IS DISTINCT FROM 'deepseek'
    OR price.model IS DISTINCT FROM 'deepseek-v4-flash'
    OR price_slot IS NULL
    OR record.id IS NULL
    OR record.model_metadata->>'provider' IS DISTINCT FROM 'deepseek'
    OR record.model_metadata->>'model' IS DISTINCT FROM 'deepseek-v4-flash'
    OR record.model_metadata->>'promptVersion' IS DISTINCT FROM 'web-deep-analysis-v2'
    OR record.model_metadata->'schemaVersion' IS DISTINCT FROM '2'::jsonb
    OR record.model_metadata->'inputTokens' IS DISTINCT FROM to_jsonb(ledger_input_tokens)
    OR record.model_metadata->'outputTokens' IS DISTINCT FROM to_jsonb(ledger_output_tokens)
    OR ledger_count NOT BETWEEN 1 AND 2
    OR ledger_min_ordinal <> 0
    OR ledger_max_ordinal <> ledger_count - 1
    OR ledger_distinct_ordinals <> ledger_count
    OR NOT ledger_contract
    OR ledger_cost_micro_usd <= 0
    OR ledger_cost_micro_usd > reservation.reserved_micro_usd
  THEN RAISE EXCEPTION 'hosted acceptance settlement rejected'; END IF;

  receipt_candidate := jsonb_build_object(
    'applicationRequestCount',application_request_count,
    'billedCallCount',ledger_count,
    'deadlineClassification','completed-within-90-seconds',
    'deployments',jsonb_build_object(
      'api',jsonb_build_object('commit',operation.api_source_commit,
        'deploymentId',operation.api_deployment_id,'state','READY'),
      'web',jsonb_build_object('commit',operation.web_source_commit,
        'deploymentId',operation.web_deployment_id,'state','READY')
    ),
    'ledgerEntries',ledger_entries,
    'model','deepseek-v4-flash',
    'observedAt',to_char(request.updated_at AT TIME ZONE 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'payloadDigest',operation.payload_digest,
    'priceVersionId',price.id::text,
    'priceVersionSlot',price_slot,
    'request',jsonb_build_object('operationId',operation.id::text,
      'ownerId',operation.owner_user_id::text,'requestId',request.id::text),
    'reservationMicroUsd',reservation.reserved_micro_usd,
    'reservationStatus',reservation.status,
    'settlementSource','server-authority',
    'terminalState',request.state
  );
  frozen_digest := encode(sha256(convert_to(receipt_candidate::text,'UTF8')), 'hex');
  IF operation.receipt_digest IS NOT NULL THEN
    IF operation.receipt_digest IS DISTINCT FROM frozen_digest
      OR operation.receipt_evidence IS DISTINCT FROM receipt_candidate
    THEN RAISE EXCEPTION 'hosted acceptance settlement rejected'; END IF;
  ELSE
    UPDATE huayi_private.hosted_acceptance_operations
    SET receipt_evidence = receipt_candidate,
        receipt_digest = frozen_digest,
        updated_at = operation_time
    WHERE id = requested_operation_id;
  END IF;
  RETURN QUERY SELECT receipt_candidate, frozen_digest;
END;
$$;

DROP FUNCTION huayi_private.record_hosted_acceptance_settlement(uuid,bigint,text,uuid,text);
CREATE FUNCTION huayi_private.record_hosted_acceptance_settlement(
  requested_operation_id uuid,
  requested_lease_generation bigint,
  requested_lease_token text,
  requested_server_request_id uuid
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, huayi_private
AS $$
BEGIN
  PERFORM * FROM huayi_private.read_and_freeze_hosted_acceptance_settlement(
    requested_operation_id,
    requested_lease_generation,
    requested_lease_token,
    requested_server_request_id
  );
  RETURN requested_server_request_id;
END;
$$;

CREATE OR REPLACE FUNCTION huayi_private.retain_hosted_acceptance_evidence(maximum_rows integer)
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
      AND operations.receipt_evidence IS NOT NULL
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
        receipt_evidence = NULL,
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
    WHERE cleanup.operation_id = candidate_id AND cleanup.state = 'completed';
    DELETE FROM huayi_private.hosted_acceptance_operations operations
    WHERE operations.id = candidate_id;
    IF FOUND THEN deleted_count := deleted_count + 1; END IF;
  END LOOP;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION
  huayi_private.enforce_hosted_acceptance_receipt_evidence()
FROM PUBLIC,anon,authenticated,service_role,huayi_business,huayi_context_setter,
  huayi_runtime,huayi_hosted_acceptance_executor;

REVOKE ALL ON FUNCTION
  huayi_private.reconcile_and_bind_hosted_acceptance_request(uuid,bigint,text,uuid,text,text),
  huayi_private.read_and_freeze_hosted_acceptance_settlement(uuid,bigint,text,uuid),
  huayi_private.record_hosted_acceptance_settlement(uuid,bigint,text,uuid)
FROM PUBLIC,anon,authenticated,service_role,huayi_business,huayi_context_setter,
  huayi_runtime,huayi_hosted_acceptance_executor;

GRANT EXECUTE ON FUNCTION
  huayi_private.reconcile_and_bind_hosted_acceptance_request(uuid,bigint,text,uuid,text,text),
  huayi_private.read_and_freeze_hosted_acceptance_settlement(uuid,bigint,text,uuid),
  huayi_private.record_hosted_acceptance_settlement(uuid,bigint,text,uuid)
TO huayi_hosted_acceptance_executor;

COMMIT;
