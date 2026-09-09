-- Preserve words, contexts, bridge references, and legacy V1 response shapes.
ALTER TABLE public.word_entries ADD COLUMN archived_at timestamptz;
CREATE INDEX word_entries_owner_archive_page ON public.word_entries
  (owner_user_id,(archived_at IS NOT NULL),created_at DESC,id DESC);

-- CREATE OR REPLACE retains the existing restricted execution grants.
CREATE OR REPLACE FUNCTION begin_idempotent_write(
  account_user_id uuid, operation_name text, idempotency_key text, request_hash text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE existing public.idempotency_records%ROWTYPE;
BEGIN
  IF operation_name NOT IN (
    'analysis.confirm','learning.create','learning.patch','learning.delete','learning.merge',
    'learning.archive','learning.restore',
    'practice.start','practice.attempt',
    'practice.feedback-retry','practice.rate','practice.dialogue-start',
    'practice.dialogue-turn','practice.dialogue-assistant-retry','practice.dialogue-finish',
    'practice.delete','word.upsert','word.patch','word.delete','word.archive',
    'cloud-word-copy.copy','cloud-word-copy.import-local-v2',
    'wordbook.create','wordbook.receipt','wordbook.retry','wordbook.cancel',
    'account-export.create','account-export.retry','study-capture.create','study-capture.patch',
    'study-capture.delete'
  )
    OR char_length(idempotency_key) NOT BETWEEN 1 AND 128
    OR request_hash !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'invalid idempotent write'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    account_user_id::text || ':' || operation_name || ':' || idempotency_key, 3
  ));
  SELECT * INTO existing FROM public.idempotency_records
    WHERE owner_user_id=account_user_id AND operation=operation_name AND key=idempotency_key;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF existing.request_hash <> request_hash THEN RAISE EXCEPTION 'idempotency conflict'; END IF;
  RETURN existing.response;
END;
$$;
