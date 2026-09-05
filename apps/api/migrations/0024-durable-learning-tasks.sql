BEGIN;

CREATE TABLE public.learning_tasks (
  id uuid PRIMARY KEY,
  owner_user_id uuid NOT NULL REFERENCES public.user_profiles(user_id) ON DELETE CASCADE,
  idempotency_key text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 1 AND 128),
  request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  command jsonb NOT NULL CHECK (octet_length(command::text) <= 65536 AND command->>'version'='2'),
  kind text NOT NULL,
  subject_id uuid,
  priority integer NOT NULL CHECK (priority BETWEEN 0 AND 20),
  state text NOT NULL DEFAULT 'queued' CHECK (state IN ('queued','running','cancelling','completed','failed','cancelled','unknown')),
  lease_token uuid,
  lease_expires_at timestamptz,
  dispatched_at timestamptz,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  cursor integer NOT NULL DEFAULT 0 CHECK (cursor >= 0),
  event_bytes integer NOT NULL DEFAULT 0 CHECK (event_bytes BETWEEN 0 AND 2097152),
  timings jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (octet_length(timings::text) <= 4096),
  output jsonb,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(owner_user_id,idempotency_key)
);
CREATE UNIQUE INDEX learning_tasks_one_running_owner ON public.learning_tasks(owner_user_id)
  WHERE state IN ('running','cancelling');
CREATE INDEX learning_tasks_dispatch ON public.learning_tasks(priority,created_at) WHERE state='queued';
-- Every accepted click key remains bound to its task, including coalesced submissions.
-- Tombstones contain no text and survive result expiry to prevent a paid replay.
CREATE TABLE public.learning_task_submission_keys (
  owner_user_id uuid NOT NULL REFERENCES public.user_profiles(user_id) ON DELETE CASCADE,
  request_key text NOT NULL CHECK (char_length(request_key) BETWEEN 1 AND 128),
  request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  task_id uuid REFERENCES public.learning_tasks(id) ON DELETE SET NULL,
  expires_at timestamptz NOT NULL DEFAULT now()+interval '7 days',
  PRIMARY KEY(owner_user_id,request_key)
);
ALTER TABLE public.learning_task_submission_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.learning_task_submission_keys FORCE ROW LEVEL SECURITY;
CREATE POLICY learning_task_keys_owner ON public.learning_task_submission_keys USING (owner_user_id=huayi_private.current_owner_user_id());
REVOKE ALL ON public.learning_task_submission_keys FROM PUBLIC,huayi_business,huayi_context_setter,huayi_runtime;
CREATE TABLE public.learning_task_events (
  task_id uuid NOT NULL REFERENCES public.learning_tasks(id) ON DELETE CASCADE,
  owner_user_id uuid NOT NULL REFERENCES public.user_profiles(user_id) ON DELETE CASCADE,
  cursor integer NOT NULL CHECK (cursor > 0),
  payload jsonb NOT NULL CHECK (octet_length(payload::text) <= 1048576),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(task_id,cursor)
);
ALTER TABLE public.learning_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.learning_tasks FORCE ROW LEVEL SECURITY;
ALTER TABLE public.learning_task_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.learning_task_events FORCE ROW LEVEL SECURITY;
CREATE POLICY learning_tasks_owner ON public.learning_tasks USING (owner_user_id=huayi_private.current_owner_user_id());
CREATE POLICY learning_task_events_owner ON public.learning_task_events USING (owner_user_id=huayi_private.current_owner_user_id());
REVOKE ALL ON public.learning_tasks,public.learning_task_events FROM PUBLIC,huayi_business,huayi_context_setter,huayi_runtime;
GRANT SELECT ON public.learning_tasks,public.learning_task_events TO huayi_business;

-- Replaced by the explicit Supabase scheduler configuration. Task durability does not depend on pg_net.
CREATE FUNCTION huayi_private.wake_learning_tasks() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN RETURN; END $$;
REVOKE ALL ON FUNCTION huayi_private.wake_learning_tasks() FROM PUBLIC;

CREATE FUNCTION huayi_private.enqueue_learning_task(owner_id uuid, task_id uuid, request_key text, request_digest text, task_command jsonb)
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
  IF category IS NULL OR category NOT IN ('instant-query','analysis','capture-analysis','sentence-start','sentence-submit','sentence-feedback-retry','dialogue-start','dialogue-turn','dialogue-finish','dialogue-retry','duplicate-suggestions')
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

