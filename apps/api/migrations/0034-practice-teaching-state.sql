BEGIN;

-- Keep the published session/workspace JSON shape unchanged. New clients read a sidecar.
ALTER TABLE public.practice_sessions ADD COLUMN teaching_state jsonb;
ALTER TABLE public.practice_sessions ADD CONSTRAINT practice_teaching_state_valid CHECK (
  teaching_state IS NULL OR (type='sentence-creation'
    AND jsonb_typeof(teaching_state)='object'
    AND teaching_state->>'contract'='practice-teaching-v1'
    AND teaching_state->>'hintPolicy' IN ('shown','on-demand')
    AND jsonb_typeof(teaching_state->'target')='object'
    AND teaching_state#>>'{target,state}' IN ('available','deleted')
    AND jsonb_typeof(teaching_state->'round')='object'
    AND (teaching_state#>>'{round,ordinal}')::integer BETWEEN 0 AND 4
    AND octet_length(teaching_state::text)<=131072) IS TRUE
);

ALTER TABLE public.practice_attempts
  ADD COLUMN ordinal integer NOT NULL DEFAULT 0,
  ADD COLUMN parent_attempt_id uuid,
  ADD COLUMN teaching_contract text CHECK (teaching_contract='practice-teaching-v1'),
  ADD COLUMN hint_viewed_at timestamptz,
  ADD COLUMN feedback_structured jsonb,
  ADD COLUMN feedback_completed_at timestamptz;
-- The old unique constraint proves all existing rows are the first answer. Do not
-- infer historical hint use or feedback timestamps from mutable session timestamps.
ALTER TABLE public.practice_attempts DROP CONSTRAINT practice_attempts_session_id_key;
ALTER TABLE public.practice_attempts
  ADD CONSTRAINT practice_attempt_ordinal_range CHECK (ordinal BETWEEN 0 AND 4),
  ADD CONSTRAINT practice_attempt_parent_shape CHECK (
    (ordinal=0 AND parent_attempt_id IS NULL) OR (ordinal>0 AND parent_attempt_id IS NOT NULL)
  ),
  ADD CONSTRAINT practice_attempt_order UNIQUE(session_id,ordinal),
  ADD CONSTRAINT practice_attempt_session_identity UNIQUE(session_id,id),
  ADD CONSTRAINT practice_attempt_parent_session FOREIGN KEY(session_id,parent_attempt_id)
    REFERENCES public.practice_attempts(session_id,id),
  ADD CONSTRAINT practice_attempt_hint_contract CHECK (hint_viewed_at IS NULL OR teaching_contract IS NOT NULL),
  ADD CONSTRAINT practice_attempt_feedback_sidecar CHECK (
    feedback_structured IS NULL OR (teaching_contract IS NOT NULL AND feedback IS NOT NULL
      AND jsonb_typeof(feedback_structured)='object' AND octet_length(feedback_structured::text)<=32768)
  ),
  ADD CONSTRAINT practice_attempt_feedback_timestamp CHECK (feedback_completed_at IS NULL OR feedback IS NOT NULL);

COMMIT;
