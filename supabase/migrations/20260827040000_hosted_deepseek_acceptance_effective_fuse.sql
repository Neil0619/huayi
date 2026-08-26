BEGIN;

CREATE FUNCTION huayi_private.effective_model_kill_switch_enabled()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, huayi_private
AS $$
DECLARE
  control_count integer;
  incomplete_obligation_count integer;
  physical_enabled boolean;
  operation_time timestamptz := statement_timestamp();
  unsafe_obligation_exists boolean;
BEGIN
  SELECT count(*)::integer
  INTO control_count
  FROM public.runtime_controls controls;

  IF control_count <> 1 THEN
    RETURN true;
  END IF;
  SELECT controls.enabled
  INTO physical_enabled
  FROM public.runtime_controls controls
  WHERE controls.name = 'model_kill_switch';
  IF physical_enabled IS NULL THEN
    RETURN true;
  END IF;
  IF physical_enabled THEN
    RETURN true;
  END IF;

  SELECT count(*)::integer
  INTO incomplete_obligation_count
  FROM huayi_private.hosted_acceptance_cleanup_obligations cleanup
  WHERE cleanup.state IS DISTINCT FROM 'completed';
  IF incomplete_obligation_count > 1 THEN
    RETURN true;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM huayi_private.hosted_acceptance_cleanup_obligations cleanup
    LEFT JOIN huayi_private.hosted_acceptance_operations operation
      ON operation.id = cleanup.operation_id
    WHERE (cleanup.state = 'completed' AND operation.state IS DISTINCT FROM 'terminal')
      OR (
        cleanup.state IS DISTINCT FROM 'completed'
        AND (
          cleanup.state = 'pending'
          AND cleanup.desired_kill_switch_enabled
          AND cleanup.armed_at <= operation_time
          AND operation.state = 'running'
          AND operation.lease_expires_at > operation_time
          AND operation.lease_expires_at <= cleanup.armed_at + interval '120 seconds'
        ) IS NOT TRUE
      )
  ) INTO unsafe_obligation_exists;

  RETURN unsafe_obligation_exists;
END;
$$;