-- Reconcile saved business results only. Never dispatch from recovery.
CREATE FUNCTION huayi_private.reconcile_learning_tasks() RETURNS void
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
      SELECT CASE WHEN response->>'pendingGeneration' IS NULL AND response->>'status'<>'awaiting-feedback' THEN jsonb_build_object('type','practice.updated','session',response) END
        INTO saved FROM public.idempotency_records WHERE owner_user_id=job.owner_user_id AND key=job.id::text AND operation LIKE 'practice.%' LIMIT 1;
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

CREATE FUNCTION huayi_private.ready_learning_task_recoveries()
RETURNS TABLE(task_id uuid,owner_id uuid,operation text,request_hash text,session_id uuid,generation_id uuid,attempt_id uuid,lease_token text,output jsonb)
LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT jobs.id,jobs.owner_user_id,receipts.operation,receipts.request_hash,generation.session_id,generation.id,generation.attempt_id,generation.lease_token,generation.output
  FROM public.learning_tasks jobs
  JOIN public.idempotency_records receipts ON receipts.owner_user_id=jobs.owner_user_id AND receipts.key=jobs.id::text
  JOIN public.practice_generation_tasks generation ON generation.owner_user_id=jobs.owner_user_id
    AND generation.session_id=(receipts.response->>'id')::uuid AND generation.request_hash=receipts.request_hash AND generation.state='ready'
  WHERE jobs.state='unknown' AND receipts.operation IN ('practice.start','practice.attempt','practice.feedback-retry','practice.dialogue-start','practice.dialogue-turn','practice.dialogue-assistant-retry','practice.dialogue-finish')
  ORDER BY jobs.updated_at LIMIT 10;
$$;
REVOKE ALL ON FUNCTION huayi_private.ready_learning_task_recoveries() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION huayi_private.ready_learning_task_recoveries() TO huayi_context_setter;

CREATE FUNCTION huayi_private.claim_learning_task(lease uuid, operation_time timestamptz)
RETURNS SETOF public.learning_tasks LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE candidate uuid;
BEGIN
  IF lease IS NULL OR operation_time IS NULL THEN RAISE EXCEPTION 'invalid lease'; END IF;
  PERFORM pg_advisory_xact_lock(71942051);
  UPDATE public.learning_tasks SET state=CASE WHEN dispatched_at IS NULL AND state='running' THEN 'queued' WHEN dispatched_at IS NULL THEN 'cancelled' ELSE 'unknown' END,
    error_code=CASE WHEN dispatched_at IS NULL THEN NULL ELSE 'outcome_unknown' END,lease_token=NULL,lease_expires_at=NULL,updated_at=operation_time
    WHERE state IN ('running','cancelling') AND lease_expires_at<=operation_time;
  PERFORM huayi_private.reconcile_learning_tasks();
  SELECT tasks.id INTO candidate FROM public.learning_tasks tasks
    JOIN public.user_profiles profiles ON profiles.user_id=tasks.owner_user_id AND profiles.status='active'
    WHERE tasks.state='queued' AND tasks.next_attempt_at<=operation_time
      AND NOT EXISTS(SELECT 1 FROM public.learning_tasks active WHERE active.owner_user_id=tasks.owner_user_id AND active.state IN ('running','cancelling'))
      AND NOT EXISTS(SELECT 1 FROM public.quota_reservations reservation WHERE reservation.user_id=tasks.owner_user_id AND reservation.status='active' AND reservation.expires_at>operation_time)
    ORDER BY tasks.priority,tasks.created_at,tasks.id FOR UPDATE OF tasks SKIP LOCKED LIMIT 1;
  IF candidate IS NULL THEN RETURN; END IF;
  RETURN QUERY UPDATE public.learning_tasks SET state='running',lease_token=lease,lease_expires_at=operation_time+interval '2 minutes',updated_at=operation_time,
    timings=timings||jsonb_build_object('queue',greatest(0,extract(epoch FROM (operation_time-created_at))*1000))
    WHERE id=candidate RETURNING *;
END $$;

CREATE FUNCTION huayi_private.touch_learning_task(task_id uuid, lease uuid, operation_time timestamptz, dispatch boolean)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE job public.learning_tasks;
BEGIN
  SELECT * INTO job FROM public.learning_tasks WHERE id=task_id AND lease_token=lease FOR UPDATE;
  IF NOT FOUND OR job.state NOT IN ('running','cancelling') OR job.lease_expires_at<=operation_time THEN RETURN 'lost'; END IF;
  IF dispatch AND job.state='cancelling' THEN RETURN 'cancelling'; END IF;
  UPDATE public.learning_tasks SET lease_expires_at=operation_time+interval '2 minutes',
    dispatched_at=CASE WHEN dispatch THEN COALESCE(dispatched_at,operation_time) ELSE dispatched_at END WHERE id=task_id;
  RETURN job.state;
