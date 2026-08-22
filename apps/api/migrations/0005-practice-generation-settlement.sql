BEGIN;

CREATE OR REPLACE FUNCTION public.settle_practice_generation_quota(
  account_user_id uuid, generation_id uuid, reservation_id uuid, ledger_ids uuid[],
  billed_calls jsonb, ledger_outcome text, operation_time timestamptz
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog
AS $$
DECLARE
  task public.practice_generation_tasks%ROWTYPE;
  reserved public.quota_reservations%ROWTYPE;
  billed_call jsonb;
  call_index integer:=0;
  call_cost bigint;
  call_input integer;
  call_cached_input integer;
  call_output integer;
  total_cost bigint:=0;
  ledger_feature text;
BEGIN
  IF huayi_private.current_owner_user_id() IS DISTINCT FROM account_user_id THEN
    RAISE EXCEPTION 'practice owner context required';
  END IF;
  SELECT * INTO task FROM public.practice_generation_tasks tasks
  WHERE tasks.id=generation_id AND tasks.owner_user_id=account_user_id FOR UPDATE;
  IF task.id IS NULL OR task.reservation_id<>reservation_id OR task.price_version_id IS NULL
  THEN RAISE EXCEPTION 'invalid practice generation settlement'; END IF;
  ledger_feature:=CASE task.kind
    WHEN 'sentence-prompt' THEN 'practice.sentence-prompt'
    WHEN 'sentence-feedback' THEN 'practice.sentence-feedback'
    WHEN 'dialogue-start' THEN 'practice.dialogue-start'
    WHEN 'dialogue-assistant' THEN 'practice.dialogue-assistant'
    WHEN 'dialogue-final-feedback' THEN 'practice.dialogue-final-feedback'
    ELSE NULL END;
  IF ledger_feature IS NULL
    OR ledger_outcome='succeeded' AND (task.state<>'ready' OR task.output IS NULL)
    OR ledger_outcome='failed' AND (
      task.state NOT IN ('failed','abandoned') OR task.stable_error_code IS NULL
    )
    OR ledger_outcome NOT IN ('succeeded','failed')
  THEN RAISE EXCEPTION 'invalid practice generation settlement'; END IF;
  SELECT * INTO reserved FROM public.quota_reservations reservations
  WHERE reservations.id=reservation_id FOR UPDATE;
  IF reserved.id IS NULL OR reserved.user_id<>account_user_id
    OR reserved.owner_user_id<>account_user_id OR reserved.request_id<>generation_id
    OR ledger_outcome='succeeded' AND reserved.status<>'active'
    OR ledger_outcome='failed' AND reserved.status NOT IN ('active','released')
    OR jsonb_typeof(billed_calls)<>'array'
    OR jsonb_array_length(billed_calls) NOT BETWEEN 1 AND 2
    OR cardinality(ledger_ids)<>jsonb_array_length(billed_calls)
  THEN RAISE EXCEPTION 'invalid practice generation settlement'; END IF;
  FOR billed_call IN SELECT value FROM jsonb_array_elements(billed_calls)
  LOOP
    call_cost:=(billed_call->>'costMicroUsd')::bigint;
    call_input:=(billed_call->>'inputTokens')::integer;
    call_cached_input:=(billed_call->>'cachedInputTokens')::integer;
    call_output:=(billed_call->>'outputTokens')::integer;
    IF call_cost<0 OR call_input<0 OR call_cached_input<0 OR call_output<0
      OR call_cached_input>call_input
    THEN RAISE EXCEPTION 'invalid practice generation settlement'; END IF;
    total_cost:=total_cost+call_cost;
    INSERT INTO public.usage_ledger(
      id,user_id,owner_user_id,request_id,call_ordinal,period_start,feature,
      price_version_id,cost_micro_usd,outcome,input_tokens,cached_input_tokens,output_tokens
    ) VALUES(
      ledger_ids[call_index+1],account_user_id,account_user_id,generation_id,call_index,
      reserved.period_start,ledger_feature,task.price_version_id,call_cost,ledger_outcome,
      call_input,call_cached_input,call_output
    );
    call_index:=call_index+1;
  END LOOP;
  IF total_cost>reserved.reserved_micro_usd THEN
    RAISE EXCEPTION 'invalid practice generation settlement';
  END IF;
  UPDATE public.quota_reservations SET status='settled',updated_at=operation_time
  WHERE id=reservation_id;
  RETURN reservation_id;
END;
$$;

REVOKE ALL ON FUNCTION public.settle_practice_generation_quota(
  uuid, uuid, uuid, uuid[], jsonb, text, timestamptz
) FROM PUBLIC, huayi_business;
GRANT EXECUTE ON FUNCTION public.settle_practice_generation_quota(
  uuid, uuid, uuid, uuid[], jsonb, text, timestamptz
) TO huayi_context_setter;

COMMIT;
