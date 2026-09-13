BEGIN;

ALTER TABLE public.practice_sessions ADD COLUMN reference_state jsonb
  CHECK (reference_state IS NULL OR (type='sentence-creation' AND jsonb_typeof(reference_state)='object'
    AND reference_state->>'version'='1' AND octet_length(reference_state::text)<=16384));
ALTER TABLE public.practice_generation_tasks DROP CONSTRAINT practice_generation_tasks_kind_check;
ALTER TABLE public.practice_generation_tasks ADD CONSTRAINT practice_generation_tasks_kind_check
  CHECK (kind IN ('sentence-prompt','sentence-feedback','sentence-reference','dialogue-start','dialogue-assistant','dialogue-final-feedback'));

-- A different task cannot reuse an old reference, including writes from older clients.
CREATE FUNCTION huayi_private.invalidate_practice_reference() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE retired uuid[];
BEGIN
  IF NEW.prompt IS DISTINCT FROM OLD.prompt OR NEW.workspace_state->>'mode' IS DISTINCT FROM OLD.workspace_state->>'mode'
    THEN NEW.reference_state:=NULL; END IF;
  -- Only work that has not reached the provider can be retired without billing.
  -- The session row is already locked; fence generation before releasing its reservation.
  IF (OLD.reference_state IS NOT NULL AND NEW.reference_state IS NULL)
    OR NEW.workspace_state->>'phase' IN ('ended','skipped') THEN
    WITH stopped AS (
      UPDATE public.practice_generation_tasks SET state='failed',stable_error_code='model_unavailable',updated_at=now()
      WHERE session_id=OLD.id AND owner_user_id=OLD.owner_user_id AND kind='sentence-reference'
        AND state IN ('claimed','reserved') RETURNING id
    ) SELECT array_agg(id) INTO retired FROM stopped;
    UPDATE public.quota_reservations SET status='released',updated_at=now()
      WHERE owner_user_id=OLD.owner_user_id AND request_id=ANY(retired) AND status='active';
    IF NEW.current_generation_id=ANY(retired) THEN NEW.current_generation_id:=NULL; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER invalidate_practice_reference BEFORE UPDATE ON public.practice_sessions
  FOR EACH ROW EXECUTE FUNCTION huayi_private.invalidate_practice_reference();
REVOKE ALL ON FUNCTION huayi_private.invalidate_practice_reference() FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION huayi_private.erase_learning_item_reference() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN
  UPDATE public.practice_sessions SET reference_state=NULL WHERE id IN (
    SELECT session_id FROM public.practice_session_items WHERE learning_item_id=NEW.id
  );
  RETURN NEW;
END $$;
CREATE TRIGGER erase_learning_item_reference AFTER UPDATE OF deleted_at ON public.learning_items
  FOR EACH ROW WHEN (NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL)
  EXECUTE FUNCTION huayi_private.erase_learning_item_reference();