END $$;

CREATE FUNCTION huayi_private.append_learning_task_events(task_id uuid, lease uuid, events jsonb, timing_values jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE job public.learning_tasks; payload jsonb; size integer;
BEGIN
  IF jsonb_typeof(events) IS DISTINCT FROM 'array' OR jsonb_array_length(events)>128 OR jsonb_typeof(timing_values) IS DISTINCT FROM 'object'
    THEN RAISE EXCEPTION 'invalid task events'; END IF;
  SELECT * INTO job FROM public.learning_tasks WHERE id=task_id AND lease_token=lease FOR UPDATE;
  IF NOT FOUND OR job.state NOT IN ('running','cancelling') OR job.lease_expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'task lease lost'; END IF;
  FOR payload IN SELECT value FROM jsonb_array_elements(events) LOOP
    IF payload->>'type'='practice.updated' THEN UPDATE public.learning_tasks SET subject_id=(payload#>>'{session,id}')::uuid WHERE id=task_id; END IF;
    size:=octet_length(payload::text);
    IF job.event_bytes+size>2097152 THEN EXIT; END IF;
    job.cursor:=job.cursor+1; job.event_bytes:=job.event_bytes+size;
    INSERT INTO public.learning_task_events(task_id,owner_user_id,cursor,payload) VALUES(job.id,job.owner_user_id,job.cursor,payload);
  END LOOP;
  UPDATE public.learning_tasks SET cursor=job.cursor,event_bytes=job.event_bytes,timings=timings||timing_values,updated_at=clock_timestamp() WHERE id=task_id;
END $$;

CREATE FUNCTION huayi_private.finish_learning_task(task_id uuid, lease uuid, outcome text, result jsonb, failure text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF outcome NOT IN ('completed','failed','cancelled','unknown') OR (result IS NOT NULL AND octet_length(result::text)>1048576)
    THEN RAISE EXCEPTION 'invalid task outcome'; END IF;
  UPDATE public.learning_tasks SET state=outcome,output=result,error_code=failure,lease_token=NULL,lease_expires_at=NULL,updated_at=clock_timestamp()
    WHERE id=task_id AND lease_token=lease AND state IN ('running','cancelling') AND lease_expires_at>clock_timestamp();
  IF NOT FOUND THEN RAISE EXCEPTION 'task lease lost'; END IF;
  BEGIN PERFORM huayi_private.wake_learning_tasks(); EXCEPTION WHEN OTHERS THEN NULL; END;
END $$;

CREATE FUNCTION huayi_private.cancel_learning_task(owner_id uuid, task_id uuid)
RETURNS public.learning_tasks LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE job public.learning_tasks;
BEGIN
  SELECT * INTO job FROM public.learning_tasks WHERE id=task_id AND owner_user_id=owner_id FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF job.state IN ('queued','running') THEN
    UPDATE public.learning_tasks SET state=CASE WHEN state='queued' THEN 'cancelled' ELSE 'cancelling' END,
      error_code=CASE WHEN state='queued' THEN 'cancelled' ELSE NULL END,updated_at=clock_timestamp() WHERE id=task_id RETURNING * INTO job;
  END IF;
  RETURN job;
END $$;

REVOKE ALL ON FUNCTION huayi_private.enqueue_learning_task(uuid,uuid,text,text,jsonb),huayi_private.claim_learning_task(uuid,timestamptz),
  huayi_private.touch_learning_task(uuid,uuid,timestamptz,boolean),huayi_private.append_learning_task_events(uuid,uuid,jsonb,jsonb),
  huayi_private.finish_learning_task(uuid,uuid,text,jsonb,text),huayi_private.cancel_learning_task(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION huayi_private.enqueue_learning_task(uuid,uuid,text,text,jsonb),huayi_private.claim_learning_task(uuid,timestamptz),
  huayi_private.touch_learning_task(uuid,uuid,timestamptz,boolean),huayi_private.append_learning_task_events(uuid,uuid,jsonb,jsonb),
  huayi_private.finish_learning_task(uuid,uuid,text,jsonb,text),huayi_private.cancel_learning_task(uuid,uuid) TO huayi_context_setter;

COMMIT;
