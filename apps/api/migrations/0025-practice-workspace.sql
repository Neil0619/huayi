BEGIN;
ALTER TABLE public.practice_sessions ADD COLUMN workspace_state jsonb NOT NULL DEFAULT '{"phase":"active","mode":"guided","draft":"","draftRevision":0}'::jsonb
  CHECK (jsonb_typeof(workspace_state)='object' AND workspace_state->>'phase' IN ('active','paused','ended','skipped')
    AND workspace_state->>'mode' IN ('guided','free') AND char_length(workspace_state->>'draft')<=4000
    AND (workspace_state->>'draftRevision')::integer>=0
    AND COALESCE((workspace_state->>'controlRevision')::integer,0)>=0);
DROP INDEX public.practice_sessions_one_active;
CREATE UNIQUE INDEX practice_sessions_one_active ON public.practice_sessions(owner_user_id)
  WHERE status IN ('active','awaiting-feedback') AND workspace_state->>'phase'='active';
ALTER TABLE public.practice_session_items ADD COLUMN rated_at timestamptz;
UPDATE public.practice_session_items links SET rated_at=sessions.updated_at
  FROM public.practice_sessions sessions WHERE sessions.id=links.session_id AND links.rating IS NOT NULL;
CREATE FUNCTION huayi_private.stamp_practice_rating() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF OLD.rating IS NULL AND NEW.rating IS NOT NULL THEN NEW.rated_at:=clock_timestamp();
  ELSE NEW.rated_at:=OLD.rated_at; END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION huayi_private.stamp_practice_rating() FROM PUBLIC;
CREATE TRIGGER practice_rating_timestamp BEFORE UPDATE ON public.practice_session_items
  FOR EACH ROW EXECUTE FUNCTION huayi_private.stamp_practice_rating();
COMMIT;
