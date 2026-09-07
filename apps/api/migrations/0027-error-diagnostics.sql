BEGIN;

CREATE TABLE error_diagnostics (
  id uuid PRIMARY KEY,
  owner_user_id uuid REFERENCES user_profiles(user_id) ON DELETE CASCADE,
  received_at timestamptz NOT NULL DEFAULT now(),
  event jsonb NOT NULL CHECK (jsonb_typeof(event) = 'object' AND octet_length(event::text) <= 4096)
);
ALTER TABLE error_diagnostics ENABLE ROW LEVEL SECURITY;
ALTER TABLE error_diagnostics FORCE ROW LEVEL SECURITY;
REVOKE ALL ON error_diagnostics FROM PUBLIC,huayi_business,huayi_runtime,huayi_context_setter;
CREATE INDEX error_diagnostics_recent ON error_diagnostics(received_at DESC,id DESC);
CREATE INDEX error_diagnostics_owner ON error_diagnostics(owner_user_id);
CREATE INDEX error_diagnostics_request ON error_diagnostics((event->>'requestId'));
CREATE INDEX error_diagnostics_task ON error_diagnostics((event->>'taskId'));
CREATE INDEX error_diagnostics_generation ON error_diagnostics((event->>'generationId'));
CREATE INDEX error_diagnostics_reference ON error_diagnostics((event->>'diagnosticId'));

CREATE FUNCTION purge_error_diagnostics() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  DELETE FROM public.error_diagnostics WHERE id IN (
    SELECT id FROM public.error_diagnostics WHERE received_at < now()-interval '30 days'
    ORDER BY received_at LIMIT 1000
  );
  -- Recover evidence after a crashed worker or a failed diagnostic write, without rerunning work.
  INSERT INTO public.error_diagnostics(id,owner_user_id,event)
  SELECT task.id,task.owner_user_id,jsonb_build_object(
    'version',1,'id',task.id,'taskId',task.id,'source','api','severity','error','stage','task',
    'occurredAt',to_char(task.updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'operation',CASE WHEN task.kind IN ('instant-query','analysis','capture-analysis','sentence-start','sentence-submit','sentence-feedback-retry','dialogue-start','dialogue-turn','dialogue-finish','dialogue-retry','duplicate-suggestions') THEN task.kind ELSE 'learning-task' END,
    'code',CASE WHEN task.state='unknown' THEN 'outcome_unknown' WHEN task.error_code IN ('model_timeout','model_unavailable','model_response_invalid','model_output_invalid','quota_exhausted','generation_busy','revision_conflict','not_found','forbidden') THEN task.error_code ELSE 'internal_error' END
  ) FROM public.learning_tasks task
  WHERE task.state IN ('failed','unknown') AND task.updated_at>now()-interval '1 day'
    AND NOT EXISTS(SELECT 1 FROM public.error_diagnostics d WHERE d.id=task.id OR
      (d.owner_user_id=task.owner_user_id AND d.event->>'source'='api' AND d.event->>'taskId'=task.id::text AND d.event->>'stage'='task' AND d.event->>'severity'='error'))
  ORDER BY task.updated_at LIMIT 100
  ON CONFLICT(id) DO NOTHING;
END;
$$;

-- Only the API context setter can call this; client bodies never select an owner.
CREATE FUNCTION record_error_diagnostics(owner_id uuid, events jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF jsonb_typeof(events) <> 'array' OR jsonb_array_length(events) NOT BETWEEN 1 AND 32
    THEN RAISE EXCEPTION 'invalid diagnostics'; END IF;
  INSERT INTO public.error_diagnostics(id,owner_user_id,event)
  SELECT (value->>'id')::uuid,owner_id,value FROM jsonb_array_elements(events)
  WHERE (value->>'occurredAt')::timestamptz BETWEEN now()-interval '1 day' AND now()+interval '5 minutes'
  ON CONFLICT(id) DO NOTHING;
  PERFORM public.purge_error_diagnostics();
END;
$$;

CREATE FUNCTION admin_error_diagnostics(actor_id uuid, filters jsonb, boundary jsonb, page_size integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE result jsonb;
BEGIN
  IF public.require_admin_operator(actor_id) IS DISTINCT FROM 'operator'
    THEN RAISE EXCEPTION 'administrator required'; END IF;
  IF page_size NOT BETWEEN 1 AND 101 THEN RAISE EXCEPTION 'invalid page size'; END IF;
  WITH matched AS MATERIALIZED (
    SELECT * FROM public.error_diagnostics d
    WHERE received_at >= now()-make_interval(days=>LEAST(30,GREATEST(1,COALESCE((filters->>'days')::integer,7))))
      AND (filters->>'source' IS NULL OR event->>'source'=filters->>'source')
      AND (filters->>'severity' IS NULL OR event->>'severity'=filters->>'severity')
      AND (filters->>'code' IS NULL OR event->>'code'=filters->>'code')
      AND (filters->>'operation' IS NULL OR event->>'operation'=filters->>'operation')
      AND (filters->>'reference' IS NULL OR filters->>'reference' IN
        (id::text,event->>'requestId',event->>'taskId',event->>'generationId',event->>'diagnosticId'))
  ), visible AS (
    SELECT * FROM matched WHERE boundary IS NULL OR
      (received_at,id)<((boundary->>'createdAt')::timestamptz,(boundary->>'id')::uuid)
    ORDER BY received_at DESC,id DESC LIMIT page_size
  ), groups AS (
    SELECT event->>'source' AS source,event->>'operation' AS operation,event->>'code' AS code,count(*) AS count
    FROM matched GROUP BY 1,2,3 ORDER BY count(*) DESC,1,2,3 LIMIT 20
  )
  SELECT jsonb_build_object(
    'items',COALESCE((SELECT jsonb_agg(jsonb_build_object('event',event,'userId',owner_user_id,'receivedAt',received_at)
      ORDER BY received_at DESC,id DESC) FROM visible),'[]'::jsonb),
    'summary',jsonb_build_object(
      'events',(SELECT count(*) FROM matched),
      'errors',(SELECT count(*) FROM matched WHERE event->>'severity'='error'),
      'affectedUsers',(SELECT count(DISTINCT owner_user_id) FROM matched),
      'affectedRequests',(SELECT count(DISTINCT (owner_user_id,COALESCE(event->>'taskId',event->>'diagnosticId',event->>'requestId',id::text))) FROM matched),
      'groups',COALESCE((SELECT jsonb_agg(to_jsonb(groups)) FROM groups),'[]'::jsonb)
    )
  ) INTO result;
  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION record_error_diagnostics(uuid,jsonb),admin_error_diagnostics(uuid,jsonb,jsonb,integer),purge_error_diagnostics()
FROM PUBLIC,huayi_business,huayi_runtime;
-- Hosted default ACLs can grant new functions/tables to Supabase roles. Revoke explicitly.
DO $$ DECLARE role_name text; BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
      EXECUTE format('REVOKE ALL ON public.error_diagnostics FROM %I',role_name);
      EXECUTE format('REVOKE ALL ON FUNCTION public.record_error_diagnostics(uuid,jsonb),public.admin_error_diagnostics(uuid,jsonb,jsonb,integer),public.purge_error_diagnostics() FROM %I',role_name);
    END IF;
  END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION record_error_diagnostics(uuid,jsonb),admin_error_diagnostics(uuid,jsonb,jsonb,integer),purge_error_diagnostics()
TO huayi_context_setter;
COMMIT;