CREATE OR REPLACE FUNCTION public.reserve_quota(
  reservation_id uuid,
  account_user_id uuid,
  model_request_id uuid,
  amount_micro_usd bigint,
  reservation_expires_at timestamptz
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog
AS $$
DECLARE
  existing public.quota_reservations%ROWTYPE;
  operation_time timestamptz:=now();
  current_period timestamptz:=
    date_trunc('month',operation_time AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
  allowance bigint;
  committed bigint;
  hourly_count integer;
  daily_count integer;
BEGIN
  IF amount_micro_usd<=0 THEN RAISE EXCEPTION 'invalid reservation'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(account_user_id::text,0));
  SELECT * INTO existing FROM public.quota_reservations WHERE request_id=model_request_id;
  IF existing.id IS NOT NULL THEN
    IF existing.user_id=account_user_id
      AND existing.reserved_micro_usd=amount_micro_usd
      AND existing.status='active'
      AND existing.expires_at>operation_time
    THEN RETURN existing.id; END IF;
    RAISE EXCEPTION 'idempotency conflict';
  END IF;
  IF huayi_private.effective_model_kill_switch_enabled()
  THEN RAISE EXCEPTION 'model unavailable'; END IF;

  PERFORM public.ensure_current_default_quota(account_user_id,operation_time);
  PERFORM public.release_expired_quota_reservations(account_user_id);
  SELECT limit_micro_usd INTO allowance FROM public.quota_grants
  WHERE user_id=account_user_id AND period_start=current_period AND superseded_at IS NULL;
  SELECT
    COALESCE((SELECT sum(cost_micro_usd) FROM public.usage_ledger
      WHERE user_id=account_user_id AND period_start=current_period),0)+
    COALESCE((SELECT sum(reserved_micro_usd) FROM public.quota_reservations
      WHERE user_id=account_user_id AND period_start=current_period AND status='active'),0)
  INTO committed;
  IF allowance IS NULL OR committed+amount_micro_usd>allowance THEN
    RAISE EXCEPTION 'quota exhausted';
  END IF;

  DELETE FROM public.model_rate_limit_events
  WHERE owner_user_id=account_user_id AND occurred_at<=operation_time-interval '24 hours';
  SELECT count(*) FILTER(WHERE occurred_at>operation_time-interval '1 hour'),count(*)
  INTO hourly_count,daily_count
  FROM public.model_rate_limit_events
  WHERE owner_user_id=account_user_id AND occurred_at>operation_time-interval '24 hours';
  IF hourly_count>=60 OR daily_count>=300 THEN RAISE EXCEPTION 'model rate limited'; END IF;

  INSERT INTO public.model_rate_limit_events(owner_user_id,request_id,occurred_at)
  VALUES(account_user_id,model_request_id,operation_time);
  INSERT INTO public.quota_reservations(
    id,user_id,owner_user_id,request_id,period_start,reserved_micro_usd,status,expires_at
  ) VALUES(
    reservation_id,account_user_id,account_user_id,model_request_id,current_period,
    amount_micro_usd,'active',reservation_expires_at
  );
  RETURN reservation_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_usage_summary(
  actor_user_id uuid, period_start timestamptz, period_end timestamptz
) RETURNS TABLE(
  active_accounts bigint, disabled_accounts bigint, deleting_accounts bigint,
  limit_micro_usd bigint, used_micro_usd bigint, reserved_micro_usd bigint,
  succeeded_calls bigint, failed_calls bigint, succeeded_requests bigint,
  failed_requests bigint, repaired_requests bigint, p95_latency_ms bigint,
  kill_switch_enabled boolean, kill_switch_updated_at timestamptz
) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF public.require_admin_operator(actor_user_id) IS DISTINCT FROM 'operator'
  THEN RAISE EXCEPTION 'administrator required'; END IF;
  RETURN QUERY SELECT
    (SELECT count(*) FROM public.user_profiles WHERE status='active'),
    (SELECT count(*) FROM public.user_profiles WHERE status='disabled'),
    (SELECT count(*) FROM public.user_profiles WHERE status='deleting'),
    COALESCE((SELECT sum(grants.limit_micro_usd) FROM public.quota_grants grants
      WHERE grants.period_start=admin_usage_summary.period_start
        AND grants.superseded_at IS NULL),0)::bigint,
    COALESCE((SELECT sum(ledger.cost_micro_usd) FROM public.usage_ledger ledger
      WHERE ledger.period_start=admin_usage_summary.period_start),0)::bigint,
    COALESCE((SELECT sum(reservations.reserved_micro_usd)
      FROM public.quota_reservations reservations
      WHERE reservations.period_start=admin_usage_summary.period_start
        AND reservations.status='active' AND reservations.expires_at>now()),0)::bigint,
    (SELECT count(*) FROM public.usage_ledger ledger
      WHERE ledger.period_start=admin_usage_summary.period_start AND outcome='succeeded'),
    (SELECT count(*) FROM public.usage_ledger ledger
      WHERE ledger.period_start=admin_usage_summary.period_start AND outcome='failed'),
    (SELECT count(*) FROM public.analysis_requests requests
      WHERE requests.updated_at>=admin_usage_summary.period_start
        AND requests.updated_at<admin_usage_summary.period_end AND state='completed'),
    (SELECT count(*) FROM public.analysis_requests requests
      WHERE requests.updated_at>=admin_usage_summary.period_start
        AND requests.updated_at<admin_usage_summary.period_end AND state='failed'),
    (SELECT count(DISTINCT ledger.request_id) FROM public.usage_ledger ledger
      JOIN public.analysis_requests requests ON requests.id=ledger.request_id
      WHERE ledger.period_start=admin_usage_summary.period_start AND ledger.call_ordinal>0
        AND requests.updated_at>=admin_usage_summary.period_start
        AND requests.updated_at<admin_usage_summary.period_end
        AND requests.state IN ('completed','failed')),
    COALESCE((SELECT percentile_disc(0.95) WITHIN GROUP (
      ORDER BY floor(extract(epoch FROM (requests.updated_at-requests.created_at))*1000)::bigint
    ) FROM public.analysis_requests requests
      WHERE requests.updated_at>=admin_usage_summary.period_start
        AND requests.updated_at<admin_usage_summary.period_end
        AND requests.state IN ('completed','failed')),0),
    huayi_private.effective_model_kill_switch_enabled(),
    COALESCE((SELECT updated_at FROM public.runtime_controls
      WHERE name='model_kill_switch'),admin_usage_summary.period_start);
END;
$$;

REVOKE ALL ON FUNCTION huayi_private.effective_model_kill_switch_enabled()
FROM PUBLIC, anon, authenticated, service_role, huayi_business, huayi_context_setter,
  huayi_runtime, huayi_hosted_acceptance_executor;
REVOKE ALL ON FUNCTION public.reserve_quota(uuid,uuid,uuid,bigint,timestamptz)
FROM PUBLIC, anon, authenticated, service_role, huayi_business, huayi_context_setter,
  huayi_runtime, huayi_hosted_acceptance_executor;
GRANT EXECUTE ON FUNCTION public.reserve_quota(uuid,uuid,uuid,bigint,timestamptz)
TO huayi_context_setter;
REVOKE ALL ON FUNCTION public.admin_usage_summary(uuid,timestamptz,timestamptz)
FROM PUBLIC, anon, authenticated, service_role, huayi_business, huayi_context_setter,
  huayi_runtime, huayi_hosted_acceptance_executor;
GRANT EXECUTE ON FUNCTION public.admin_usage_summary(uuid,timestamptz,timestamptz)
TO huayi_context_setter;

COMMIT;