REVOKE ALL ON FUNCTION huayi_private.erase_learning_item_reference() FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION huayi_private.enqueue_learning_task(owner_id uuid, task_id uuid, request_key text, request_digest text, task_command jsonb)
RETURNS public.learning_tasks LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE job public.learning_tasks; receipt public.learning_task_submission_keys; category text; subject uuid;
BEGIN
  IF owner_id IS NULL OR task_id IS NULL OR NOT EXISTS(SELECT 1 FROM public.user_profiles WHERE user_id=owner_id AND status='active')
    THEN RAISE EXCEPTION 'active account required'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(owner_id::text||':learning-task',0));
  SELECT * INTO receipt FROM public.learning_task_submission_keys WHERE owner_user_id=owner_id AND learning_task_submission_keys.request_key=enqueue_learning_task.request_key;
  IF FOUND THEN
    IF receipt.request_hash IS DISTINCT FROM request_digest THEN RAISE EXCEPTION 'idempotency conflict'; END IF;
    IF receipt.task_id IS NULL THEN RAISE EXCEPTION 'task expired'; END IF;
    SELECT * INTO job FROM public.learning_tasks WHERE id=receipt.task_id;
    RETURN job;
  END IF;
  SELECT * INTO job FROM public.learning_tasks WHERE owner_user_id=owner_id AND request_hash=request_digest AND state IN ('queued','running','cancelling','unknown') ORDER BY created_at LIMIT 1;
  IF FOUND THEN
    INSERT INTO public.learning_task_submission_keys(owner_user_id,request_key,request_hash,task_id) VALUES(owner_id,request_key,request_digest,job.id);
    RETURN job;
  END IF;
  category:=task_command->>'kind';
  IF category IS NULL OR category NOT IN ('instant-query','analysis','capture-analysis','sentence-reference','sentence-start','sentence-submit','sentence-feedback-retry','dialogue-start','dialogue-turn','dialogue-finish','dialogue-retry','duplicate-suggestions')
    THEN RAISE EXCEPTION 'invalid task kind'; END IF;
  IF (SELECT count(*) FROM public.learning_tasks WHERE owner_user_id=owner_id AND state='queued') >= 100
    THEN RAISE EXCEPTION 'generation busy'; END IF;
  subject:=COALESCE(task_command->>'captureId',task_command->>'sessionId',task_command->>'itemId',task_command#>>'{input,itemId}')::uuid;
  INSERT INTO public.learning_tasks(id,owner_user_id,idempotency_key,request_hash,command,kind,subject_id,priority)
  VALUES(task_id,owner_id,request_key,request_digest,task_command,category,subject,
    CASE WHEN category IN ('analysis','capture-analysis') THEN 20 WHEN category='duplicate-suggestions' THEN 10 ELSE 0 END)
  RETURNING * INTO job;
  INSERT INTO public.learning_task_submission_keys(owner_user_id,request_key,request_hash,task_id) VALUES(owner_id,request_key,request_digest,job.id);
  BEGIN PERFORM huayi_private.wake_learning_tasks(); EXCEPTION WHEN OTHERS THEN NULL; END;
  RETURN job;
END $$;


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
    WHEN 'sentence-reference' THEN 'practice.sentence-reference'
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


CREATE OR REPLACE FUNCTION huayi_private.reconcile_learning_tasks() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE job public.learning_tasks; saved jsonb; failed text;
BEGIN
  DELETE FROM public.learning_task_submission_keys WHERE expires_at<clock_timestamp() AND task_id IS NULL;
  FOR job IN SELECT * FROM public.learning_tasks WHERE state='unknown' AND (kind<>'instant-query' OR created_at>clock_timestamp()-interval '1 hour') ORDER BY updated_at LIMIT 100 FOR UPDATE SKIP LOCKED LOOP
    saved:=NULL; failed:=NULL;
    IF job.kind='instant-query' THEN
      SELECT terminal_event INTO saved FROM public.extension_query_generations WHERE owner_user_id=job.owner_user_id AND idempotency_key=job.id::text;
    ELSIF job.kind IN ('analysis','capture-analysis') THEN
      SELECT terminal_event INTO saved FROM public.analysis_requests WHERE owner_user_id=job.owner_user_id AND idempotency_key=job.id::text;
    ELSIF job.kind='sentence-reference' THEN
      SELECT CASE WHEN receipts.response->>'state'='applied' AND generation.state='applied'
          THEN jsonb_build_object('type','practice.updated','session',receipts.response->'session') END,
        CASE WHEN generation.state='failed' THEN generation.stable_error_code END
        INTO saved,failed FROM public.idempotency_records receipts
        JOIN public.practice_generation_tasks generation ON generation.id::text=receipts.response->>'generationId'
          AND generation.owner_user_id=job.owner_user_id AND generation.kind='sentence-reference'
          AND generation.session_id::text=job.command->>'sessionId'
        WHERE receipts.owner_user_id=job.owner_user_id AND receipts.operation='practice.reference' AND receipts.key=job.id::text
          AND receipts.response->>'type'='practice-reference-receipt'
          AND receipts.response->>'sessionId'=job.command->>'sessionId';
    ELSIF job.kind='duplicate-suggestions' THEN
      SELECT CASE WHEN response IS NOT NULL THEN jsonb_build_object('type','duplicates.completed','result',response) END,stable_error_code
        INTO saved,failed FROM public.learning_duplicate_suggestion_requests WHERE owner_user_id=job.owner_user_id AND idempotency_key=job.id::text;
    ELSE
      SELECT CASE WHEN receipts.response->>'type'='practice-feedback-receipt' THEN
          CASE WHEN huayi_private.feedback_receipt_matches_task(job,receipts.response,receipts.operation)
            AND receipts.response->>'state'='applied' AND generation.state='applied'
            THEN jsonb_build_object('type','practice.updated','session',receipts.response->'session') END
        ELSE CASE WHEN receipts.response->>'pendingGeneration' IS NULL AND receipts.response->>'status'<>'awaiting-feedback'
          AND (job.command->>'sessionId' IS NULL OR job.command->>'sessionId'=receipts.response->>'id')
          AND CASE receipts.operation
            WHEN 'practice.start' THEN job.kind='sentence-start'
            WHEN 'practice.dialogue-start' THEN job.kind='dialogue-start'
            WHEN 'practice.dialogue-turn' THEN job.kind='dialogue-turn'
            WHEN 'practice.dialogue-assistant-retry' THEN job.kind='dialogue-retry'
            WHEN 'practice.dialogue-finish' THEN job.kind='dialogue-finish'
            WHEN 'practice.attempt' THEN job.kind='sentence-submit' AND 1=(
              SELECT count(*) FROM jsonb_array_elements(receipts.response->'attempts') AS saved_answer(value)
              WHERE saved_answer.value->>'answer'=job.command#>>'{input,answer}' AND saved_answer.value->>'feedback' IS NOT NULL)
            WHEN 'practice.feedback-retry' THEN job.kind='sentence-feedback-retry' AND EXISTS(
              SELECT 1 FROM jsonb_array_elements(receipts.response->'attempts') AS saved_answer(value)
              WHERE saved_answer.value->>'id'=job.command->>'attemptId' AND saved_answer.value->>'feedback' IS NOT NULL)
            ELSE false END
          THEN jsonb_build_object('type','practice.updated','session',receipts.response) END END,
        CASE WHEN huayi_private.feedback_receipt_matches_task(job,receipts.response,receipts.operation)
          AND receipts.response->>'state'='pending' AND generation.state='failed' THEN generation.stable_error_code END
        INTO saved,failed FROM public.idempotency_records receipts
        LEFT JOIN public.practice_generation_tasks generation ON generation.owner_user_id=job.owner_user_id
          AND generation.id::text=receipts.response->>'generationId'
          AND generation.session_id::text=receipts.response->>'sessionId'
          AND generation.attempt_id::text=receipts.response->>'attemptId' AND generation.kind='sentence-feedback'
        WHERE receipts.owner_user_id=job.owner_user_id AND receipts.key=job.id::text AND receipts.operation LIKE 'practice.%' LIMIT 1;
    END IF;
    IF saved IS NOT NULL OR failed IS NOT NULL THEN
      failed:=COALESCE(failed,saved#>>'{error,code}');
      UPDATE public.learning_tasks SET output=saved,error_code=failed,state=CASE WHEN failed IS NULL THEN 'completed' ELSE 'failed' END,updated_at=clock_timestamp() WHERE id=job.id;
    END IF;
  END LOOP;
  -- Unknown outcomes retain only reconciliation identity, never extend query text retention.
  DELETE FROM public.learning_task_events events USING public.learning_tasks tasks
    WHERE events.task_id=tasks.id AND tasks.kind='instant-query' AND tasks.created_at<=clock_timestamp()-interval '1 hour';
  UPDATE public.learning_tasks SET command=jsonb_build_object('version',2,'kind','instant-query'),output=NULL,
    state=CASE WHEN state IN ('queued','running','cancelling') THEN CASE WHEN dispatched_at IS NULL THEN 'cancelled' ELSE 'unknown' END ELSE state END,
    error_code=CASE WHEN state IN ('queued','running','cancelling') THEN CASE WHEN dispatched_at IS NULL THEN 'cancelled' ELSE 'outcome_unknown' END ELSE error_code END,
    lease_token=NULL,lease_expires_at=NULL
    WHERE kind='instant-query' AND created_at<=clock_timestamp()-interval '1 hour';
  DELETE FROM public.learning_tasks WHERE id IN (SELECT id FROM public.learning_tasks
    WHERE state IN ('completed','failed','cancelled') AND updated_at < clock_timestamp() - CASE WHEN kind='instant-query' THEN interval '30 minutes' ELSE interval '7 days' END
    ORDER BY updated_at LIMIT 100);
END $$;
REVOKE ALL ON FUNCTION huayi_private.reconcile_learning_tasks() FROM PUBLIC;

CREATE OR REPLACE FUNCTION huayi_private.ready_learning_task_recoveries()
RETURNS TABLE(task_id uuid,owner_id uuid,operation text,request_hash text,session_id uuid,generation_id uuid,attempt_id uuid,lease_token text,output jsonb)
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT jobs.id,jobs.owner_user_id,receipts.operation,receipts.request_hash,generation.session_id,generation.id,generation.attempt_id,generation.lease_token,generation.output
  FROM public.learning_tasks jobs
  JOIN public.idempotency_records receipts ON receipts.owner_user_id=jobs.owner_user_id AND receipts.key=jobs.id::text
  JOIN public.practice_generation_tasks generation ON generation.owner_user_id=jobs.owner_user_id AND generation.state='ready'
  JOIN public.practice_sessions sessions ON sessions.id=generation.session_id AND sessions.owner_user_id=jobs.owner_user_id
  LEFT JOIN public.practice_attempts attempts ON attempts.id=generation.attempt_id AND attempts.session_id=generation.session_id
  WHERE jobs.state='unknown' AND (
    (jobs.kind='sentence-reference' AND receipts.operation='practice.reference'
      AND receipts.response->>'type'='practice-reference-receipt' AND receipts.response->>'state'='pending'
      AND generation.kind='sentence-reference' AND generation.attempt_id IS NULL
      AND generation.id::text=receipts.response->>'generationId'
      AND generation.session_id::text=receipts.response->>'sessionId'
      AND generation.session_id::text=jobs.command->>'sessionId') OR
    (huayi_private.feedback_receipt_matches_task(jobs,receipts.response,receipts.operation)
      AND receipts.response->>'state'='pending'
      AND generation.kind='sentence-feedback'
      AND generation.id::text=receipts.response->>'generationId'
      AND generation.session_id::text=receipts.response->>'sessionId'
      AND generation.attempt_id::text=receipts.response->>'attemptId')
    OR (receipts.response->>'type'<>'practice-feedback-receipt'
      AND generation.session_id::text=receipts.response->>'id' AND generation.request_hash=receipts.request_hash
      AND (jobs.command->>'sessionId' IS NULL OR jobs.command->>'sessionId'=generation.session_id::text)
      AND (
        (receipts.operation='practice.start' AND jobs.kind='sentence-start' AND generation.kind='sentence-prompt' AND sessions.current_generation_id=generation.id)
        OR (receipts.operation='practice.dialogue-start' AND jobs.kind='dialogue-start' AND generation.kind='dialogue-start' AND sessions.current_generation_id=generation.id)
        OR (receipts.operation='practice.dialogue-turn' AND jobs.kind='dialogue-turn' AND generation.kind='dialogue-assistant' AND sessions.current_generation_id=generation.id)
        OR (receipts.operation='practice.dialogue-assistant-retry' AND jobs.kind='dialogue-retry' AND generation.kind='dialogue-assistant' AND sessions.current_generation_id=generation.id)
        OR (receipts.operation='practice.dialogue-finish' AND jobs.kind='dialogue-finish' AND generation.kind='dialogue-final-feedback' AND sessions.current_generation_id=generation.id)
        OR (generation.kind='sentence-feedback' AND attempts.current_generation_id=generation.id AND (
          (receipts.operation='practice.feedback-retry' AND jobs.kind='sentence-feedback-retry'
            AND jobs.command->>'attemptId'=generation.attempt_id::text)
          OR (receipts.operation='practice.attempt' AND jobs.kind='sentence-submit'
            AND receipts.response->>'revision'=((jobs.command#>>'{input,expectedRevision}')::integer+1)::text
            AND 1=(SELECT count(*) FROM jsonb_array_elements(receipts.response->'attempts') AS saved_answer(value)
              WHERE saved_answer.value->>'id'=generation.attempt_id::text AND saved_answer.value->>'answer'=jobs.command#>>'{input,answer}'))
        ))
      ))
  ) ORDER BY jobs.updated_at LIMIT 10;
$$;
REVOKE ALL ON FUNCTION huayi_private.ready_learning_task_recoveries() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION huayi_private.ready_learning_task_recoveries() TO huayi_context_setter;

COMMIT;
