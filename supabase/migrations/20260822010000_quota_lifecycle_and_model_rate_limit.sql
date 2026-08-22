BEGIN;

CREATE TABLE IF NOT EXISTS model_rate_limit_events (
  owner_user_id uuid NOT NULL REFERENCES user_profiles(user_id) ON DELETE CASCADE,
  request_id uuid PRIMARY KEY,
  occurred_at timestamptz NOT NULL,
  CHECK (request_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS model_rate_limit_events_owner_occurred
  ON model_rate_limit_events(owner_user_id,occurred_at);

CREATE OR REPLACE FUNCTION ensure_owner_current_default_quota(
  account_user_id uuid,
  operation_time timestamptz
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog
AS $$
BEGIN
  IF account_user_id IS NULL
    OR account_user_id IS DISTINCT FROM huayi_private.current_owner_user_id()
  THEN RAISE EXCEPTION 'quota owner mismatch'; END IF;
  RETURN public.ensure_current_default_quota(account_user_id,operation_time);
END;
$$;

CREATE OR REPLACE FUNCTION reserve_quota(
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
  IF EXISTS(
    SELECT 1 FROM public.runtime_controls WHERE name = 'model_kill_switch' AND enabled
  ) THEN RAISE EXCEPTION 'model unavailable'; END IF;

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

ALTER TABLE model_rate_limit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE model_rate_limit_events FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS model_rate_limit_events_owner ON model_rate_limit_events;
CREATE POLICY model_rate_limit_events_owner ON model_rate_limit_events
  USING(owner_user_id=huayi_private.current_owner_user_id())
  WITH CHECK(owner_user_id=huayi_private.current_owner_user_id());

REVOKE ALL ON model_rate_limit_events
FROM PUBLIC,huayi_business,huayi_context_setter,huayi_runtime;
REVOKE ALL ON FUNCTION ensure_owner_current_default_quota(uuid,timestamptz)
FROM PUBLIC,huayi_business,huayi_context_setter,huayi_runtime;
GRANT EXECUTE ON FUNCTION ensure_owner_current_default_quota(uuid,timestamptz)
TO huayi_context_setter;
REVOKE ALL ON FUNCTION reserve_quota(uuid,uuid,uuid,bigint,timestamptz)
FROM PUBLIC,huayi_business,huayi_context_setter,huayi_runtime;
GRANT EXECUTE ON FUNCTION reserve_quota(uuid,uuid,uuid,bigint,timestamptz)
TO huayi_context_setter;

COMMIT;
