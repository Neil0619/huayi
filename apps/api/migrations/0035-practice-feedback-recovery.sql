BEGIN;

-- Applied output is removed as before; retain only its full normalized fingerprint.
ALTER TABLE public.practice_generation_tasks ADD COLUMN applied_output_hash text
  CHECK (applied_output_hash IS NULL OR (state='applied' AND applied_output_hash ~ '^[0-9a-f]{64}$'));

-- Internal receipts do not change the published PracticeSession or task payload shape.
CREATE FUNCTION huayi_private.feedback_receipt_matches_task(job public.learning_tasks, receipt jsonb, operation text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
  SELECT COALESCE(receipt->>'type'='practice-feedback-receipt' AND receipt->>'version'='1'
    AND receipt->>'sessionId'=job.command->>'sessionId'
    AND receipt#>>'{session,id}'=receipt->>'sessionId'
    AND ((operation='practice.attempt' AND job.kind='sentence-submit')
      OR (operation='practice.feedback-retry' AND job.kind='sentence-feedback-retry'
        AND receipt->>'attemptId'=job.command->>'attemptId')),false);
$$;
REVOKE ALL ON FUNCTION huayi_private.feedback_receipt_matches_task(public.learning_tasks,jsonb,text) FROM PUBLIC;

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
