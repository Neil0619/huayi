BEGIN;

CREATE ROLE huayi_business NOLOGIN NOINHERIT NOBYPASSRLS;
CREATE ROLE huayi_context_setter NOLOGIN NOINHERIT NOBYPASSRLS;
CREATE ROLE huayi_runtime NOLOGIN NOINHERIT NOBYPASSRLS;
GRANT huayi_business, huayi_context_setter TO huayi_runtime;
CREATE SCHEMA huayi_private;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE ALL ON SCHEMA huayi_private FROM PUBLIC, huayi_business;
GRANT USAGE ON SCHEMA huayi_private TO huayi_context_setter, huayi_business;

CREATE TABLE huayi_private.transaction_owner_context (
  backend_pid integer NOT NULL,
  transaction_id bigint NOT NULL,
  owner_user_id uuid NOT NULL,
  PRIMARY KEY (backend_pid, transaction_id)
);
REVOKE ALL ON huayi_private.transaction_owner_context FROM PUBLIC, huayi_business;

CREATE FUNCTION huayi_private.set_owner_context(request_owner_user_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, huayi_private
AS $$
  DELETE FROM huayi_private.transaction_owner_context
  WHERE backend_pid = pg_backend_pid()
    AND transaction_id <> txid_current();
  INSERT INTO huayi_private.transaction_owner_context (
    backend_pid,
    transaction_id,
    owner_user_id
  ) VALUES (
    pg_backend_pid(),
    txid_current(),
    request_owner_user_id
  )
  ON CONFLICT (backend_pid, transaction_id) DO NOTHING;
$$;

CREATE FUNCTION huayi_private.current_owner_user_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, huayi_private
AS $$
  SELECT owner_user_id
  FROM huayi_private.transaction_owner_context
  WHERE backend_pid = pg_backend_pid()
    AND transaction_id = txid_current();
$$;

REVOKE ALL ON FUNCTION huayi_private.set_owner_context(uuid) FROM PUBLIC, huayi_business;
GRANT EXECUTE ON FUNCTION huayi_private.set_owner_context(uuid) TO huayi_context_setter;
REVOKE ALL ON FUNCTION huayi_private.current_owner_user_id() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION huayi_private.current_owner_user_id() TO huayi_business;

CREATE TABLE invitations (
  id uuid PRIMARY KEY,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  revoked_at timestamptz,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > created_at)
);

CREATE TABLE invitation_claims (
  ticket_hash text PRIMARY KEY,
  invitation_id uuid NOT NULL REFERENCES invitations(id),
  expires_at timestamptz NOT NULL,
  finalized_user_id uuid,
  bound_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX invitation_claims_invitation ON invitation_claims (invitation_id, expires_at);

CREATE TABLE auth_flows (
  flow_hash text PRIMARY KEY,
  kind text NOT NULL DEFAULT 'invite-registration'
    CHECK (kind IN (
      'invite-registration','login','reauthenticate-google','link-google','link-password'
    )),
  ticket_hash text REFERENCES invitation_claims(ticket_hash) ON DELETE CASCADE,
  owner_user_id uuid,
  web_session_hash text,
  expires_at timestamptz NOT NULL,
  started_at timestamptz,
  consumed_at timestamptz,
  link_stage text CHECK (link_stage IN (
    'claimed','refreshed','provider-started','provider-updated','completed'
  )),
  link_lease_hash text,
  link_lease_expires_at timestamptz,
  provider_state_ciphertext text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > created_at),
  CHECK ((kind='invite-registration') = (ticket_hash IS NOT NULL)),
  CHECK (
    (kind IN ('reauthenticate-google','link-google','link-password')) =
      (owner_user_id IS NOT NULL AND web_session_hash IS NOT NULL)
  ),
  CHECK ((kind IN ('link-google','link-password')) = (link_stage IS NOT NULL)),
  CHECK ((link_lease_hash IS NULL) = (link_lease_expires_at IS NULL))
);
CREATE UNIQUE INDEX auth_flows_one_open_link
  ON auth_flows(kind,web_session_hash)
  WHERE kind IN ('link-google','link-password') AND consumed_at IS NULL;

CREATE TABLE user_profiles (
  user_id uuid PRIMARY KEY,
  owner_user_id uuid NOT NULL UNIQUE,
  email text NOT NULL UNIQUE CHECK (
    char_length(email) BETWEEN 3 AND 320 AND email = lower(email)
  ),
  status text NOT NULL CHECK (status IN ('active', 'disabled', 'deleting')),
  timezone text NOT NULL,
  daily_goal integer NOT NULL CHECK (daily_goal BETWEEN 1 AND 100),
  extension_query_model_mode text NOT NULL DEFAULT 'platform'
    CHECK (extension_query_model_mode IN ('platform', 'byok')),
  study_capture_mode text NOT NULL DEFAULT 'manual'
    CHECK (study_capture_mode IN ('manual', 'automatic')),
  cloud_word_copy_mode text NOT NULL DEFAULT 'enabled'
    CHECK (cloud_word_copy_mode IN ('enabled', 'disabled')),
  preferences_revision integer NOT NULL DEFAULT 1 CHECK (preferences_revision >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (user_id = owner_user_id)
);

CREATE TABLE account_sign_in_methods (
  owner_user_id uuid NOT NULL REFERENCES user_profiles(user_id) ON DELETE CASCADE,
  method text NOT NULL CHECK (method IN ('password', 'google')),
  linked_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_user_id, method)
);

CREATE TABLE password_recovery_flows (
  flow_hash text PRIMARY KEY,
  owner_user_id uuid NOT NULL REFERENCES user_profiles(user_id) ON DELETE CASCADE,
  stage text NOT NULL CHECK (stage IN (
    'requested','sent','verified','provider-updated','completed','failed'
  )),
  provider_state_ciphertext text,
  callback_flow_ciphertext text NOT NULL,
  recovery_session_hash text UNIQUE,
  csrf_hash text,
  dispatch_lease_hash text,
  dispatch_lease_expires_at timestamptz,
  completion_lease_hash text,
  completion_lease_expires_at timestamptz,
  dispatch_at timestamptz,
  expires_at timestamptz NOT NULL,
  browser_expires_at timestamptz,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > created_at),
  CHECK ((dispatch_lease_hash IS NULL) = (dispatch_lease_expires_at IS NULL)),
  CHECK ((completion_lease_hash IS NULL) = (completion_lease_expires_at IS NULL)),
  CHECK (stage IN ('requested','failed') OR (
    dispatch_at IS NOT NULL AND provider_state_ciphertext IS NOT NULL
  )),
  CHECK (stage NOT IN ('verified','provider-updated') OR (
    recovery_session_hash IS NOT NULL AND csrf_hash IS NOT NULL
    AND browser_expires_at IS NOT NULL
  )),
  CHECK (stage NOT IN ('completed','failed') OR consumed_at IS NOT NULL),
  CHECK (stage <> 'completed' OR recovery_session_hash IS NULL)
);
CREATE UNIQUE INDEX password_recovery_flows_one_open
  ON password_recovery_flows(owner_user_id)
  WHERE stage NOT IN ('completed','failed');
CREATE INDEX password_recovery_flows_dispatch
  ON password_recovery_flows(stage,created_at) WHERE stage='requested';

CREATE TABLE security_notification_outbox (
  id uuid PRIMARY KEY,
  owner_user_id uuid NOT NULL REFERENCES user_profiles(user_id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind='password-reset-completed'),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sending','sent')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  available_at timestamptz NOT NULL DEFAULT now(),
  lease_hash text,
  lease_expires_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((lease_hash IS NULL) = (lease_expires_at IS NULL)),
  CHECK ((status = 'sending') = (lease_hash IS NOT NULL)),
  CHECK ((status = 'sent') = (sent_at IS NOT NULL))
);
CREATE INDEX security_notification_outbox_delivery
  ON security_notification_outbox(status,available_at,lease_expires_at,created_at);

ALTER TABLE auth_flows ADD CONSTRAINT auth_flows_owner_user_id_fkey
  FOREIGN KEY (owner_user_id) REFERENCES user_profiles(user_id) ON DELETE CASCADE;

CREATE TABLE web_sessions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES user_profiles(user_id) ON DELETE CASCADE,
  owner_user_id uuid NOT NULL,
  session_hash text NOT NULL UNIQUE,
  csrf_hash text NOT NULL,
  refresh_ciphertext text NOT NULL,
  access_scope text NOT NULL DEFAULT 'full' CHECK (access_scope IN ('full', 'data-rights')),
  reauthenticated_at timestamptz NOT NULL DEFAULT now(),
  reauthenticated_method text CHECK (reauthenticated_method IN ('password','google')),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (owner_user_id) REFERENCES user_profiles(user_id) ON DELETE CASCADE,
  CHECK (user_id = owner_user_id)
);

CREATE TABLE account_data_export_jobs (
  id uuid PRIMARY KEY,
  owner_user_id uuid NOT NULL REFERENCES user_profiles(user_id) ON DELETE CASCADE,
  state text NOT NULL CHECK (state IN ('pending', 'running', 'ready', 'failed', 'expired')),
  format_version integer NOT NULL DEFAULT 1 CHECK (format_version = 1),
  record_count integer CHECK (record_count >= 1),
  byte_length bigint CHECK (byte_length >= 0),
  sha256 text CHECK (sha256 IS NULL OR sha256 ~ '^[0-9a-f]{64}$'),
  object_key text,
  lease_token_hash text,
  lease_expires_at timestamptz,
  expires_at timestamptz,
  last_error_code text CHECK (last_error_code IS NULL OR last_error_code IN (
    'export-build-failed', 'object-write-failed', 'object-delete-failed'
  )),
  revision integer NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((state = 'running') = (lease_token_hash IS NOT NULL AND lease_expires_at IS NOT NULL)),
  CHECK (state <> 'ready' OR (
    record_count IS NOT NULL AND byte_length IS NOT NULL AND sha256 IS NOT NULL
    AND object_key IS NOT NULL AND expires_at IS NOT NULL
  ))
);
CREATE UNIQUE INDEX account_data_export_jobs_one_open
  ON account_data_export_jobs(owner_user_id)
  WHERE state IN ('pending', 'running', 'ready');

CREATE TABLE account_deletion_jobs (
  id uuid PRIMARY KEY,
  subject_user_id uuid,
  subject_hash text NOT NULL,
  state text NOT NULL CHECK (state IN ('requested', 'running', 'failed', 'completed')),
  stage text NOT NULL CHECK (stage IN (
    'requested', 'exports-deleted', 'database-deleted', 'auth-deleted'
  )),
  request_key_hash text NOT NULL,
  request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  request_session_hash text,
  ack_expires_at timestamptz NOT NULL,
  lease_token_hash text,
  lease_expires_at timestamptz,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_error_code text CHECK (last_error_code IS NULL OR last_error_code IN (
    'object-delete-failed', 'database-delete-failed', 'auth-delete-failed'
  )),
  requested_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  completed_at timestamptz,
  CHECK ((state = 'running') = (lease_token_hash IS NOT NULL AND lease_expires_at IS NOT NULL)),
  CHECK (state <> 'completed' OR (
    subject_user_id IS NULL AND stage = 'auth-deleted' AND completed_at IS NOT NULL
  ))
);
CREATE UNIQUE INDEX account_deletion_jobs_one_subject
  ON account_deletion_jobs(subject_user_id) WHERE subject_user_id IS NOT NULL;

CREATE TABLE extension_sessions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES user_profiles(user_id) ON DELETE CASCADE,
  owner_user_id uuid NOT NULL,
  install_id_hash text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  device_label text NOT NULL CHECK (char_length(device_label) BETWEEN 1 AND 100),
  last_used_at timestamptz,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (owner_user_id) REFERENCES user_profiles(user_id) ON DELETE CASCADE,
  CHECK (user_id = owner_user_id)
);

CREATE TABLE extension_pairings (
  id uuid PRIMARY KEY,
  user_id uuid REFERENCES user_profiles(user_id) ON DELETE CASCADE,
  owner_user_id uuid,
  state_hash text NOT NULL UNIQUE,
  pkce_challenge text NOT NULL,
  install_id_hash text NOT NULL,
  device_label text,
  status text NOT NULL CHECK (status IN ('pending', 'approved', 'consumed', 'expired')),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (user_id IS NOT DISTINCT FROM owner_user_id)
);

CREATE TABLE admin_roles (
  user_id uuid PRIMARY KEY REFERENCES user_profiles(user_id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role = 'operator'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit_events (
  id uuid PRIMARY KEY,
  actor_user_id uuid NOT NULL,
  action text NOT NULL,
  subject_id uuid NOT NULL,
  safe_details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (jsonb_typeof(safe_details) = 'object')
);

CREATE TABLE study_captures (
  id uuid PRIMARY KEY,
  owner_user_id uuid NOT NULL REFERENCES user_profiles(user_id) ON DELETE CASCADE,
  selection_kind text NOT NULL CHECK (selection_kind IN ('phrase', 'sentence', 'passage')),
  source_text text NOT NULL CHECK (char_length(source_text) BETWEEN 1 AND 2000),
  normalized_text_hash text NOT NULL CHECK (normalized_text_hash ~ '^[0-9a-f]{64}$'),
  title text,
  user_context text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'analyzing', 'analyzed')),
  first_captured_at timestamptz NOT NULL,
  last_captured_at timestamptz NOT NULL,
  capture_count integer NOT NULL DEFAULT 1 CHECK (capture_count >= 1),
  revision integer NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_user_id, selection_kind, normalized_text_hash)
);

CREATE TABLE analysis_records (
  id uuid PRIMARY KEY,
  owner_user_id uuid NOT NULL REFERENCES user_profiles(user_id) ON DELETE CASCADE,
  study_capture_id uuid,
  review_state text NOT NULL CHECK (review_state IN ('pendingReview', 'reviewed')),
  archived_at timestamptz,
  source_type text NOT NULL CHECK (source_type IN ('manual', 'study-capture')),
  source_title text,
  source_context text,
  source_text text NOT NULL CHECK (char_length(source_text) <= 2000),
  source_normalized_hash text NOT NULL CHECK (source_normalized_hash ~ '^[0-9a-f]{64}$'),
  selection_kind text NOT NULL CHECK (selection_kind IN ('phrase', 'sentence', 'passage')),
  result jsonb NOT NULL,
  model_metadata jsonb NOT NULL,
  revision integer NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE analysis_candidates (
  id uuid PRIMARY KEY,
  analysis_id uuid NOT NULL REFERENCES analysis_records(id) ON DELETE CASCADE,
  owner_user_id uuid NOT NULL REFERENCES user_profiles(user_id) ON DELETE CASCADE,
  candidate_type text NOT NULL CHECK (candidate_type IN ('expression', 'sentence-pattern')),
  payload jsonb NOT NULL,
  analysis_unit_id text NOT NULL CHECK (analysis_unit_id ~ '^u([1-9]|[1-3][0-9]|40)$'),
  ordinal integer NOT NULL CHECK (ordinal >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (analysis_id, ordinal)
);

CREATE TABLE idempotency_records (
  owner_user_id uuid NOT NULL REFERENCES user_profiles(user_id) ON DELETE CASCADE,
  operation text NOT NULL,
  key text NOT NULL CHECK (char_length(key) BETWEEN 1 AND 128),
  request_hash text NOT NULL,
  response jsonb NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_user_id, operation, key)
);

CREATE TABLE analysis_requests (
  id uuid PRIMARY KEY,
  owner_user_id uuid NOT NULL REFERENCES user_profiles(user_id) ON DELETE CASCADE,
  study_capture_id uuid,
  capture_intent text CHECK (capture_intent IN ('initial', 'reanalysis')),
  idempotency_key text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 1 AND 128),
  request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  unit_count integer NOT NULL CHECK (unit_count BETWEEN 1 AND 40),
  state text NOT NULL CHECK (state IN ('running', 'completed', 'failed')),
  lease_token text NOT NULL,
  lease_expires_at timestamptz NOT NULL,
  reservation_id uuid,
  price_version_id uuid,
  dispatched_at timestamptz,
  recovery_ledger_id uuid NOT NULL,
  terminal_event jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_user_id, idempotency_key),
  CHECK ((state = 'running') = (terminal_event IS NULL)),
  CHECK (dispatched_at IS NULL OR (reservation_id IS NOT NULL AND price_version_id IS NOT NULL))
);

CREATE TABLE extension_query_generations (
  id uuid PRIMARY KEY,
  owner_user_id uuid NOT NULL REFERENCES user_profiles(user_id) ON DELETE CASCADE,
  idempotency_key text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 1 AND 128),
  request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  state text NOT NULL CHECK (state IN ('running', 'completed', 'failed')),
  request jsonb NOT NULL,
  lease_token text NOT NULL,
  lease_expires_at timestamptz NOT NULL,
  reservation_id uuid,
  price_version_id uuid,
  dispatched_at timestamptz,
  terminal_event jsonb,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_user_id, idempotency_key),
  CHECK (expires_at > created_at),
  CHECK ((state = 'running') = (terminal_event IS NULL)),
  CHECK (dispatched_at IS NULL OR (reservation_id IS NOT NULL AND price_version_id IS NOT NULL))
);

CREATE TABLE learning_duplicate_suggestion_requests (
  id uuid PRIMARY KEY,
  owner_user_id uuid NOT NULL REFERENCES user_profiles(user_id) ON DELETE CASCADE,
  source_item_id uuid NOT NULL,
  source_revision integer NOT NULL CHECK (source_revision >= 1),
  idempotency_key text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 1 AND 128),
  request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  state text NOT NULL CHECK (state IN ('pending', 'running', 'completed', 'failed')),
  generation integer NOT NULL DEFAULT 1 CHECK (generation >= 1),
  lease_token text NOT NULL,
  lease_expires_at timestamptz NOT NULL,
  dispatched_at timestamptz,
  reservation_id uuid,
  price_version_id uuid,
  candidate_aliases jsonb NOT NULL,
  response jsonb,
  stable_error_code text CHECK (stable_error_code IN ('model_output_invalid','model_unavailable')),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  UNIQUE (owner_user_id, idempotency_key),
  CHECK (jsonb_typeof(candidate_aliases) = 'array'),
  CHECK (jsonb_array_length(candidate_aliases) BETWEEN 1 AND 50),
  CHECK (expires_at > created_at AND expires_at <= created_at + interval '24 hours'),
  CHECK ((state = 'completed') = (response IS NOT NULL)),
  CHECK ((state = 'failed') = (stable_error_code IS NOT NULL)),
  CHECK (dispatched_at IS NULL OR (reservation_id IS NOT NULL AND price_version_id IS NOT NULL))
);
CREATE INDEX learning_duplicate_suggestion_requests_expiry
  ON learning_duplicate_suggestion_requests (expires_at, id)
  WHERE state IN ('completed','failed');
CREATE INDEX learning_duplicate_suggestion_requests_recovery
  ON learning_duplicate_suggestion_requests (lease_expires_at, id)
  WHERE state IN ('pending','running');

CREATE TABLE learning_items (
  id uuid PRIMARY KEY,
  owner_user_id uuid NOT NULL REFERENCES user_profiles(user_id) ON DELETE CASCADE,
  type text CHECK (type IN ('expression', 'sentence-pattern')),
  canonical_key text,
  content jsonb,
  system_attributes jsonb NOT NULL DEFAULT '[]'::jsonb,
  archived_at timestamptz,
  deleted_at timestamptz,
  revision integer NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_user_id, type, canonical_key),
  CHECK (
    (deleted_at IS NULL AND type IS NOT NULL AND canonical_key IS NOT NULL AND content IS NOT NULL)
    OR
    (deleted_at IS NOT NULL AND type IS NULL AND canonical_key IS NULL AND content IS NULL
      AND system_attributes = '[]'::jsonb AND archived_at IS NULL)
  )
);

CREATE TABLE source_examples (
  id uuid PRIMARY KEY,
  owner_user_id uuid NOT NULL REFERENCES user_profiles(user_id) ON DELETE CASCADE,
  learning_item_id uuid NOT NULL REFERENCES learning_items(id) ON DELETE CASCADE,
  analysis_id uuid REFERENCES analysis_records(id) ON DELETE SET NULL,
  analysis_unit_id text,
  source_text text NOT NULL,
  translation_zh text,
  source_type text NOT NULL,
  source_title text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE tags (
  id uuid PRIMARY KEY,
  owner_user_id uuid NOT NULL REFERENCES user_profiles(user_id) ON DELETE CASCADE,
  normalized_name text NOT NULL,
  display_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_user_id, normalized_name)
);

CREATE TABLE learning_item_tags (
  learning_item_id uuid NOT NULL REFERENCES learning_items(id) ON DELETE CASCADE,
  tag_id uuid NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  owner_user_id uuid NOT NULL REFERENCES user_profiles(user_id) ON DELETE CASCADE,
  PRIMARY KEY (learning_item_id, tag_id)
);

CREATE TABLE schedule_states (
  learning_item_id uuid PRIMARY KEY REFERENCES learning_items(id) ON DELETE CASCADE,
  owner_user_id uuid NOT NULL REFERENCES user_profiles(user_id) ON DELETE CASCADE,
  level integer NOT NULL CHECK (level BETWEEN -1 AND 5),
  due_at timestamptz,
  consecutive_mastered integer NOT NULL DEFAULT 0 CHECK (consecutive_mastered >= 0),
  last_rating text CHECK (last_rating IN ('forgot', 'effortful', 'mastered')),
  revision integer NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((level = -1 AND due_at IS NULL) OR (level >= 0 AND due_at IS NOT NULL))
);

CREATE TABLE word_entries (
  id uuid PRIMARY KEY,
  owner_user_id uuid NOT NULL REFERENCES user_profiles(user_id) ON DELETE CASCADE,
  headword text NOT NULL,
  canonical_key text NOT NULL,
  notes text,
  revision integer NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_user_id, canonical_key)
);

CREATE TABLE context_observations (
  id uuid PRIMARY KEY,
  owner_user_id uuid NOT NULL REFERENCES user_profiles(user_id) ON DELETE CASCADE,
  word_entry_id uuid NOT NULL REFERENCES word_entries(id) ON DELETE CASCADE,
  content_hash text NOT NULL,
  source_text text,
  source_title text,
  contextual_meaning text,
  source_type text NOT NULL,
  observed_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_user_id, word_entry_id, content_hash)
);

CREATE TABLE external_wordbook_jobs (
  id uuid PRIMARY KEY,
  owner_user_id uuid NOT NULL REFERENCES user_profiles(user_id) ON DELETE CASCADE,
  target text NOT NULL CHECK (target IN ('eudic', 'shanbay')),
  direction text NOT NULL CHECK (direction IN ('import', 'export')),
  state text NOT NULL CHECK (state IN (
    'pending', 'active', 'completed', 'failed', 'cancelled', 'source-limit-reached'
  )),
  next_page integer CHECK (next_page BETWEEN 0 AND 51),
  last_error_code text CHECK (last_error_code IN (
    'authentication-failed', 'credential-missing', 'data-corrupt', 'invalid-response',
    'network-error', 'rate-limited', 'timeout'
  )),
  lease_nonce_hash text CHECK (lease_nonce_hash ~ '^[0-9a-f]{64}$'),
  lease_expires_at timestamptz,
  revision integer NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (target <> 'shanbay' OR direction = 'export'),
  CHECK (
    (target = 'eudic' AND direction = 'import' AND next_page IS NOT NULL)
    OR (direction = 'export' AND next_page IS NULL)
  ),
  CHECK ((lease_nonce_hash IS NULL) = (lease_expires_at IS NULL)),
  CHECK (state <> 'source-limit-reached' OR (
    target = 'eudic' AND direction = 'import' AND next_page = 51
  ))
);
CREATE UNIQUE INDEX external_wordbook_jobs_one_open
  ON external_wordbook_jobs(owner_user_id, target, direction)
  WHERE state IN ('pending', 'active', 'failed');

CREATE TABLE external_wordbook_items (
  id uuid PRIMARY KEY,
  owner_user_id uuid NOT NULL REFERENCES user_profiles(user_id) ON DELETE CASCADE,
  job_id uuid NOT NULL REFERENCES external_wordbook_jobs(id) ON DELETE CASCADE,
  word_entry_id uuid NOT NULL REFERENCES word_entries(id) ON DELETE CASCADE,
  payload_snapshot jsonb NOT NULL,
  state text NOT NULL CHECK (state IN ('pending', 'in-flight', 'delivered', 'failed', 'cancelled')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  stable_error_code text CHECK (stable_error_code IN (
    'authentication-failed', 'credential-missing', 'data-corrupt', 'invalid-response',
    'network-error', 'rate-limited', 'timeout'
  )),
  receipt jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (job_id, word_entry_id),
  CHECK ((state = 'delivered') = (receipt IS NOT NULL)),
  CHECK (state <> 'failed' OR stable_error_code IS NOT NULL)
);

CREATE TABLE practice_sessions (
  id uuid PRIMARY KEY,
  owner_user_id uuid NOT NULL REFERENCES user_profiles(user_id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('sentence-creation', 'dialogue')),
  status text NOT NULL CHECK (status IN ('active', 'awaiting-feedback', 'completed', 'failed')),
  prompt text,
  dialogue_plan jsonb,
  final_feedback text,
  item_feedbacks jsonb,
  pending_generation text CHECK (pending_generation IN (
    'sentence-prompt','dialogue-start','assistant-turn','final-feedback'
  )),
  generation_lease_token text,
  generation_lease_expires_at timestamptz,
  current_generation_id uuid,
  completed_at timestamptz,
  revision integer NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((generation_lease_token IS NULL) = (generation_lease_expires_at IS NULL))
);

CREATE TABLE practice_session_items (
  session_id uuid NOT NULL REFERENCES practice_sessions(id) ON DELETE CASCADE,
  learning_item_id uuid NOT NULL REFERENCES learning_items(id) ON DELETE CASCADE,
  owner_user_id uuid NOT NULL REFERENCES user_profiles(user_id) ON DELETE CASCADE,
  position integer NOT NULL CHECK (position >= 0),
  rating text CHECK (rating IN ('forgot', 'effortful', 'mastered')),
  schedule_before jsonb NOT NULL,
  schedule_after jsonb,
  PRIMARY KEY (session_id, learning_item_id),
  UNIQUE (session_id, position)
);

CREATE TABLE practice_turns (
  id uuid PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES practice_sessions(id) ON DELETE CASCADE,
  owner_user_id uuid NOT NULL REFERENCES user_profiles(user_id) ON DELETE CASCADE,
  ordinal integer NOT NULL CHECK (ordinal >= 0),
  role text NOT NULL CHECK (role IN ('user', 'assistant')),
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, ordinal)
);

CREATE TABLE practice_attempts (
  id uuid PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES practice_sessions(id) ON DELETE CASCADE,
  owner_user_id uuid NOT NULL REFERENCES user_profiles(user_id) ON DELETE CASCADE,
  answer text NOT NULL,
  feedback text,
  feedback_lease_token text,
  feedback_lease_expires_at timestamptz,
  current_generation_id uuid,
  submitted_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id)
  ,CHECK ((feedback_lease_token IS NULL) = (feedback_lease_expires_at IS NULL))
);

CREATE TABLE practice_generation_tasks (
  id uuid PRIMARY KEY,
  owner_user_id uuid NOT NULL REFERENCES user_profiles(user_id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES practice_sessions(id) ON DELETE CASCADE,
  attempt_id uuid REFERENCES practice_attempts(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN (
    'sentence-prompt','sentence-feedback','dialogue-start',
    'dialogue-assistant','dialogue-final-feedback'
  )),
  state text NOT NULL CHECK (state IN (
    'claimed','reserved','dispatched','ready','applied','failed','abandoned'
  )),
  request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  lease_token text NOT NULL,
  lease_expires_at timestamptz NOT NULL,
  reservation_id uuid,
  price_version_id uuid,
  reserved_micro_usd bigint NOT NULL DEFAULT 0 CHECK (reserved_micro_usd >= 0),
  dispatched_at timestamptz,
  output jsonb,
  stable_error_code text CHECK (stable_error_code IN (
    'quota_exhausted','model_unavailable','model_output_invalid'
  )),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((attempt_id IS NOT NULL) = (kind = 'sentence-feedback')),
  CHECK (state <> 'ready' OR output IS NOT NULL),
  CHECK (state <> 'applied' OR output IS NULL),
  CHECK (state NOT IN ('failed','abandoned') OR stable_error_code IS NOT NULL),
  CHECK (state NOT IN ('reserved','dispatched','ready') OR reservation_id IS NOT NULL)
);

CREATE UNIQUE INDEX practice_generation_tasks_one_open
  ON practice_generation_tasks(session_id)
  WHERE state IN ('claimed','reserved','dispatched','ready');

CREATE UNIQUE INDEX practice_sessions_one_active
  ON practice_sessions(owner_user_id)
  WHERE status IN ('active', 'awaiting-feedback');

CREATE TABLE model_price_versions (
  id uuid PRIMARY KEY,
  provider text NOT NULL,
  model text NOT NULL,
  input_micro_usd_per_million bigint NOT NULL CHECK (input_micro_usd_per_million >= 0),
  cached_input_micro_usd_per_million bigint NOT NULL CHECK (cached_input_micro_usd_per_million >= 0),
  output_micro_usd_per_million bigint NOT NULL CHECK (output_micro_usd_per_million >= 0),
  effective_from timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, model, effective_from)
);

CREATE TABLE quota_grants (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES user_profiles(user_id) ON DELETE CASCADE,
  owner_user_id uuid NOT NULL,
  period_start timestamptz NOT NULL,
  period_end timestamptz NOT NULL,
  limit_micro_usd bigint NOT NULL CHECK (limit_micro_usd >= 0),
  source text NOT NULL CHECK (source IN ('default', 'admin')),
  supersedes_grant_id uuid REFERENCES quota_grants(id),
  superseded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (owner_user_id) REFERENCES user_profiles(user_id) ON DELETE CASCADE,
  CHECK (user_id = owner_user_id),
  CHECK (period_end > period_start),
  CHECK ((supersedes_grant_id IS NULL) OR (source = 'admin'))
);
CREATE UNIQUE INDEX quota_grants_one_current
  ON quota_grants (user_id, period_start) WHERE superseded_at IS NULL;

CREATE TABLE quota_reservations (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES user_profiles(user_id) ON DELETE CASCADE,
  owner_user_id uuid NOT NULL,
  request_id uuid NOT NULL UNIQUE,
  period_start timestamptz NOT NULL,
  reserved_micro_usd bigint NOT NULL CHECK (reserved_micro_usd > 0),
  status text NOT NULL CHECK (status IN ('active', 'settled', 'released')),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (owner_user_id) REFERENCES user_profiles(user_id) ON DELETE CASCADE,
  CHECK (user_id = owner_user_id)
);
CREATE UNIQUE INDEX quota_one_active_generation
  ON quota_reservations (user_id) WHERE status = 'active';

ALTER TABLE analysis_requests
  ADD FOREIGN KEY (reservation_id) REFERENCES quota_reservations(id),
  ADD FOREIGN KEY (price_version_id) REFERENCES model_price_versions(id);
ALTER TABLE extension_query_generations
  ADD FOREIGN KEY (reservation_id) REFERENCES quota_reservations(id),
  ADD FOREIGN KEY (price_version_id) REFERENCES model_price_versions(id);
ALTER TABLE learning_duplicate_suggestion_requests
  ADD FOREIGN KEY (reservation_id) REFERENCES quota_reservations(id),
  ADD FOREIGN KEY (price_version_id) REFERENCES model_price_versions(id);
ALTER TABLE practice_generation_tasks
  ADD FOREIGN KEY (reservation_id) REFERENCES quota_reservations(id),
  ADD FOREIGN KEY (price_version_id) REFERENCES model_price_versions(id);
ALTER TABLE practice_sessions
  ADD FOREIGN KEY (current_generation_id) REFERENCES practice_generation_tasks(id) ON DELETE SET NULL;
ALTER TABLE practice_attempts
  ADD FOREIGN KEY (current_generation_id) REFERENCES practice_generation_tasks(id) ON DELETE SET NULL;

CREATE TABLE usage_ledger (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES user_profiles(user_id) ON DELETE CASCADE,
  owner_user_id uuid NOT NULL,
  request_id uuid NOT NULL,
  call_ordinal integer NOT NULL CHECK (call_ordinal >= 0),
  period_start timestamptz NOT NULL,
  feature text NOT NULL,
  input_tokens integer CHECK (input_tokens >= 0),
  cached_input_tokens integer CHECK (cached_input_tokens >= 0),
  output_tokens integer CHECK (output_tokens >= 0),
  price_version_id uuid NOT NULL REFERENCES model_price_versions(id),
  cost_micro_usd bigint NOT NULL CHECK (cost_micro_usd >= 0),
  outcome text NOT NULL CHECK (outcome IN ('succeeded', 'failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (owner_user_id) REFERENCES user_profiles(user_id) ON DELETE CASCADE,
  CHECK (user_id = owner_user_id),
  UNIQUE (request_id, call_ordinal)
);

CREATE TABLE rate_limit_windows (
  subject_hash text NOT NULL,
  action text NOT NULL,
  window_start timestamptz NOT NULL,
  count integer NOT NULL CHECK (count >= 0),
  PRIMARY KEY (subject_hash, action, window_start)
);

CREATE TABLE runtime_controls (
  name text PRIMARY KEY,
  enabled boolean NOT NULL,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (name = 'model_kill_switch')
);

CREATE FUNCTION consume_rate_limit(
  request_subject_hash text,
  request_action text,
  request_window_start timestamptz,
  request_limit integer
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE new_count integer;
BEGIN
  IF request_limit <= 0 THEN RAISE EXCEPTION 'invalid rate limit'; END IF;
  INSERT INTO public.rate_limit_windows (subject_hash, action, window_start, count)
  VALUES (request_subject_hash, request_action, request_window_start, 1)
  ON CONFLICT (subject_hash, action, window_start) DO UPDATE
  SET count = public.rate_limit_windows.count + 1
  RETURNING count INTO new_count;
  RETURN new_count <= request_limit;
END;
$$;

CREATE FUNCTION require_admin_operator(actor_user_id uuid)
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT role FROM public.admin_roles WHERE user_id = actor_user_id AND role = 'operator';
$$;

CREATE FUNCTION admin_create_invitation(
  invitation_id uuid,
  invitation_token_hash text,
  invitation_expires_at timestamptz,
  actor_user_id uuid,
  audit_id uuid
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  IF public.require_admin_operator(actor_user_id) IS DISTINCT FROM 'operator' THEN
    RAISE EXCEPTION 'administrator required';
  END IF;
  INSERT INTO public.invitations (id, token_hash, expires_at, created_by)
  VALUES (invitation_id, invitation_token_hash, invitation_expires_at, actor_user_id);
  INSERT INTO public.audit_events (id, actor_user_id, action, subject_id)
  VALUES (audit_id, actor_user_id, 'invitation.created', invitation_id);
  RETURN invitation_id;
END;
$$;

CREATE FUNCTION admin_set_quota(
  actor_user_id uuid,
  account_user_id uuid,
  new_grant_id uuid,
  grant_period_start timestamptz,
  grant_period_end timestamptz,
  new_limit_micro_usd bigint,
  audit_id uuid
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  IF public.require_admin_operator(actor_user_id) IS DISTINCT FROM 'operator' THEN
    RAISE EXCEPTION 'administrator required';
  END IF;
  PERFORM public.replace_quota_grant(
    new_grant_id, account_user_id, grant_period_start, grant_period_end,
    new_limit_micro_usd, 'admin'
  );
  INSERT INTO public.audit_events (id, actor_user_id, action, subject_id, safe_details)
  VALUES (
    audit_id, actor_user_id, 'quota.granted', account_user_id,
    jsonb_build_object('limitMicroUsd', new_limit_micro_usd)
  );
  RETURN new_grant_id;
END;
$$;

CREATE FUNCTION admin_set_user_status(
  actor_user_id uuid,
  account_user_id uuid,
  new_status text,
  audit_id uuid
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE current_status text;
BEGIN
  IF public.require_admin_operator(actor_user_id) IS DISTINCT FROM 'operator'
    OR new_status NOT IN ('active', 'disabled') THEN RAISE EXCEPTION 'administrator required'; END IF;
  IF actor_user_id = account_user_id THEN RAISE EXCEPTION 'self status change forbidden'; END IF;
  SELECT status INTO current_status FROM public.user_profiles
  WHERE user_id = account_user_id FOR UPDATE;
  IF current_status IS NULL
    OR (new_status = 'disabled' AND current_status <> 'active')
    OR (new_status = 'active' AND current_status <> 'disabled')
  THEN RAISE EXCEPTION 'revision conflict'; END IF;
  UPDATE public.user_profiles SET status = new_status, updated_at = now()
  WHERE user_id = account_user_id;
  IF new_status = 'disabled' THEN
    UPDATE public.web_sessions SET revoked_at = now()
    WHERE user_id = account_user_id AND revoked_at IS NULL;
    UPDATE public.extension_sessions SET revoked_at = now()
    WHERE user_id = account_user_id AND revoked_at IS NULL;
    UPDATE public.extension_pairings SET status = 'expired'
    WHERE user_id = account_user_id AND status IN ('pending', 'approved');
  END IF;
  INSERT INTO public.audit_events (id, actor_user_id, action, subject_id)
  VALUES (
    audit_id, actor_user_id,
    CASE WHEN new_status = 'active' THEN 'user.enabled' ELSE 'user.disabled' END,
    account_user_id
  );
  RETURN account_user_id;
END;
$$;

CREATE FUNCTION admin_revoke_devices(
  actor_user_id uuid,
  account_user_id uuid,
  audit_id uuid
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE revoked_count integer;
BEGIN
  IF public.require_admin_operator(actor_user_id) IS DISTINCT FROM 'operator' THEN
    RAISE EXCEPTION 'administrator required';
  END IF;
  WITH revoked AS (
    UPDATE public.extension_sessions SET revoked_at = now()
    WHERE user_id = account_user_id AND revoked_at IS NULL RETURNING 1
  ) SELECT count(*)::integer INTO revoked_count FROM revoked;
  INSERT INTO public.audit_events (id, actor_user_id, action, subject_id, safe_details)
  VALUES (
    audit_id, actor_user_id, 'devices.revoked', account_user_id,
    jsonb_build_object('revokedCount', revoked_count)
  );
  RETURN revoked_count;
END;
$$;

CREATE FUNCTION admin_list_users(
  actor_user_id uuid, email_query text, status_filter text,
  cursor_created_at timestamptz, cursor_id uuid, page_limit integer,
  period_start timestamptz, period_end timestamptz
) RETURNS TABLE(
  id uuid, email text, status text, created_at timestamptz, device_count bigint,
  limit_micro_usd bigint, used_micro_usd bigint, reserved_micro_usd bigint
) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF public.require_admin_operator(actor_user_id) IS DISTINCT FROM 'operator'
    OR page_limit NOT BETWEEN 1 AND 101
    OR status_filter IS NOT NULL AND status_filter NOT IN ('active','disabled','deleting')
  THEN RAISE EXCEPTION 'administrator required'; END IF;
  RETURN QUERY
  SELECT profiles.user_id,profiles.email,profiles.status,profiles.created_at,
    (SELECT count(*) FROM public.extension_sessions sessions
      WHERE sessions.user_id=profiles.user_id AND sessions.revoked_at IS NULL
        AND sessions.expires_at>now()),
    COALESCE((SELECT grants.limit_micro_usd FROM public.quota_grants grants
      WHERE grants.user_id=profiles.user_id AND grants.period_start=admin_list_users.period_start
        AND grants.superseded_at IS NULL),0),
    COALESCE((SELECT sum(ledger.cost_micro_usd) FROM public.usage_ledger ledger
      WHERE ledger.user_id=profiles.user_id AND ledger.period_start=admin_list_users.period_start),0)::bigint,
    COALESCE((SELECT sum(reservations.reserved_micro_usd)
      FROM public.quota_reservations reservations
      WHERE reservations.user_id=profiles.user_id
        AND reservations.period_start=admin_list_users.period_start
        AND reservations.status='active' AND reservations.expires_at>now()),0)::bigint
  FROM public.user_profiles profiles
  WHERE (email_query IS NULL OR position(email_query IN profiles.email)>0)
    AND (status_filter IS NULL OR profiles.status=status_filter)
    AND (cursor_created_at IS NULL OR (profiles.created_at,profiles.user_id)<
      (cursor_created_at,cursor_id))
  ORDER BY profiles.created_at DESC,profiles.user_id DESC LIMIT page_limit;
END;
$$;

CREATE FUNCTION admin_list_invitations(
  actor_user_id uuid, cursor_created_at timestamptz, cursor_id uuid, page_limit integer
) RETURNS TABLE(
  id uuid, created_at timestamptz, expires_at timestamptz,
  consumed_at timestamptz, revoked_at timestamptz
) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF public.require_admin_operator(actor_user_id) IS DISTINCT FROM 'operator'
    OR page_limit NOT BETWEEN 1 AND 101
  THEN RAISE EXCEPTION 'administrator required'; END IF;
  RETURN QUERY SELECT invitations.id,invitations.created_at,invitations.expires_at,
    invitations.consumed_at,invitations.revoked_at FROM public.invitations invitations
  WHERE cursor_created_at IS NULL OR (invitations.created_at,invitations.id)<
    (cursor_created_at,cursor_id)
  ORDER BY invitations.created_at DESC,invitations.id DESC LIMIT page_limit;
END;
$$;

CREATE FUNCTION admin_list_audit_events(
  actor_user_id uuid, action_filter text, cursor_created_at timestamptz,
  cursor_id uuid, page_limit integer
) RETURNS TABLE(
  id uuid, actor_id uuid, action text, subject_id uuid, safe_details jsonb,
  created_at timestamptz
) LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF public.require_admin_operator(actor_user_id) IS DISTINCT FROM 'operator'
    OR page_limit NOT BETWEEN 1 AND 101
  THEN RAISE EXCEPTION 'administrator required'; END IF;
  RETURN QUERY SELECT events.id,events.actor_user_id,events.action,events.subject_id,
    events.safe_details,events.created_at FROM public.audit_events events
  WHERE (action_filter IS NULL OR events.action=action_filter)
    AND (cursor_created_at IS NULL OR (events.created_at,events.id)<
      (cursor_created_at,cursor_id))
  ORDER BY events.created_at DESC,events.id DESC LIMIT page_limit;
END;
$$;

CREATE FUNCTION admin_usage_summary(
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
    COALESCE((SELECT enabled FROM public.runtime_controls
      WHERE name='model_kill_switch'),false),
    COALESCE((SELECT updated_at FROM public.runtime_controls
      WHERE name='model_kill_switch'),admin_usage_summary.period_start);
END;
$$;

CREATE FUNCTION admin_execute(
  actor_user_id uuid, operation_name text, idempotency_key text, presented_request_hash text,
  target_id uuid, payload jsonb, invitation_token_hash text, operation_time timestamptz,
  response_expires_at timestamptz, new_resource_id uuid, audit_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE existing jsonb; result jsonb; current_status text; revoked_web integer;
  revoked_extensions integer; expired_pairings integer; quota_period_start timestamptz;
  quota_period_end timestamptz; used_micro_usd bigint; reserved_micro_usd bigint;
  limit_micro_usd bigint; percent_used numeric; invitation_row public.invitations%ROWTYPE;
BEGIN
  IF public.require_admin_operator(actor_user_id) IS DISTINCT FROM 'operator'
    OR operation_name NOT IN (
      'admin.invitation-create','admin.invitation-revoke','admin.user-status',
      'admin.devices-revoke','admin.quota-set','admin.kill-switch-set'
    ) OR char_length(idempotency_key) NOT BETWEEN 1 AND 128
    OR presented_request_hash !~ '^[0-9a-f]{64}$' OR response_expires_at<=operation_time
  THEN RAISE EXCEPTION 'administrator required'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    actor_user_id::text||':'||operation_name||':'||idempotency_key,4));
  SELECT records.response INTO existing FROM public.idempotency_records records
  WHERE records.owner_user_id=actor_user_id AND records.operation=operation_name
    AND records.key=idempotency_key AND records.request_hash=presented_request_hash;
  IF FOUND THEN RETURN existing; END IF;
  IF EXISTS (SELECT 1 FROM public.idempotency_records WHERE owner_user_id=actor_user_id
    AND operation=operation_name AND key=idempotency_key) THEN RAISE EXCEPTION 'idempotency conflict'; END IF;

  IF operation_name='admin.invitation-create' THEN
    INSERT INTO public.invitations(id,token_hash,expires_at,created_by,created_at)
    VALUES(new_resource_id,invitation_token_hash,
      operation_time+((payload->>'expiresInHours')::integer*interval '1 hour'),actor_user_id,
      operation_time) RETURNING * INTO invitation_row;
    result=jsonb_build_object('id',invitation_row.id::text,'createdAt',invitation_row.created_at,
      'expiresAt',invitation_row.expires_at,'consumedAt',NULL,'revokedAt',NULL);
    INSERT INTO public.audit_events(id,actor_user_id,action,subject_id,safe_details,created_at)
    VALUES(audit_id,actor_user_id,'invitation.created',new_resource_id,
      jsonb_build_object('expiresInHours',(payload->>'expiresInHours')::integer),operation_time);
  ELSIF operation_name='admin.invitation-revoke' THEN
    UPDATE public.invitations SET revoked_at=operation_time WHERE id=target_id
      AND revoked_at IS NULL AND consumed_at IS NULL RETURNING * INTO invitation_row;
    IF invitation_row.id IS NULL THEN RAISE EXCEPTION 'invitation not found'; END IF;
    result=jsonb_build_object('id',target_id::text,'revoked',true);
    INSERT INTO public.audit_events(
      id,actor_user_id,action,subject_id,safe_details,created_at
    ) VALUES(audit_id,actor_user_id,'invitation.revoked',target_id,'{}',operation_time);
  ELSIF operation_name='admin.user-status' THEN
    IF target_id=actor_user_id THEN RAISE EXCEPTION 'self status change forbidden'; END IF;
    SELECT status INTO current_status FROM public.user_profiles WHERE user_id=target_id FOR UPDATE;
    IF (payload->>'action'='disable' AND current_status<>'active') OR
       (payload->>'action'='enable' AND current_status<>'disabled') OR current_status IS NULL
    THEN RAISE EXCEPTION 'revision conflict'; END IF;
    UPDATE public.user_profiles SET status=CASE WHEN payload->>'action'='disable'
      THEN 'disabled' ELSE 'active' END,updated_at=operation_time WHERE user_id=target_id;
    revoked_web=0;revoked_extensions=0;expired_pairings=0;
    IF payload->>'action'='disable' THEN
      WITH changed AS (UPDATE public.web_sessions SET revoked_at=operation_time
        WHERE user_id=target_id AND revoked_at IS NULL RETURNING 1)
        SELECT count(*)::integer INTO revoked_web FROM changed;
      WITH changed AS (UPDATE public.extension_sessions SET revoked_at=operation_time
        WHERE user_id=target_id AND revoked_at IS NULL RETURNING 1)
        SELECT count(*)::integer INTO revoked_extensions FROM changed;
      WITH changed AS (UPDATE public.extension_pairings SET status='expired'
        WHERE user_id=target_id AND status IN ('pending','approved') RETURNING 1)
        SELECT count(*)::integer INTO expired_pairings FROM changed;
    END IF;
    current_status=CASE WHEN payload->>'action'='disable' THEN 'disabled' ELSE 'active' END;
    result=jsonb_build_object('id',target_id::text,'status',current_status);
    INSERT INTO public.audit_events(id,actor_user_id,action,subject_id,safe_details,created_at)
    VALUES(audit_id,actor_user_id,CASE WHEN current_status='disabled' THEN 'user.disabled'
      ELSE 'user.enabled' END,target_id,CASE WHEN current_status='disabled' THEN
      jsonb_build_object('webSessions',revoked_web,'extensionSessions',revoked_extensions,
        'pairings',expired_pairings) ELSE '{}'::jsonb END,operation_time);
  ELSIF operation_name='admin.devices-revoke' THEN
    PERFORM 1 FROM public.user_profiles WHERE user_id=target_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'user not found'; END IF;
    WITH changed AS (UPDATE public.extension_sessions SET revoked_at=operation_time
      WHERE user_id=target_id AND revoked_at IS NULL RETURNING 1)
      SELECT count(*)::integer INTO revoked_extensions FROM changed;
    result=jsonb_build_object('revokedCount',revoked_extensions);
    INSERT INTO public.audit_events(
      id,actor_user_id,action,subject_id,safe_details,created_at
    ) VALUES(audit_id,actor_user_id,'devices.revoked',target_id,
      jsonb_build_object('revokedCount',revoked_extensions),operation_time);
  ELSIF operation_name='admin.quota-set' THEN
    quota_period_start=(payload->>'periodStart')::timestamptz;
    IF quota_period_start IS DISTINCT FROM
      (date_trunc('month',quota_period_start AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')
      OR quota_period_start <
      (date_trunc('month',operation_time AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')
    THEN RAISE EXCEPTION 'invalid quota period'; END IF;
    PERFORM 1 FROM public.user_profiles WHERE user_id=target_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'user not found'; END IF;
    quota_period_end=quota_period_start+interval '1 month';
    limit_micro_usd=(payload->>'limitMicroUsd')::bigint;
    PERFORM public.replace_quota_grant(new_resource_id,target_id,quota_period_start,quota_period_end,
      limit_micro_usd,'admin');
    SELECT COALESCE(sum(cost_micro_usd),0) INTO used_micro_usd
    FROM public.usage_ledger WHERE user_id=target_id
      AND usage_ledger.period_start=quota_period_start;
    SELECT COALESCE(sum(quota_reservations.reserved_micro_usd),0) INTO reserved_micro_usd
    FROM public.quota_reservations WHERE user_id=target_id
      AND quota_reservations.period_start=quota_period_start
      AND status='active' AND expires_at>operation_time;
    percent_used=CASE WHEN limit_micro_usd=0 THEN 100
      ELSE least(100,used_micro_usd*100.0/limit_micro_usd) END;
    result=jsonb_build_object('id',target_id::text,'quota',jsonb_build_object(
      'periodStart',quota_period_start,'periodEnd',quota_period_end,'limitMicroUsd',limit_micro_usd,
      'usedMicroUsd',used_micro_usd,'reservedMicroUsd',reserved_micro_usd,
      'availableMicroUsd',greatest(0,limit_micro_usd-used_micro_usd-reserved_micro_usd),
      'percentUsed',percent_used,'warning',CASE
        WHEN used_micro_usd+reserved_micro_usd>=limit_micro_usd THEN 'exhausted'
        WHEN percent_used>=80 THEN 'warning' ELSE 'available' END));
    INSERT INTO public.audit_events(
      id,actor_user_id,action,subject_id,safe_details,created_at
    ) VALUES(audit_id,actor_user_id,'quota.granted',target_id,
      jsonb_build_object('limitMicroUsd',(payload->>'limitMicroUsd')::bigint,
        'periodStart',quota_period_start),operation_time);
  ELSE
    INSERT INTO public.runtime_controls(name,enabled,updated_by,updated_at)
    VALUES('model_kill_switch',(payload->>'enabled')::boolean,actor_user_id,operation_time)
    ON CONFLICT(name) DO UPDATE SET enabled=excluded.enabled,updated_by=excluded.updated_by,
      updated_at=excluded.updated_at;
    result=jsonb_build_object('enabled',(payload->>'enabled')::boolean,'updatedAt',operation_time);
    INSERT INTO public.audit_events(
      id,actor_user_id,action,subject_id,safe_details,created_at
    ) VALUES(audit_id,actor_user_id,'model.kill-switch-set',actor_user_id,
      jsonb_build_object('enabled',(payload->>'enabled')::boolean),operation_time);
  END IF;
  INSERT INTO public.idempotency_records(owner_user_id,operation,key,request_hash,response,expires_at,
    created_at) VALUES(actor_user_id,operation_name,idempotency_key,presented_request_hash,result,
      response_expires_at,operation_time);
  RETURN result;
END;
$$;

CREATE FUNCTION replace_quota_grant(
  new_grant_id uuid,
  account_user_id uuid,
  grant_period_start timestamptz,
  grant_period_end timestamptz,
  new_limit_micro_usd bigint,
  grant_source text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE previous_grant_id uuid;
BEGIN
  IF new_limit_micro_usd < 0 OR grant_period_end <= grant_period_start THEN
    RAISE EXCEPTION 'invalid quota grant';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(account_user_id::text, 1));
  SELECT id INTO previous_grant_id
  FROM public.quota_grants
  WHERE user_id = account_user_id
    AND period_start = grant_period_start
    AND superseded_at IS NULL
  FOR UPDATE;
  IF previous_grant_id IS NOT NULL THEN
    UPDATE public.quota_grants
    SET superseded_at = now()
    WHERE id = previous_grant_id;
  END IF;
  INSERT INTO public.quota_grants (
    id, user_id, owner_user_id, period_start, period_end, limit_micro_usd, source,
    supersedes_grant_id
  ) VALUES (
    new_grant_id, account_user_id, account_user_id, grant_period_start, grant_period_end,
    new_limit_micro_usd, grant_source, previous_grant_id
  );
  RETURN new_grant_id;
END;
$$;

CREATE INDEX analysis_records_owner_created ON analysis_records (owner_user_id, created_at, id);
CREATE INDEX study_captures_owner_created ON study_captures (owner_user_id, created_at, id);
CREATE UNIQUE INDEX analysis_requests_one_running_capture
  ON analysis_requests (owner_user_id, study_capture_id)
  WHERE state='running' AND study_capture_id IS NOT NULL;
CREATE INDEX extension_query_generations_expiry ON extension_query_generations (expires_at);
CREATE INDEX learning_items_owner_created ON learning_items (owner_user_id, created_at, id);
CREATE INDEX learning_items_owner_archive_created
  ON learning_items (owner_user_id, archived_at, created_at, id);
CREATE INDEX word_entries_owner_created ON word_entries (owner_user_id, created_at, id);
CREATE INDEX practice_sessions_owner_created ON practice_sessions (owner_user_id, created_at, id);
CREATE INDEX quota_reservations_expiry ON quota_reservations (expires_at) WHERE status = 'active';

ALTER TABLE analysis_records ADD CONSTRAINT analysis_records_owner_key UNIQUE (id, owner_user_id);
ALTER TABLE study_captures ADD CONSTRAINT study_captures_owner_key UNIQUE (id, owner_user_id);
ALTER TABLE learning_items ADD CONSTRAINT learning_items_owner_key UNIQUE (id, owner_user_id);
ALTER TABLE tags ADD CONSTRAINT tags_owner_key UNIQUE (id, owner_user_id);
ALTER TABLE word_entries ADD CONSTRAINT word_entries_owner_key UNIQUE (id, owner_user_id);
ALTER TABLE external_wordbook_jobs
  ADD CONSTRAINT external_wordbook_jobs_owner_key UNIQUE (id, owner_user_id);
ALTER TABLE practice_sessions
  ADD CONSTRAINT practice_sessions_owner_key UNIQUE (id, owner_user_id);
ALTER TABLE analysis_candidates
  ADD CONSTRAINT analysis_candidates_analysis_owner_fk
  FOREIGN KEY (analysis_id, owner_user_id)
  REFERENCES analysis_records (id, owner_user_id) ON DELETE CASCADE;
ALTER TABLE learning_duplicate_suggestion_requests
  ADD CONSTRAINT learning_duplicate_suggestion_requests_source_owner_fk
  FOREIGN KEY (source_item_id, owner_user_id)
  REFERENCES learning_items (id, owner_user_id) ON DELETE CASCADE;
ALTER TABLE analysis_records
  ADD CONSTRAINT analysis_records_study_capture_owner_fk
  FOREIGN KEY (study_capture_id, owner_user_id)
  REFERENCES study_captures (id, owner_user_id) ON DELETE SET NULL (study_capture_id);
ALTER TABLE analysis_requests
  ADD CONSTRAINT analysis_requests_study_capture_owner_fk
  FOREIGN KEY (study_capture_id, owner_user_id)
  REFERENCES study_captures (id, owner_user_id) ON DELETE SET NULL (study_capture_id);
ALTER TABLE source_examples
  ADD CONSTRAINT source_examples_learning_item_owner_fk
  FOREIGN KEY (learning_item_id, owner_user_id)
  REFERENCES learning_items (id, owner_user_id) ON DELETE CASCADE;
ALTER TABLE source_examples
  ADD CONSTRAINT source_examples_analysis_owner_fk
  FOREIGN KEY (analysis_id, owner_user_id)
  REFERENCES analysis_records (id, owner_user_id) ON DELETE SET NULL (analysis_id);
ALTER TABLE learning_item_tags
  ADD CONSTRAINT learning_item_tags_learning_item_owner_fk
  FOREIGN KEY (learning_item_id, owner_user_id)
  REFERENCES learning_items (id, owner_user_id) ON DELETE CASCADE;
ALTER TABLE learning_item_tags
  ADD CONSTRAINT learning_item_tags_tag_owner_fk
  FOREIGN KEY (tag_id, owner_user_id)
  REFERENCES tags (id, owner_user_id) ON DELETE CASCADE;
ALTER TABLE schedule_states
  ADD CONSTRAINT schedule_states_learning_item_owner_fk
  FOREIGN KEY (learning_item_id, owner_user_id)
  REFERENCES learning_items (id, owner_user_id) ON DELETE CASCADE;
ALTER TABLE context_observations
  ADD CONSTRAINT context_observations_word_entry_owner_fk
  FOREIGN KEY (word_entry_id, owner_user_id)
  REFERENCES word_entries (id, owner_user_id) ON DELETE CASCADE;
ALTER TABLE external_wordbook_items
  ADD CONSTRAINT external_wordbook_items_job_owner_fk
  FOREIGN KEY (job_id, owner_user_id)
  REFERENCES external_wordbook_jobs (id, owner_user_id) ON DELETE CASCADE;
ALTER TABLE external_wordbook_items
  ADD CONSTRAINT external_wordbook_items_word_entry_owner_fk
  FOREIGN KEY (word_entry_id, owner_user_id)
  REFERENCES word_entries (id, owner_user_id) ON DELETE CASCADE;
ALTER TABLE practice_session_items
  ADD CONSTRAINT practice_session_items_session_owner_fk
  FOREIGN KEY (session_id, owner_user_id)
  REFERENCES practice_sessions (id, owner_user_id) ON DELETE CASCADE;
ALTER TABLE practice_session_items
  ADD CONSTRAINT practice_session_items_learning_item_owner_fk
  FOREIGN KEY (learning_item_id, owner_user_id)
  REFERENCES learning_items (id, owner_user_id) ON DELETE CASCADE;
ALTER TABLE practice_turns
  ADD CONSTRAINT practice_turns_session_owner_fk
  FOREIGN KEY (session_id, owner_user_id)
  REFERENCES practice_sessions (id, owner_user_id) ON DELETE CASCADE;
ALTER TABLE practice_attempts
  ADD CONSTRAINT practice_attempts_session_owner_fk
  FOREIGN KEY (session_id, owner_user_id)
  REFERENCES practice_sessions (id, owner_user_id) ON DELETE CASCADE;
ALTER TABLE practice_generation_tasks
  ADD CONSTRAINT practice_generation_tasks_session_owner_fk
  FOREIGN KEY (session_id, owner_user_id)
  REFERENCES practice_sessions (id, owner_user_id) ON DELETE CASCADE;

CREATE FUNCTION prevent_usage_ledger_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('huayi.account_deletion', true) = 'on' AND TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'usage ledger is append-only';
END;
$$;
CREATE TRIGGER usage_ledger_no_update_delete
BEFORE UPDATE OR DELETE ON usage_ledger
FOR EACH ROW EXECUTE FUNCTION prevent_usage_ledger_mutation();

CREATE FUNCTION prevent_model_price_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'model price versions are immutable';
END;
$$;
CREATE TRIGGER model_price_no_update_delete
BEFORE UPDATE OR DELETE ON model_price_versions
FOR EACH ROW EXECUTE FUNCTION prevent_model_price_mutation();

CREATE FUNCTION claim_invitation(
  invitation_token_hash text,
  new_ticket_hash text,
  ticket_expires_at timestamptz
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE claimed_id uuid;
BEGIN
  SELECT id INTO claimed_id
  FROM public.invitations
  WHERE token_hash = invitation_token_hash
    AND expires_at > now()
    AND revoked_at IS NULL
    AND consumed_at IS NULL
  FOR UPDATE;
  IF claimed_id IS NULL THEN RETURN NULL; END IF;
  IF EXISTS (
    SELECT 1 FROM public.invitation_claims
    WHERE invitation_id = claimed_id
      AND finalized_user_id IS NULL
      AND expires_at > now()
  ) THEN RETURN NULL; END IF;
  DELETE FROM public.invitation_claims
  WHERE invitation_id = claimed_id
    AND finalized_user_id IS NULL
    AND expires_at <= now();
  INSERT INTO public.invitation_claims (ticket_hash, invitation_id, expires_at)
  VALUES (new_ticket_hash, claimed_id, ticket_expires_at)
  ON CONFLICT (ticket_hash) DO NOTHING;
  RETURN claimed_id;
END;
$$;

CREATE FUNCTION require_claim_ticket(presented_ticket_hash text)
RETURNS timestamptz
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT claims.expires_at
  FROM public.invitation_claims AS claims
  JOIN public.invitations AS invitations ON invitations.id = claims.invitation_id
  WHERE claims.ticket_hash = presented_ticket_hash
    AND claims.expires_at > now()
    AND invitations.expires_at > now()
    AND invitations.revoked_at IS NULL
    AND invitations.consumed_at IS NULL;
$$;

CREATE FUNCTION create_auth_flow(
  presented_ticket_hash text,
  new_flow_hash text,
  flow_expires_at timestamptz
) RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  INSERT INTO public.auth_flows (flow_hash, ticket_hash, expires_at)
  SELECT new_flow_hash, presented_ticket_hash, flow_expires_at
  FROM public.invitation_claims AS claims
  JOIN public.invitations AS invitations ON invitations.id = claims.invitation_id
  WHERE claims.ticket_hash = presented_ticket_hash
    AND claims.expires_at > now()
    AND claims.finalized_user_id IS NULL
    AND invitations.expires_at > now()
    AND invitations.revoked_at IS NULL
    AND invitations.consumed_at IS NULL
  ON CONFLICT (flow_hash) DO NOTHING
  RETURNING flow_hash;
$$;

CREATE FUNCTION create_login_auth_flow(new_flow_hash text, flow_expires_at timestamptz)
RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
  INSERT INTO public.auth_flows(flow_hash,kind,ticket_hash,expires_at)
  VALUES(new_flow_hash,'login',NULL,flow_expires_at)
  ON CONFLICT(flow_hash) DO NOTHING RETURNING flow_hash;
$$;

CREATE FUNCTION consume_auth_flow(presented_flow_hash text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE consumed_ticket_hash text;
BEGIN
  UPDATE public.auth_flows
  SET consumed_at = now()
  WHERE flow_hash = presented_flow_hash
    AND kind='invite-registration'
    AND consumed_at IS NULL
    AND expires_at > now()
  RETURNING ticket_hash INTO consumed_ticket_hash;
  RETURN consumed_ticket_hash;
END;
$$;

CREATE FUNCTION save_auth_flow_state(presented_flow_hash text, protected_provider_state text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  UPDATE public.auth_flows
  SET provider_state_ciphertext = protected_provider_state
  WHERE flow_hash = presented_flow_hash
    AND consumed_at IS NULL
    AND expires_at > now()
    AND (kind<>'reauthenticate-google' OR started_at IS NOT NULL)
  RETURNING true;
$$;

CREATE FUNCTION read_auth_flow_state(presented_flow_hash text)
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT provider_state_ciphertext FROM public.auth_flows
  WHERE flow_hash = presented_flow_hash
    AND consumed_at IS NULL
    AND expires_at > now()
    AND (kind<>'reauthenticate-google' OR started_at IS NOT NULL)
    AND provider_state_ciphertext IS NOT NULL;
$$;

CREATE FUNCTION create_google_reauthentication(
  new_flow_hash text,
  presented_session_hash text,
  presented_csrf_hash text,
  flow_expires_at timestamptz
) RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path=pg_catalog
AS $$
  INSERT INTO public.auth_flows(
    flow_hash,kind,owner_user_id,web_session_hash,expires_at
  )
  SELECT new_flow_hash,'reauthenticate-google',sessions.user_id,presented_session_hash,
    flow_expires_at
  FROM public.web_sessions AS sessions
  JOIN public.user_profiles AS profiles ON profiles.user_id=sessions.user_id
  JOIN public.account_sign_in_methods AS methods
    ON methods.owner_user_id=sessions.user_id AND methods.method='google'
  WHERE sessions.session_hash=presented_session_hash
    AND sessions.csrf_hash=presented_csrf_hash
    AND sessions.revoked_at IS NULL
    AND sessions.expires_at>now()
    AND sessions.access_scope='full'
    AND profiles.status='active'
    AND flow_expires_at>now()
  ON CONFLICT(flow_hash) DO NOTHING
  RETURNING owner_user_id;
$$;

CREATE FUNCTION continue_google_reauthentication(
  presented_flow_hash text,
  presented_session_hash text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog
AS $$
DECLARE account_user_id uuid;
BEGIN
  SELECT flows.owner_user_id INTO account_user_id
  FROM public.auth_flows AS flows
  JOIN public.web_sessions AS sessions
    ON sessions.session_hash=flows.web_session_hash AND sessions.user_id=flows.owner_user_id
  JOIN public.user_profiles AS profiles ON profiles.user_id=sessions.user_id
  JOIN public.account_sign_in_methods AS methods
    ON methods.owner_user_id=sessions.user_id AND methods.method='google'
  WHERE flows.flow_hash=presented_flow_hash
    AND flows.kind='reauthenticate-google'
    AND flows.web_session_hash=presented_session_hash
    AND flows.started_at IS NULL
    AND flows.consumed_at IS NULL
    AND flows.expires_at>now()
    AND sessions.revoked_at IS NULL
    AND sessions.expires_at>now()
    AND sessions.access_scope='full'
    AND profiles.status='active'
  FOR UPDATE OF flows, sessions, profiles;
  IF account_user_id IS NULL THEN RETURN NULL; END IF;
  UPDATE public.auth_flows SET started_at=now() WHERE flow_hash=presented_flow_hash;
  RETURN account_user_id;
END;
$$;

CREATE FUNCTION complete_google_reauthentication(
  presented_flow_hash text,
  presented_session_hash text,
  provider_user_id uuid,
  new_session_id uuid,
  new_session_hash text,
  new_csrf_hash text,
  new_refresh_ciphertext text,
  session_expires_at timestamptz
) RETURNS TABLE(id uuid, access_scope text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog
AS $$
DECLARE
  account_user_id uuid;
  operation_time timestamptz := now();
BEGIN
  SELECT flows.owner_user_id INTO account_user_id
  FROM public.auth_flows AS flows
  JOIN public.web_sessions AS sessions
    ON sessions.session_hash=flows.web_session_hash AND sessions.user_id=flows.owner_user_id
  JOIN public.user_profiles AS profiles ON profiles.user_id=sessions.user_id
  JOIN public.account_sign_in_methods AS methods
    ON methods.owner_user_id=sessions.user_id AND methods.method='google'
  WHERE flows.flow_hash=presented_flow_hash
    AND flows.kind='reauthenticate-google'
    AND flows.web_session_hash=presented_session_hash
    AND flows.started_at IS NOT NULL
    AND flows.consumed_at IS NULL
    AND flows.expires_at>operation_time
    AND flows.provider_state_ciphertext IS NOT NULL
    AND sessions.revoked_at IS NULL
    AND sessions.expires_at>operation_time
    AND sessions.access_scope='full'
    AND profiles.status='active'
  FOR UPDATE OF flows, sessions, profiles;
  IF account_user_id IS NULL THEN RETURN; END IF;
  IF account_user_id<>provider_user_id THEN
    UPDATE public.auth_flows SET consumed_at=operation_time
    WHERE flow_hash=presented_flow_hash;
    RETURN;
  END IF;
  INSERT INTO public.web_sessions (
    id,user_id,owner_user_id,session_hash,csrf_hash,refresh_ciphertext,
    access_scope,reauthenticated_at,reauthenticated_method,expires_at
  ) VALUES (
    new_session_id,account_user_id,account_user_id,new_session_hash,new_csrf_hash,
    new_refresh_ciphertext,'full',operation_time,'google',session_expires_at
  );
  UPDATE public.web_sessions SET revoked_at=operation_time
  WHERE session_hash=presented_session_hash AND revoked_at IS NULL;
  UPDATE public.auth_flows SET consumed_at=operation_time WHERE flow_hash=presented_flow_hash;
  RETURN QUERY SELECT new_session_id,'full'::text;
END;
$$;

CREATE FUNCTION create_google_link(
  new_flow_hash text,
  presented_session_hash text,
  presented_csrf_hash text,
  flow_expires_at timestamptz
) RETURNS TABLE(user_id uuid,status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog
AS $$
DECLARE account_user_id uuid;
BEGIN
  SELECT sessions.user_id INTO account_user_id
  FROM public.web_sessions AS sessions
  JOIN public.user_profiles AS profiles ON profiles.user_id=sessions.user_id
  WHERE sessions.session_hash=presented_session_hash
    AND sessions.csrf_hash=presented_csrf_hash
    AND sessions.revoked_at IS NULL
    AND sessions.expires_at>now()
    AND sessions.access_scope='full'
    AND profiles.status='active'
    AND flow_expires_at>now()
  FOR UPDATE OF sessions, profiles;
  IF account_user_id IS NULL THEN RETURN; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.account_sign_in_methods
    WHERE owner_user_id=account_user_id AND method='password'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.web_sessions
    WHERE session_hash=presented_session_hash
      AND reauthenticated_method='password'
      AND reauthenticated_at BETWEEN now()-interval '15 minutes' AND now()
  ) THEN RETURN; END IF;
  IF EXISTS (
    SELECT 1 FROM public.account_sign_in_methods
    WHERE owner_user_id=account_user_id AND method='google'
  ) THEN
    RETURN QUERY SELECT account_user_id,'already-linked'::text;
    RETURN;
  END IF;
  UPDATE public.auth_flows SET consumed_at=now(),link_stage='completed'
  WHERE kind='link-google' AND web_session_hash=presented_session_hash
    AND consumed_at IS NULL AND expires_at<=now();
  IF EXISTS (
    SELECT 1 FROM public.auth_flows
    WHERE kind='link-google' AND web_session_hash=presented_session_hash
      AND consumed_at IS NULL
  ) THEN RETURN; END IF;
  INSERT INTO public.auth_flows(
    flow_hash,kind,owner_user_id,web_session_hash,expires_at,link_stage
  ) VALUES (
    new_flow_hash,'link-google',account_user_id,presented_session_hash,
    flow_expires_at,'claimed'
  ) ON CONFLICT(flow_hash) DO NOTHING;
  IF NOT FOUND THEN RETURN; END IF;
  RETURN QUERY SELECT account_user_id,'created'::text;
END;
$$;

CREATE FUNCTION claim_google_link_continuation(
  presented_flow_hash text,
  presented_session_hash text,
  new_lease_hash text,
  lease_expires_at timestamptz
) RETURNS TABLE(
  user_id uuid,
  stage text,
  refresh_ciphertext text,
  provider_state_ciphertext text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog
AS $$
DECLARE operation_time timestamptz := now();
BEGIN
  RETURN QUERY
  UPDATE public.auth_flows AS flows
  SET link_lease_hash=new_lease_hash,link_lease_expires_at=lease_expires_at
  FROM public.web_sessions AS sessions,public.user_profiles AS profiles
  WHERE flows.flow_hash=presented_flow_hash
    AND flows.kind='link-google'
    AND flows.web_session_hash=presented_session_hash
    AND flows.owner_user_id=sessions.user_id
    AND sessions.session_hash=presented_session_hash
    AND profiles.user_id=sessions.user_id
    AND flows.link_stage IN ('claimed','refreshed')
    AND flows.consumed_at IS NULL
    AND flows.expires_at>operation_time
    AND (flows.link_lease_expires_at IS NULL OR flows.link_lease_expires_at<=operation_time)
    AND lease_expires_at>operation_time
    AND sessions.revoked_at IS NULL
    AND sessions.expires_at>operation_time
    AND sessions.access_scope='full'
    AND sessions.reauthenticated_method='password'
    AND sessions.reauthenticated_at BETWEEN operation_time-interval '15 minutes' AND operation_time
    AND profiles.status='active'
  RETURNING flows.owner_user_id,flows.link_stage,
    CASE WHEN flows.link_stage='claimed' THEN sessions.refresh_ciphertext END,
    CASE WHEN flows.link_stage='refreshed' THEN flows.provider_state_ciphertext END;
END;
$$;

CREATE FUNCTION save_google_link_refresh(
  presented_flow_hash text,
  presented_session_hash text,
  presented_lease_hash text,
  provider_user_id uuid,
  new_refresh_ciphertext text,
  protected_provider_state text
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog
AS $$
DECLARE account_user_id uuid;
BEGIN
  SELECT flows.owner_user_id INTO account_user_id
  FROM public.auth_flows AS flows
  JOIN public.web_sessions AS sessions
    ON sessions.session_hash=flows.web_session_hash AND sessions.user_id=flows.owner_user_id
  WHERE flows.flow_hash=presented_flow_hash
    AND flows.kind='link-google'
    AND flows.web_session_hash=presented_session_hash
    AND flows.link_stage='claimed'
    AND flows.link_lease_hash=presented_lease_hash
    AND flows.link_lease_expires_at>now()
    AND flows.consumed_at IS NULL
    AND flows.expires_at>now()
    AND sessions.revoked_at IS NULL
    AND sessions.expires_at>now()
  FOR UPDATE OF flows, sessions;
  IF account_user_id IS NULL OR account_user_id<>provider_user_id THEN RETURN NULL; END IF;
  UPDATE public.web_sessions SET refresh_ciphertext=new_refresh_ciphertext
  WHERE session_hash=presented_session_hash AND user_id=account_user_id;
  UPDATE public.auth_flows
  SET link_stage='refreshed',provider_state_ciphertext=protected_provider_state
  WHERE flow_hash=presented_flow_hash;
  RETURN true;
END;
$$;

CREATE FUNCTION save_google_link_provider_started(
  presented_flow_hash text,
  presented_session_hash text,
  presented_lease_hash text,
  protected_provider_state text
) RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path=pg_catalog
AS $$
  UPDATE public.auth_flows
  SET link_stage='provider-started',provider_state_ciphertext=protected_provider_state,
    started_at=now(),link_lease_hash=NULL,link_lease_expires_at=NULL
  WHERE flow_hash=presented_flow_hash
    AND kind='link-google'
    AND web_session_hash=presented_session_hash
    AND link_stage='refreshed'
    AND link_lease_hash=presented_lease_hash
    AND link_lease_expires_at>now()
    AND consumed_at IS NULL
    AND expires_at>now()
  RETURNING true;
$$;

CREATE FUNCTION read_google_link_state(
  presented_flow_hash text,
  presented_session_hash text
) RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path=pg_catalog
AS $$
  SELECT flows.provider_state_ciphertext
  FROM public.auth_flows AS flows
  JOIN public.web_sessions AS sessions
    ON sessions.session_hash=flows.web_session_hash AND sessions.user_id=flows.owner_user_id
  JOIN public.user_profiles AS profiles ON profiles.user_id=sessions.user_id
  WHERE flows.flow_hash=presented_flow_hash
    AND flows.kind='link-google'
    AND flows.web_session_hash=presented_session_hash
    AND flows.link_stage='provider-started'
    AND flows.consumed_at IS NULL
    AND flows.expires_at>now()
    AND flows.provider_state_ciphertext IS NOT NULL
    AND sessions.revoked_at IS NULL
    AND sessions.expires_at>now()
    AND sessions.access_scope='full'
    AND sessions.reauthenticated_method='password'
    AND sessions.reauthenticated_at BETWEEN now()-interval '15 minutes' AND now()
    AND profiles.status='active';
$$;

CREATE FUNCTION complete_google_link(
  presented_flow_hash text,
  presented_session_hash text,
  provider_user_id uuid,
  new_session_id uuid,
  new_session_hash text,
  new_csrf_hash text,
  new_refresh_ciphertext text,
  session_expires_at timestamptz
) RETURNS TABLE(id uuid, access_scope text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog
AS $$
DECLARE
  account_user_id uuid;
  prior_reauthenticated_at timestamptz;
  prior_reauthenticated_method text;
  operation_time timestamptz := now();
BEGIN
  SELECT flows.owner_user_id,sessions.reauthenticated_at,sessions.reauthenticated_method
  INTO account_user_id,prior_reauthenticated_at,prior_reauthenticated_method
  FROM public.auth_flows AS flows
  JOIN public.web_sessions AS sessions
    ON sessions.session_hash=flows.web_session_hash AND sessions.user_id=flows.owner_user_id
  JOIN public.user_profiles AS profiles ON profiles.user_id=sessions.user_id
  WHERE flows.flow_hash=presented_flow_hash
    AND flows.kind='link-google'
    AND flows.web_session_hash=presented_session_hash
    AND flows.link_stage='provider-started'
    AND flows.consumed_at IS NULL
    AND flows.expires_at>operation_time
    AND flows.provider_state_ciphertext IS NOT NULL
    AND sessions.revoked_at IS NULL
    AND sessions.expires_at>operation_time
    AND sessions.access_scope='full'
    AND sessions.reauthenticated_method='password'
    AND sessions.reauthenticated_at BETWEEN operation_time-interval '15 minutes' AND operation_time
    AND profiles.status='active'
    AND NOT EXISTS (
      SELECT 1 FROM public.account_sign_in_methods AS methods
      WHERE methods.owner_user_id=sessions.user_id AND methods.method='google'
    )
  FOR UPDATE OF flows, sessions, profiles;
  IF account_user_id IS NULL THEN RETURN; END IF;
  IF account_user_id<>provider_user_id THEN
    UPDATE public.auth_flows SET consumed_at=operation_time,link_stage='completed'
    WHERE flow_hash=presented_flow_hash;
    RETURN;
  END IF;
  INSERT INTO public.account_sign_in_methods(owner_user_id,method,linked_at)
  VALUES(account_user_id,'google',operation_time);
  UPDATE public.web_sessions SET revoked_at=operation_time
  WHERE user_id=account_user_id AND revoked_at IS NULL;
  UPDATE public.extension_sessions SET revoked_at=operation_time
  WHERE user_id=account_user_id AND revoked_at IS NULL;
  INSERT INTO public.web_sessions(
    id,user_id,owner_user_id,session_hash,csrf_hash,refresh_ciphertext,
    access_scope,reauthenticated_at,reauthenticated_method,expires_at
  ) VALUES (
    new_session_id,account_user_id,account_user_id,new_session_hash,new_csrf_hash,
    new_refresh_ciphertext,'full',prior_reauthenticated_at,prior_reauthenticated_method,
    session_expires_at
  );
  UPDATE public.auth_flows SET consumed_at=operation_time,link_stage='completed'
  WHERE flow_hash=presented_flow_hash;
  RETURN QUERY SELECT new_session_id,'full'::text;
END;
$$;

CREATE FUNCTION claim_password_link(
  presented_session_hash text,
  presented_csrf_hash text,
  new_flow_hash text,
  new_lease_hash text,
  lease_expires_at timestamptz,
  flow_expires_at timestamptz
) RETURNS TABLE(
  flow_hash text,
  user_id uuid,
  stage text,
  refresh_ciphertext text,
  provider_state_ciphertext text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog
AS $$
DECLARE
  account_user_id uuid;
  current_flow public.auth_flows%ROWTYPE;
  operation_time timestamptz := now();
BEGIN
  SELECT sessions.user_id INTO account_user_id
  FROM public.web_sessions AS sessions
  JOIN public.user_profiles AS profiles ON profiles.user_id=sessions.user_id
  WHERE sessions.session_hash=presented_session_hash
    AND sessions.csrf_hash=presented_csrf_hash
    AND sessions.revoked_at IS NULL
    AND sessions.expires_at>operation_time
    AND sessions.access_scope='full'
    AND profiles.status='active'
    AND flow_expires_at>operation_time
  FOR UPDATE OF sessions,profiles;
  IF account_user_id IS NULL THEN RETURN; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.account_sign_in_methods
    WHERE owner_user_id=account_user_id AND method='google'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.web_sessions
    WHERE session_hash=presented_session_hash
      AND reauthenticated_method='google'
      AND reauthenticated_at BETWEEN operation_time-interval '15 minutes' AND operation_time
  ) THEN RETURN; END IF;
  IF EXISTS (
    SELECT 1 FROM public.account_sign_in_methods
    WHERE owner_user_id=account_user_id AND method='password'
  ) THEN
    RETURN QUERY SELECT NULL::text,account_user_id,'already-linked'::text,NULL::text,NULL::text;
    RETURN;
  END IF;
  SELECT * INTO current_flow FROM public.auth_flows AS flows
  WHERE flows.kind='link-password'
    AND flows.web_session_hash=presented_session_hash
    AND flows.consumed_at IS NULL
  FOR UPDATE;
  IF current_flow.flow_hash IS NOT NULL AND current_flow.expires_at<=operation_time THEN
    UPDATE public.auth_flows SET consumed_at=operation_time,link_stage='completed'
    WHERE auth_flows.flow_hash=current_flow.flow_hash;
    current_flow := NULL;
  END IF;
  IF current_flow.flow_hash IS NULL THEN
    INSERT INTO public.auth_flows(
      flow_hash,kind,owner_user_id,web_session_hash,expires_at,link_stage
    ) VALUES (
      new_flow_hash,'link-password',account_user_id,presented_session_hash,
      flow_expires_at,'claimed'
    ) RETURNING * INTO current_flow;
  END IF;
  IF current_flow.owner_user_id<>account_user_id
    OR current_flow.link_stage NOT IN ('claimed','refreshed','provider-updated')
    OR (current_flow.link_lease_expires_at IS NOT NULL
      AND current_flow.link_lease_expires_at>operation_time)
    OR lease_expires_at<=operation_time THEN RETURN; END IF;
  UPDATE public.auth_flows
  SET link_lease_hash=new_lease_hash,link_lease_expires_at=lease_expires_at
  WHERE auth_flows.flow_hash=current_flow.flow_hash;
  RETURN QUERY
  SELECT current_flow.flow_hash,account_user_id,current_flow.link_stage,
    CASE WHEN current_flow.link_stage='claimed' THEN sessions.refresh_ciphertext END,
    CASE WHEN current_flow.link_stage='refreshed'
      THEN current_flow.provider_state_ciphertext END
  FROM public.web_sessions AS sessions
  WHERE sessions.session_hash=presented_session_hash;
END;
$$;

CREATE FUNCTION save_password_link_refresh(
  presented_flow_hash text,
  presented_session_hash text,
  presented_lease_hash text,
  provider_user_id uuid,
  new_refresh_ciphertext text,
  protected_provider_state text
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog
AS $$
DECLARE account_user_id uuid;
BEGIN
  SELECT flows.owner_user_id INTO account_user_id
  FROM public.auth_flows AS flows
  JOIN public.web_sessions AS sessions
    ON sessions.session_hash=flows.web_session_hash AND sessions.user_id=flows.owner_user_id
  WHERE flows.flow_hash=presented_flow_hash
    AND flows.kind='link-password'
    AND flows.web_session_hash=presented_session_hash
    AND flows.link_stage='claimed'
    AND flows.link_lease_hash=presented_lease_hash
    AND flows.link_lease_expires_at>now()
    AND flows.consumed_at IS NULL
    AND flows.expires_at>now()
    AND sessions.revoked_at IS NULL
    AND sessions.expires_at>now()
  FOR UPDATE OF flows,sessions;
  IF account_user_id IS NULL OR account_user_id<>provider_user_id THEN RETURN NULL; END IF;
  UPDATE public.web_sessions SET refresh_ciphertext=new_refresh_ciphertext
  WHERE session_hash=presented_session_hash AND user_id=account_user_id;
  UPDATE public.auth_flows
  SET link_stage='refreshed',provider_state_ciphertext=protected_provider_state
  WHERE flow_hash=presented_flow_hash;
  RETURN true;
END;
$$;

CREATE FUNCTION save_password_link_provider_updated(
  presented_flow_hash text,
  presented_session_hash text,
  presented_lease_hash text,
  provider_user_id uuid
) RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path=pg_catalog
AS $$
  UPDATE public.auth_flows
  SET link_stage='provider-updated'
  WHERE flow_hash=presented_flow_hash
    AND kind='link-password'
    AND web_session_hash=presented_session_hash
    AND owner_user_id=provider_user_id
    AND link_stage='refreshed'
    AND link_lease_hash=presented_lease_hash
    AND link_lease_expires_at>now()
    AND consumed_at IS NULL
    AND expires_at>now()
  RETURNING true;
$$;

CREATE FUNCTION complete_password_link(
  presented_flow_hash text,
  presented_session_hash text,
  presented_lease_hash text,
  new_session_id uuid,
  new_session_hash text,
  new_csrf_hash text,
  session_expires_at timestamptz
) RETURNS TABLE(id uuid, access_scope text, methods jsonb)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog
AS $$
DECLARE
  account_user_id uuid;
  current_refresh_ciphertext text;
  prior_reauthenticated_at timestamptz;
  prior_reauthenticated_method text;
  operation_time timestamptz := now();
BEGIN
  SELECT flows.owner_user_id,sessions.refresh_ciphertext,
    sessions.reauthenticated_at,sessions.reauthenticated_method
  INTO account_user_id,current_refresh_ciphertext,
    prior_reauthenticated_at,prior_reauthenticated_method
  FROM public.auth_flows AS flows
  JOIN public.web_sessions AS sessions
    ON sessions.session_hash=flows.web_session_hash AND sessions.user_id=flows.owner_user_id
  JOIN public.user_profiles AS profiles ON profiles.user_id=sessions.user_id
  WHERE flows.flow_hash=presented_flow_hash
    AND flows.kind='link-password'
    AND flows.web_session_hash=presented_session_hash
    AND flows.link_stage='provider-updated'
    AND flows.link_lease_hash=presented_lease_hash
    AND flows.link_lease_expires_at>operation_time
    AND flows.consumed_at IS NULL
    AND flows.expires_at>operation_time
    AND flows.provider_state_ciphertext IS NOT NULL
    AND sessions.revoked_at IS NULL
    AND sessions.expires_at>operation_time
    AND sessions.access_scope='full'
    AND sessions.reauthenticated_method='google'
    AND sessions.reauthenticated_at BETWEEN operation_time-interval '15 minutes' AND operation_time
    AND profiles.status='active'
    AND NOT EXISTS (
      SELECT 1 FROM public.account_sign_in_methods AS password_method
      WHERE password_method.owner_user_id=sessions.user_id AND password_method.method='password'
    )
  FOR UPDATE OF flows,sessions,profiles;
  IF account_user_id IS NULL THEN RETURN; END IF;
  INSERT INTO public.account_sign_in_methods(owner_user_id,method,linked_at)
  VALUES(account_user_id,'password',operation_time);
  UPDATE public.web_sessions SET revoked_at=operation_time
  WHERE user_id=account_user_id AND revoked_at IS NULL;
  UPDATE public.extension_sessions SET revoked_at=operation_time
  WHERE user_id=account_user_id AND revoked_at IS NULL;
  INSERT INTO public.web_sessions(
    id,user_id,owner_user_id,session_hash,csrf_hash,refresh_ciphertext,
    access_scope,reauthenticated_at,reauthenticated_method,expires_at
  ) VALUES (
    new_session_id,account_user_id,account_user_id,new_session_hash,new_csrf_hash,
    current_refresh_ciphertext,'full',prior_reauthenticated_at,prior_reauthenticated_method,
    session_expires_at
  );
  UPDATE public.auth_flows SET consumed_at=operation_time,link_stage='completed',
    link_lease_hash=NULL,link_lease_expires_at=NULL
  WHERE flow_hash=presented_flow_hash;
  RETURN QUERY
  SELECT new_session_id,'full'::text,jsonb_agg(
    jsonb_build_object('method',sign_in.method,'linkedAt',sign_in.linked_at)
    ORDER BY CASE sign_in.method WHEN 'password' THEN 0 ELSE 1 END
  )
  FROM public.account_sign_in_methods AS sign_in
  WHERE sign_in.owner_user_id=account_user_id;
END;
$$;

CREATE FUNCTION bind_auth_identity(presented_ticket_hash text, account_user_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE bound_user uuid;
BEGIN
  PERFORM 1
  FROM public.invitation_claims AS claims
  JOIN public.invitations AS invitations ON invitations.id = claims.invitation_id
  WHERE claims.ticket_hash = presented_ticket_hash
    AND claims.expires_at > now()
    AND claims.finalized_user_id IS NULL
    AND invitations.expires_at > now()
    AND invitations.revoked_at IS NULL
    AND invitations.consumed_at IS NULL
  FOR UPDATE OF claims, invitations;
  IF NOT FOUND THEN RETURN NULL; END IF;
  UPDATE public.invitation_claims AS claims
  SET bound_user_id = account_user_id
  WHERE claims.ticket_hash = presented_ticket_hash
    AND (claims.bound_user_id IS NULL OR claims.bound_user_id = account_user_id)
  RETURNING claims.bound_user_id INTO bound_user;
  RETURN bound_user;
END;
$$;

CREATE FUNCTION complete_auth_flow(
  presented_flow_hash text,
  account_user_id uuid,
  account_email text,
  account_timezone text,
  account_daily_goal integer
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  flow public.auth_flows%ROWTYPE;
  claimed public.invitation_claims%ROWTYPE;
  invitation public.invitations%ROWTYPE;
BEGIN
  SELECT * INTO flow FROM public.auth_flows
  WHERE flow_hash = presented_flow_hash
    AND consumed_at IS NULL
    AND expires_at > now()
  FOR UPDATE;
  IF flow.flow_hash IS NULL THEN RETURN NULL; END IF;
  IF flow.kind='login' THEN
    PERFORM 1 FROM public.user_profiles AS profiles
    JOIN public.account_sign_in_methods AS methods
      ON methods.owner_user_id=profiles.user_id AND methods.method='google'
    WHERE profiles.user_id=account_user_id AND profiles.status IN ('active','disabled')
    FOR UPDATE OF profiles;
    IF NOT FOUND THEN RETURN NULL; END IF;
    UPDATE public.user_profiles SET email=account_email,updated_at=now()
    WHERE user_id=account_user_id;
    UPDATE public.auth_flows SET consumed_at=now() WHERE flow_hash=presented_flow_hash;
    RETURN account_user_id;
  END IF;
  SELECT * INTO claimed FROM public.invitation_claims
  WHERE ticket_hash = flow.ticket_hash FOR UPDATE;
  SELECT * INTO invitation FROM public.invitations
  WHERE id = claimed.invitation_id FOR UPDATE;
  IF claimed.ticket_hash IS NULL OR claimed.expires_at <= now()
    OR invitation.id IS NULL OR invitation.expires_at <= now()
    OR invitation.revoked_at IS NOT NULL
    OR (invitation.consumed_at IS NOT NULL AND claimed.finalized_user_id IS NULL)
    OR (claimed.bound_user_id IS NOT NULL AND claimed.bound_user_id <> account_user_id)
    OR (claimed.finalized_user_id IS NOT NULL AND claimed.finalized_user_id <> account_user_id)
  THEN RETURN NULL; END IF;
  PERFORM 1 FROM public.user_profiles WHERE user_id=account_user_id FOR UPDATE;
  IF FOUND THEN RETURN NULL; END IF;
  INSERT INTO public.user_profiles (
    user_id, owner_user_id, email, status, timezone, daily_goal
  ) VALUES (
    account_user_id, account_user_id, account_email, 'active', account_timezone, account_daily_goal
  );
  INSERT INTO public.account_sign_in_methods (owner_user_id, method)
  VALUES (account_user_id, 'google');
  UPDATE public.auth_flows SET consumed_at = now()
  WHERE flow_hash = presented_flow_hash;
  UPDATE public.invitation_claims
  SET bound_user_id = account_user_id, finalized_user_id = account_user_id
  WHERE ticket_hash = flow.ticket_hash;
  UPDATE public.invitations
  SET consumed_at = now()
  WHERE id = claimed.invitation_id AND consumed_at IS NULL;
  RETURN account_user_id;
END;
$$;

CREATE FUNCTION finalize_invitation(
  presented_ticket_hash text,
  account_user_id uuid,
  account_email text,
  account_timezone text,
  account_daily_goal integer,
  sign_in_method text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  claimed public.invitation_claims%ROWTYPE;
  invitation public.invitations%ROWTYPE;
BEGIN
  SELECT * INTO claimed
  FROM public.invitation_claims
  WHERE ticket_hash = presented_ticket_hash
  FOR UPDATE;
  SELECT * INTO invitation FROM public.invitations
  WHERE id = claimed.invitation_id FOR UPDATE;
  IF claimed.ticket_hash IS NULL OR claimed.expires_at <= now()
    OR invitation.id IS NULL OR invitation.expires_at <= now()
    OR invitation.revoked_at IS NOT NULL
    OR (invitation.consumed_at IS NOT NULL AND claimed.finalized_user_id IS NULL)
    OR claimed.bound_user_id IS DISTINCT FROM account_user_id THEN RETURN NULL; END IF;
  IF claimed.finalized_user_id IS NOT NULL THEN
    IF claimed.finalized_user_id = account_user_id AND EXISTS (
      SELECT 1 FROM public.account_sign_in_methods
      WHERE owner_user_id=account_user_id AND method=sign_in_method
    ) THEN RETURN account_user_id; END IF;
    RETURN NULL;
  END IF;
  IF sign_in_method NOT IN ('password','google') THEN RETURN NULL; END IF;
  PERFORM 1 FROM public.user_profiles WHERE user_id=account_user_id FOR UPDATE;
  IF FOUND THEN RETURN NULL; END IF;
  INSERT INTO public.user_profiles (
    user_id, owner_user_id, email, status, timezone, daily_goal
  ) VALUES (
    account_user_id, account_user_id, account_email, 'active', account_timezone, account_daily_goal
  );
  INSERT INTO public.account_sign_in_methods (owner_user_id, method)
  VALUES (account_user_id, sign_in_method);
  UPDATE public.invitation_claims
  SET finalized_user_id = account_user_id
  WHERE ticket_hash = presented_ticket_hash;
  UPDATE public.invitations
  SET consumed_at = now()
  WHERE id = claimed.invitation_id AND consumed_at IS NULL;
  RETURN account_user_id;
END;
$$;

CREATE FUNCTION authorize_sign_in_method(account_user_id uuid, sign_in_method text)
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT profiles.user_id
  FROM public.user_profiles AS profiles
  JOIN public.account_sign_in_methods AS methods
    ON methods.owner_user_id=profiles.user_id
  WHERE profiles.user_id=account_user_id
    AND profiles.status IN ('active','disabled')
    AND methods.method=sign_in_method
    AND sign_in_method IN ('password','google');
$$;

CREATE FUNCTION create_web_session(
  new_session_id uuid,
  account_user_id uuid,
  new_session_hash text,
  new_csrf_hash text,
  new_refresh_ciphertext text,
  session_expires_at timestamptz
) RETURNS TABLE(id uuid, access_scope text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  INSERT INTO public.web_sessions (
    id, user_id, owner_user_id, session_hash, csrf_hash, refresh_ciphertext, access_scope, expires_at
  )
  SELECT new_session_id, account_user_id, account_user_id, new_session_hash, new_csrf_hash,
    new_refresh_ciphertext,
    CASE WHEN status='active' THEN 'full' ELSE 'data-rights' END,
    session_expires_at
  FROM public.user_profiles
  WHERE user_id = account_user_id AND status IN ('active','disabled')
  RETURNING web_sessions.id, web_sessions.access_scope;
$$;

CREATE FUNCTION authenticate_web_session(presented_session_hash text)
RETURNS TABLE(user_id uuid, csrf_hash text, reauthenticated_at timestamptz)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT sessions.user_id, sessions.csrf_hash, sessions.reauthenticated_at
  FROM public.web_sessions AS sessions
  JOIN public.user_profiles AS profiles ON profiles.user_id = sessions.user_id
  WHERE sessions.session_hash = presented_session_hash
    AND sessions.revoked_at IS NULL
    AND sessions.expires_at > now()
    AND profiles.status = 'active'
    AND sessions.access_scope = 'full';
$$;

CREATE FUNCTION prepare_password_reauthentication(presented_session_hash text)
RETURNS TABLE(user_id uuid, email text, csrf_hash text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT sessions.user_id, profiles.email, sessions.csrf_hash
  FROM public.web_sessions AS sessions
  JOIN public.user_profiles AS profiles ON profiles.user_id=sessions.user_id
  JOIN public.account_sign_in_methods AS methods
    ON methods.owner_user_id=sessions.user_id AND methods.method='password'
  WHERE sessions.session_hash=presented_session_hash
    AND sessions.revoked_at IS NULL
    AND sessions.expires_at>now()
    AND profiles.status='active'
    AND sessions.access_scope='full';
$$;

CREATE FUNCTION require_recent_authentication(
  presented_session_hash text,
  required_method text
) RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path=pg_catalog
AS $$
  SELECT sessions.user_id
  FROM public.web_sessions AS sessions
  JOIN public.user_profiles AS profiles ON profiles.user_id=sessions.user_id
  WHERE sessions.session_hash=presented_session_hash
    AND sessions.revoked_at IS NULL
    AND sessions.expires_at>now()
    AND sessions.access_scope='full'
    AND profiles.status='active'
    AND required_method IN ('password','google')
    AND sessions.reauthenticated_method=required_method
    AND sessions.reauthenticated_at BETWEEN now()-interval '15 minutes' AND now();
$$;

CREATE FUNCTION rotate_password_reauthenticated_session(
  presented_session_hash text,
  expected_user_id uuid,
  new_session_id uuid,
  new_session_hash text,
  new_csrf_hash text,
  new_refresh_ciphertext text,
  session_expires_at timestamptz
) RETURNS TABLE(id uuid, access_scope text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  matched_user_id uuid;
  operation_time timestamptz := now();
BEGIN
  SELECT sessions.user_id INTO matched_user_id
  FROM public.web_sessions AS sessions
  JOIN public.user_profiles AS profiles ON profiles.user_id=sessions.user_id
  JOIN public.account_sign_in_methods AS methods
    ON methods.owner_user_id=sessions.user_id AND methods.method='password'
  WHERE sessions.session_hash=presented_session_hash
    AND sessions.revoked_at IS NULL
    AND sessions.expires_at>operation_time
    AND sessions.access_scope='full'
    AND profiles.status='active'
  FOR UPDATE OF sessions, profiles;
  IF matched_user_id IS NULL OR matched_user_id<>expected_user_id THEN
    RETURN;
  END IF;
  INSERT INTO public.web_sessions (
    id,user_id,owner_user_id,session_hash,csrf_hash,refresh_ciphertext,
    access_scope,reauthenticated_at,reauthenticated_method,expires_at
  ) VALUES (
    new_session_id,matched_user_id,matched_user_id,new_session_hash,new_csrf_hash,
    new_refresh_ciphertext,'full',operation_time,'password',session_expires_at
  );
  UPDATE public.web_sessions SET revoked_at=operation_time
  WHERE session_hash=presented_session_hash AND revoked_at IS NULL;
  RETURN QUERY SELECT new_session_id,'full'::text;
END;
$$;

CREATE FUNCTION authenticate_data_rights_session(presented_session_hash text)
RETURNS TABLE(
  user_id uuid, csrf_hash text, reauthenticated_at timestamptz, access_scope text
)
LANGUAGE sql SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT sessions.user_id,sessions.csrf_hash,sessions.reauthenticated_at,sessions.access_scope
  FROM public.web_sessions AS sessions
  JOIN public.user_profiles AS profiles ON profiles.user_id=sessions.user_id
  WHERE sessions.session_hash=presented_session_hash
    AND sessions.revoked_at IS NULL AND sessions.expires_at>now()
    AND ((profiles.status='active' AND sessions.access_scope='full')
      OR (profiles.status='disabled' AND sessions.access_scope='data-rights'));
$$;

CREATE FUNCTION revoke_web_session(presented_session_hash text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  UPDATE public.web_sessions SET revoked_at = now()
  WHERE session_hash = presented_session_hash AND revoked_at IS NULL
  RETURNING true;
$$;

CREATE FUNCTION rotate_web_csrf(presented_session_hash text, new_csrf_hash text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  UPDATE public.web_sessions AS sessions
  SET csrf_hash = new_csrf_hash
  FROM public.user_profiles AS profiles
  WHERE sessions.session_hash = presented_session_hash
    AND sessions.user_id = profiles.user_id
    AND sessions.revoked_at IS NULL
    AND sessions.expires_at > now()
    AND ((profiles.status='active' AND sessions.access_scope='full')
      OR (profiles.status='disabled' AND sessions.access_scope='data-rights'))
  RETURNING true;
$$;

CREATE FUNCTION create_extension_pairing(
  pairing_id uuid,
  pairing_state_hash text,
  pairing_pkce_challenge text,
  pairing_install_id_hash text,
  pairing_expires_at timestamptz
) RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  INSERT INTO public.extension_pairings (
    id, state_hash, pkce_challenge, install_id_hash, status, expires_at
  ) VALUES (
    pairing_id, pairing_state_hash, pairing_pkce_challenge, pairing_install_id_hash,
    'pending', pairing_expires_at
  ) RETURNING id;
$$;

CREATE FUNCTION approve_extension_pairing(
  pairing_id uuid,
  account_user_id uuid,
  pairing_device_label text,
  expected_preferences_revision integer,
  new_query_model_mode text,
  new_study_capture_mode text,
  new_cloud_word_copy_mode text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE approved_id uuid;
BEGIN
  PERFORM 1 FROM public.extension_pairings
  WHERE id=pairing_id AND status='pending' AND expires_at>now() FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  UPDATE public.user_profiles SET
    extension_query_model_mode=new_query_model_mode,
    study_capture_mode=new_study_capture_mode,
    cloud_word_copy_mode=new_cloud_word_copy_mode,
    preferences_revision=preferences_revision+CASE WHEN
      extension_query_model_mode IS DISTINCT FROM new_query_model_mode OR
      study_capture_mode IS DISTINCT FROM new_study_capture_mode OR
      cloud_word_copy_mode IS DISTINCT FROM new_cloud_word_copy_mode THEN 1 ELSE 0 END,
    updated_at=CASE WHEN
      extension_query_model_mode IS DISTINCT FROM new_query_model_mode OR
      study_capture_mode IS DISTINCT FROM new_study_capture_mode OR
      cloud_word_copy_mode IS DISTINCT FROM new_cloud_word_copy_mode THEN now() ELSE updated_at END
  WHERE user_id=account_user_id AND status='active'
    AND preferences_revision=expected_preferences_revision;
  IF NOT FOUND THEN RAISE EXCEPTION 'revision conflict'; END IF;
  UPDATE public.extension_pairings
  SET user_id = account_user_id,
      owner_user_id = account_user_id,
      device_label = pairing_device_label,
      status = 'approved'
  WHERE id = pairing_id AND status = 'pending' AND expires_at > now()
  RETURNING id INTO approved_id;
  RETURN approved_id;
END;
$$;

CREATE FUNCTION get_extension_pairing(pairing_id uuid)
RETURNS TABLE(id uuid, status text, expires_at timestamptz)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT pairings.id,
    CASE
      WHEN pairings.expires_at <= now() AND pairings.status <> 'consumed' THEN 'expired'
      ELSE pairings.status
    END,
    pairings.expires_at
  FROM public.extension_pairings AS pairings
  WHERE pairings.id = pairing_id;
$$;

CREATE FUNCTION exchange_extension_pairing(
  pairing_id uuid,
  presented_state_hash text,
  presented_pkce_challenge text,
  new_session_id uuid,
  new_token_hash text,
  session_expires_at timestamptz
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE approved public.extension_pairings%ROWTYPE;
BEGIN
  UPDATE public.extension_pairings
  SET status = 'consumed'
  WHERE id = pairing_id
    AND status = 'approved'
    AND expires_at > now()
    AND state_hash = presented_state_hash
    AND pkce_challenge = presented_pkce_challenge
  RETURNING * INTO approved;
  IF approved.id IS NULL THEN RETURN NULL; END IF;
  INSERT INTO public.extension_sessions (
    id, user_id, owner_user_id, install_id_hash, token_hash, device_label, expires_at
  ) VALUES (
    new_session_id, approved.user_id, approved.owner_user_id, approved.install_id_hash,
    new_token_hash, approved.device_label, session_expires_at
  );
  RETURN new_session_id;
END;
$$;

CREATE FUNCTION list_extension_sessions(account_user_id uuid)
RETURNS TABLE(
  id uuid,
  device_label text,
  created_at timestamptz,
  last_used_at timestamptz,
  expires_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  SELECT sessions.id, sessions.device_label, sessions.created_at,
    sessions.last_used_at, sessions.expires_at
  FROM public.extension_sessions AS sessions
  JOIN public.user_profiles AS profiles ON profiles.user_id = sessions.user_id
  WHERE sessions.user_id = account_user_id
    AND sessions.revoked_at IS NULL
    AND sessions.expires_at > now()
    AND profiles.status = 'active'
  ORDER BY sessions.created_at, sessions.id;
$$;

CREATE FUNCTION authenticate_extension_session(presented_token_hash text)
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  UPDATE public.extension_sessions AS sessions
  SET last_used_at = now()
  FROM public.user_profiles AS profiles
  WHERE sessions.token_hash = presented_token_hash
    AND profiles.user_id = sessions.user_id
    AND profiles.status = 'active'
    AND sessions.revoked_at IS NULL
    AND sessions.expires_at > now()
  RETURNING sessions.user_id;
$$;

CREATE FUNCTION revoke_extension_session(account_user_id uuid, session_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  UPDATE public.extension_sessions SET revoked_at = now()
  WHERE id = session_id AND user_id = account_user_id AND revoked_at IS NULL
  RETURNING true;
$$;

CREATE FUNCTION revoke_current_extension_session(presented_token_hash text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  WITH revoked AS (
    UPDATE public.extension_sessions SET revoked_at = now()
    WHERE token_hash = presented_token_hash
      AND revoked_at IS NULL
      AND expires_at > now()
    RETURNING 1
  )
  SELECT EXISTS(SELECT 1 FROM revoked);
$$;

CREATE FUNCTION release_expired_quota_reservations(account_user_id uuid)
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
  WITH released AS (
    UPDATE public.quota_reservations
    SET status = 'released', updated_at = now()
    WHERE user_id = account_user_id AND status = 'active' AND expires_at <= now()
    RETURNING 1
  )
  SELECT count(*)::integer FROM released;
$$;

CREATE FUNCTION reserve_quota(
  reservation_id uuid,
  account_user_id uuid,
  model_request_id uuid,
  amount_micro_usd bigint,
  reservation_expires_at timestamptz
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  existing public.quota_reservations%ROWTYPE;
  current_period timestamptz := date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
  allowance bigint;
  committed bigint;
BEGIN
  IF amount_micro_usd <= 0 THEN RAISE EXCEPTION 'invalid reservation'; END IF;
  IF EXISTS (
    SELECT 1 FROM public.runtime_controls
    WHERE name = 'model_kill_switch' AND enabled
  ) THEN RAISE EXCEPTION 'model unavailable'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(account_user_id::text, 0));
  SELECT * INTO existing FROM public.quota_reservations WHERE request_id = model_request_id;
  IF existing.id IS NOT NULL THEN
    IF existing.user_id = account_user_id
      AND existing.reserved_micro_usd = amount_micro_usd
      AND existing.status = 'active'
      AND existing.expires_at > now()
    THEN
      RETURN existing.id;
    END IF;
    RAISE EXCEPTION 'idempotency conflict';
  END IF;
  PERFORM public.release_expired_quota_reservations(account_user_id);
  SELECT limit_micro_usd INTO allowance FROM public.quota_grants
  WHERE user_id = account_user_id
    AND period_start = current_period
    AND superseded_at IS NULL;
  SELECT
    COALESCE((SELECT sum(cost_micro_usd) FROM public.usage_ledger
      WHERE user_id = account_user_id AND period_start = current_period), 0) +
    COALESCE((SELECT sum(reserved_micro_usd) FROM public.quota_reservations
      WHERE user_id = account_user_id AND period_start = current_period AND status = 'active'), 0)
  INTO committed;
  IF allowance IS NULL OR committed + amount_micro_usd > allowance THEN
    RAISE EXCEPTION 'quota exhausted';
  END IF;
  INSERT INTO public.quota_reservations (
    id, user_id, owner_user_id, request_id, period_start, reserved_micro_usd, status, expires_at
  ) VALUES (
    reservation_id, account_user_id, account_user_id, model_request_id, current_period,
    amount_micro_usd, 'active', reservation_expires_at
  );
  RETURN reservation_id;
END;
$$;

CREATE FUNCTION settle_quota_reservation(
  reservation_id uuid,
  ledger_ids uuid[],
  ledger_feature text,
  ledger_price_version_id uuid,
  ledger_calls jsonb,
  ledger_outcome text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  reserved public.quota_reservations%ROWTYPE;
  ledger_call jsonb;
  call_index integer := 0;
  call_cost bigint;
  call_input integer;
  call_cached_input integer;
  call_output integer;
  total_cost bigint := 0;
BEGIN
  SELECT * INTO reserved FROM public.quota_reservations
  WHERE id = reservation_id FOR UPDATE;
  IF reserved.status <> 'active'
    OR jsonb_typeof(ledger_calls) <> 'array'
    OR jsonb_array_length(ledger_calls) NOT BETWEEN 1 AND 2
    OR cardinality(ledger_ids) <> jsonb_array_length(ledger_calls) THEN
    RAISE EXCEPTION 'invalid settlement';
  END IF;
  FOR ledger_call IN SELECT value FROM jsonb_array_elements(ledger_calls)
  LOOP
    call_cost := (ledger_call->>'costMicroUsd')::bigint;
    call_input := (ledger_call->>'inputTokens')::integer;
    call_cached_input := (ledger_call->>'cachedInputTokens')::integer;
    call_output := (ledger_call->>'outputTokens')::integer;
    IF call_cost < 0 OR call_input < 0 OR call_cached_input < 0 OR call_output < 0
      OR call_cached_input > call_input THEN
      RAISE EXCEPTION 'invalid settlement';
    END IF;
    total_cost := total_cost + call_cost;
    INSERT INTO public.usage_ledger (
      id, user_id, owner_user_id, request_id, call_ordinal, period_start, feature,
      price_version_id, cost_micro_usd, outcome, input_tokens, cached_input_tokens, output_tokens
    ) VALUES (
      ledger_ids[call_index + 1], reserved.user_id, reserved.owner_user_id, reserved.request_id,
      call_index, reserved.period_start, ledger_feature, ledger_price_version_id,
      call_cost, ledger_outcome, call_input, call_cached_input, call_output
    );
    call_index := call_index + 1;
  END LOOP;
  IF total_cost > reserved.reserved_micro_usd THEN RAISE EXCEPTION 'invalid settlement'; END IF;
  UPDATE public.quota_reservations
  SET status = 'settled', updated_at = now()
  WHERE id = reservation_id;
  RETURN reservation_id;
END;
$$;

CREATE FUNCTION begin_duplicate_suggestion_request(
  account_user_id uuid,
  new_request_id uuid,
  new_reservation_id uuid,
  model_price_version_id uuid,
  presented_idempotency_key text,
  presented_request_hash text,
  presented_source_item_id uuid,
  presented_source_revision integer,
  presented_candidate_aliases jsonb,
  amount_micro_usd bigint,
  new_lease_token text,
  operation_time timestamptz,
  new_lease_expires_at timestamptz,
  terminal_expires_at timestamptz,
  recovery_ledger_id uuid,
  model_provider text,
  model_name text,
  model_input_price bigint,
  model_cached_input_price bigint,
  model_output_price bigint
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  existing public.learning_duplicate_suggestion_requests%ROWTYPE;
  reserved public.quota_reservations%ROWTYPE;
  source_type text;
  alias_count integer;
  distinct_alias_count integer;
  candidate_count integer;
  next_generation integer:=1;
BEGIN
  IF huayi_private.current_owner_user_id() IS DISTINCT FROM account_user_id THEN
    RAISE EXCEPTION 'duplicate suggestion owner context required';
  END IF;
  IF new_lease_expires_at <= operation_time
    OR terminal_expires_at <= operation_time
    OR terminal_expires_at > operation_time + interval '24 hours'
  THEN RAISE EXCEPTION 'invalid duplicate suggestion lifetime'; END IF;
  PERFORM pg_advisory_xact_lock(
    hashtextextended(account_user_id::text || ':' || presented_idempotency_key, 0)
  );
  SELECT * INTO existing FROM public.learning_duplicate_suggestion_requests requests
  WHERE requests.owner_user_id=account_user_id
    AND requests.idempotency_key=presented_idempotency_key
  FOR UPDATE;
  IF existing.id IS NOT NULL THEN
    next_generation:=existing.generation+1;
    IF existing.request_hash<>presented_request_hash THEN
      RAISE EXCEPTION 'duplicate suggestion idempotency conflict';
    END IF;
    IF existing.state='completed' AND existing.expires_at>operation_time THEN
      RETURN jsonb_build_object('kind','resolved','response',existing.response);
    END IF;
    IF existing.state='failed' AND existing.expires_at>operation_time THEN
      RETURN jsonb_build_object(
        'kind','failed','stableErrorCode',existing.stable_error_code
      );
    END IF;
    IF existing.state IN ('pending','running') AND existing.lease_expires_at>operation_time THEN
      RETURN jsonb_build_object('kind','busy');
    END IF;
    IF existing.state IN ('pending','running') THEN
      SELECT * INTO reserved FROM public.quota_reservations reservations
      WHERE reservations.id=existing.reservation_id FOR UPDATE;
      IF reserved.id IS NULL
        OR reserved.user_id<>account_user_id
        OR reserved.owner_user_id<>account_user_id
        OR reserved.request_id<>existing.id
        OR reserved.status NOT IN ('active','released')
      THEN RAISE EXCEPTION 'invalid duplicate suggestion reservation'; END IF;
      IF existing.dispatched_at IS NULL THEN
        UPDATE public.quota_reservations SET status='released',updated_at=operation_time
        WHERE id=reserved.id AND status='active';
        DELETE FROM public.learning_duplicate_suggestion_requests WHERE id=existing.id;
      ELSE
        IF existing.price_version_id IS NULL THEN
          RAISE EXCEPTION 'invalid duplicate suggestion reservation';
        END IF;
        INSERT INTO public.usage_ledger(
          id,user_id,owner_user_id,request_id,call_ordinal,period_start,feature,
          price_version_id,cost_micro_usd,outcome
        ) VALUES(
          recovery_ledger_id,account_user_id,account_user_id,existing.id,0,
          reserved.period_start,'learning-duplicate-suggestions',existing.price_version_id,
          reserved.reserved_micro_usd,'failed'
        );
        UPDATE public.quota_reservations SET status='settled',updated_at=operation_time
        WHERE id=reserved.id;
        UPDATE public.learning_duplicate_suggestion_requests
        SET state='failed',stable_error_code='model_unavailable',updated_at=operation_time
        WHERE id=existing.id;
        RETURN jsonb_build_object(
          'kind','failed','stableErrorCode','model_unavailable'
        );
      END IF;
    ELSE
      DELETE FROM public.learning_duplicate_suggestion_requests WHERE id=existing.id;
    END IF;
  END IF;
  SELECT items.type INTO source_type FROM public.learning_items items
  WHERE items.id=presented_source_item_id AND items.owner_user_id=account_user_id
    AND items.revision=presented_source_revision
    AND items.archived_at IS NULL AND items.deleted_at IS NULL
  FOR UPDATE;
  IF source_type IS NULL THEN RAISE EXCEPTION 'duplicate suggestion source conflict'; END IF;
  IF jsonb_typeof(presented_candidate_aliases)<>'array'
    OR jsonb_array_length(presented_candidate_aliases) NOT BETWEEN 1 AND 50
  THEN RAISE EXCEPTION 'invalid duplicate suggestion candidates'; END IF;
  SELECT count(*)::integer,count(DISTINCT candidate->>'alias')::integer,
    count(items.id)::integer
  INTO alias_count,distinct_alias_count,candidate_count
  FROM jsonb_array_elements(presented_candidate_aliases) candidate
  LEFT JOIN public.learning_items items
    ON items.id=(candidate->>'itemId')::uuid
    AND items.owner_user_id=account_user_id
    AND items.revision=(candidate->>'itemRevision')::integer
    AND items.type=source_type AND items.archived_at IS NULL AND items.deleted_at IS NULL
    AND items.id<>presented_source_item_id
  WHERE candidate->>'alias' IS NOT NULL
    AND jsonb_typeof(candidate)='object'
    AND candidate-'alias'-'itemId'-'itemRevision'='{}'::jsonb
    AND char_length(candidate->>'alias') BETWEEN 1 AND 64;
  IF alias_count<>jsonb_array_length(presented_candidate_aliases)
    OR distinct_alias_count<>alias_count OR candidate_count<>alias_count
  THEN RAISE EXCEPTION 'invalid duplicate suggestion candidates'; END IF;
  PERFORM public.require_model_price_version(
    model_price_version_id,model_provider,model_name,model_input_price,
    model_cached_input_price,model_output_price
  );
  PERFORM public.reserve_quota(
    new_reservation_id,account_user_id,new_request_id,amount_micro_usd,new_lease_expires_at
  );
  INSERT INTO public.learning_duplicate_suggestion_requests(
    id,owner_user_id,source_item_id,source_revision,idempotency_key,request_hash,state,generation,
    lease_token,lease_expires_at,reservation_id,price_version_id,candidate_aliases,
    created_at,updated_at,expires_at
  ) VALUES(
    new_request_id,account_user_id,presented_source_item_id,presented_source_revision,
    presented_idempotency_key,presented_request_hash,'running',next_generation,new_lease_token,
    new_lease_expires_at,new_reservation_id,NULL,presented_candidate_aliases,
    operation_time,operation_time,terminal_expires_at
  );
  RETURN jsonb_build_object('kind','acquired','reservationId',new_reservation_id::text);
END;
$$;

CREATE FUNCTION mark_duplicate_suggestion_dispatched(
  account_user_id uuid,
  request_id uuid,
  presented_lease_token text,
  presented_reservation_id uuid,
  operation_time timestamptz,
  model_price_version_id uuid,
  model_provider text,
  model_name text,
  model_input_price bigint,
  model_cached_input_price bigint,
  model_output_price bigint
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  IF huayi_private.current_owner_user_id() IS DISTINCT FROM account_user_id THEN
    RAISE EXCEPTION 'duplicate suggestion owner context required';
  END IF;
  PERFORM public.require_model_price_version(
    model_price_version_id,model_provider,model_name,model_input_price,
    model_cached_input_price,model_output_price
  );
  UPDATE public.learning_duplicate_suggestion_requests
  SET dispatched_at=operation_time,price_version_id=model_price_version_id,
    updated_at=operation_time
  WHERE id=request_id AND owner_user_id=account_user_id AND state='running'
    AND lease_token=presented_lease_token AND lease_expires_at>operation_time
    AND reservation_id=presented_reservation_id AND dispatched_at IS NULL;
  RETURN FOUND;
END;
$$;

CREATE FUNCTION finish_duplicate_suggestion_request(
  account_user_id uuid,
  request_id uuid,
  presented_lease_token text,
  presented_reservation_id uuid,
  new_ledger_id uuid,
  billed_calls jsonb,
  public_response jsonb,
  failure_code text,
  operation_time timestamptz
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  request public.learning_duplicate_suggestion_requests%ROWTYPE;
  reserved public.quota_reservations%ROWTYPE;
  billed_call jsonb;
  call_cost bigint;
  call_input integer;
  call_cached_input integer;
  call_output integer;
  outcome text;
BEGIN
  IF huayi_private.current_owner_user_id() IS DISTINCT FROM account_user_id THEN
    RAISE EXCEPTION 'duplicate suggestion owner context required';
  END IF;
  SELECT * INTO request FROM public.learning_duplicate_suggestion_requests requests
  WHERE requests.id=request_id AND requests.owner_user_id=account_user_id FOR UPDATE;
  IF request.id IS NULL OR request.state<>'running' OR request.dispatched_at IS NULL
    OR request.lease_token<>presented_lease_token OR request.lease_expires_at<=operation_time
    OR request.reservation_id<>presented_reservation_id
  THEN RAISE EXCEPTION 'duplicate suggestion lease lost'; END IF;
  IF (public_response IS NULL)=(failure_code IS NULL)
    OR failure_code IS NOT NULL
      AND failure_code NOT IN ('model_output_invalid','model_unavailable')
  THEN RAISE EXCEPTION 'invalid duplicate suggestion terminal'; END IF;
  SELECT * INTO reserved FROM public.quota_reservations reservations
  WHERE reservations.id=presented_reservation_id FOR UPDATE;
  IF reserved.id IS NULL OR reserved.user_id<>account_user_id
    OR reserved.owner_user_id<>account_user_id OR reserved.request_id<>request.id
    OR reserved.status NOT IN ('active','released') OR request.price_version_id IS NULL
  THEN RAISE EXCEPTION 'invalid duplicate suggestion reservation'; END IF;
  IF billed_calls IS NULL THEN
    call_cost:=reserved.reserved_micro_usd;
    call_input:=NULL;
    call_cached_input:=NULL;
    call_output:=NULL;
  ELSE
    IF jsonb_typeof(billed_calls)<>'array' OR jsonb_array_length(billed_calls)<>1
    THEN RAISE EXCEPTION 'invalid duplicate suggestion settlement'; END IF;
    billed_call:=billed_calls->0;
    call_cost:=(billed_call->>'costMicroUsd')::bigint;
    call_input:=(billed_call->>'inputTokens')::integer;
    call_cached_input:=(billed_call->>'cachedInputTokens')::integer;
    call_output:=(billed_call->>'outputTokens')::integer;
    IF call_cost<0 OR call_cost>reserved.reserved_micro_usd OR call_input<0
      OR call_cached_input<0 OR call_output<0 OR call_cached_input>call_input
    THEN RAISE EXCEPTION 'invalid duplicate suggestion settlement'; END IF;
  END IF;
  outcome:=CASE WHEN public_response IS NULL THEN 'failed' ELSE 'succeeded' END;
  INSERT INTO public.usage_ledger(
    id,user_id,owner_user_id,request_id,call_ordinal,period_start,feature,
    price_version_id,cost_micro_usd,outcome,input_tokens,cached_input_tokens,output_tokens
  ) VALUES(
    new_ledger_id,account_user_id,account_user_id,request.id,0,reserved.period_start,
    'learning-duplicate-suggestions',request.price_version_id,call_cost,outcome,
    call_input,call_cached_input,call_output
  );
  UPDATE public.quota_reservations SET status='settled',updated_at=operation_time
  WHERE id=reserved.id;
  UPDATE public.learning_duplicate_suggestion_requests
  SET state=CASE WHEN public_response IS NULL THEN 'failed' ELSE 'completed' END,
    response=public_response,stable_error_code=failure_code,updated_at=operation_time
  WHERE id=request.id;
  RETURN COALESCE(public_response,jsonb_build_object(
    'stableErrorCode',failure_code
  ));
END;
$$;

CREATE FUNCTION cleanup_duplicate_suggestion_requests(
  recovery_ledger_ids uuid[], operation_time timestamptz
) RETURNS TABLE(abandoned_count integer, deleted_count integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  candidate record;
  reserved public.quota_reservations%ROWTYPE;
  ledger_ordinal integer:=0;
BEGIN
  IF cardinality(recovery_ledger_ids)<>100 THEN
    RAISE EXCEPTION 'invalid duplicate suggestion cleanup batch';
  END IF;
  abandoned_count:=0;
  FOR candidate IN
    SELECT requests.* FROM public.learning_duplicate_suggestion_requests requests
    WHERE requests.state IN ('pending','running')
      AND requests.lease_expires_at<=operation_time
    ORDER BY requests.lease_expires_at,requests.id
    FOR UPDATE SKIP LOCKED LIMIT 100
  LOOP
    SELECT * INTO reserved FROM public.quota_reservations reservations
    WHERE reservations.id=candidate.reservation_id FOR UPDATE;
    IF reserved.id IS NULL OR reserved.user_id<>candidate.owner_user_id
      OR reserved.request_id<>candidate.id OR reserved.status NOT IN ('active','released')
    THEN RAISE EXCEPTION 'invalid duplicate suggestion reservation'; END IF;
    IF candidate.dispatched_at IS NULL THEN
      UPDATE public.quota_reservations SET status='released',updated_at=operation_time
      WHERE id=reserved.id AND status='active';
      DELETE FROM public.learning_duplicate_suggestion_requests
      WHERE id=candidate.id;
    ELSE
      ledger_ordinal:=ledger_ordinal+1;
      INSERT INTO public.usage_ledger(
        id,user_id,owner_user_id,request_id,call_ordinal,period_start,feature,
        price_version_id,cost_micro_usd,outcome
      ) VALUES(
        recovery_ledger_ids[ledger_ordinal],candidate.owner_user_id,candidate.owner_user_id,
        candidate.id,0,reserved.period_start,'learning-duplicate-suggestions',
        candidate.price_version_id,reserved.reserved_micro_usd,'failed'
      );
      UPDATE public.quota_reservations SET status='settled',updated_at=operation_time
      WHERE id=reserved.id;
      UPDATE public.learning_duplicate_suggestion_requests
      SET state='failed',stable_error_code='model_unavailable',updated_at=operation_time
      WHERE id=candidate.id;
    END IF;
    abandoned_count:=abandoned_count+1;
  END LOOP;
  WITH candidates AS (
    SELECT requests.id FROM public.learning_duplicate_suggestion_requests requests
    WHERE requests.state IN ('completed','failed') AND requests.expires_at<=operation_time
    ORDER BY requests.expires_at,requests.id
    FOR UPDATE SKIP LOCKED LIMIT GREATEST(0,100-abandoned_count)
  ), deleted AS (
    DELETE FROM public.learning_duplicate_suggestion_requests requests USING candidates
    WHERE requests.id=candidates.id RETURNING requests.id
  ) SELECT count(*)::integer INTO deleted_count FROM deleted;
  RETURN NEXT;
END;
$$;

CREATE FUNCTION require_model_price_version(
  expected_id uuid,
  expected_provider text,
  expected_model text,
  expected_input bigint,
  expected_cached_input bigint,
  expected_output bigint
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.model_price_versions
    WHERE id = expected_id
      AND provider = expected_provider
      AND model = expected_model
      AND input_micro_usd_per_million = expected_input
      AND cached_input_micro_usd_per_million = expected_cached_input
      AND output_micro_usd_per_million = expected_output
  ) THEN
    RAISE EXCEPTION 'model price mismatch';
  END IF;
  RETURN true;
END;
$$;

CREATE FUNCTION begin_analysis_request(
  account_user_id uuid,
  request_id uuid,
  idempotency_key text,
  request_hash text,
  unit_count integer,
  lease_token text,
  lease_expires_at timestamptz,
  recovery_ledger_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE existing public.analysis_requests%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(account_user_id::text || ':' || idempotency_key, 0));
  SELECT * INTO existing FROM public.analysis_requests
  WHERE owner_user_id = account_user_id AND analysis_requests.idempotency_key = begin_analysis_request.idempotency_key
  FOR UPDATE;
  IF existing.id IS NOT NULL THEN
    IF existing.request_hash <> begin_analysis_request.request_hash THEN
      RAISE EXCEPTION 'idempotency conflict';
    END IF;
    RETURN jsonb_build_object('kind', CASE
      WHEN existing.state <> 'running' THEN 'terminal'
      WHEN existing.lease_expires_at <= now() THEN 'expired'
      ELSE 'running' END,
      'requestId', existing.id::text, 'unitCount', existing.unit_count,
      'event', existing.terminal_event);
  END IF;
  INSERT INTO public.analysis_requests(id,owner_user_id,idempotency_key,request_hash,unit_count,
    state,lease_token,lease_expires_at,recovery_ledger_id)
  VALUES(request_id,account_user_id,idempotency_key,request_hash,unit_count,'running',lease_token,
    lease_expires_at,recovery_ledger_id);
  RETURN jsonb_build_object('kind','acquired','requestId',request_id::text,'leaseToken',lease_token);
END;
$$;

CREATE FUNCTION begin_capture_analysis_request(
  account_user_id uuid, study_capture_id uuid, expected_revision integer,
  capture_intent text, request_id uuid, idempotency_key text, request_hash text,
  unit_count integer, lease_token text, lease_expires_at timestamptz, recovery_ledger_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  existing public.analysis_requests%ROWTYPE;
  capture public.study_captures%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(account_user_id::text || ':' || idempotency_key,0));
  SELECT * INTO existing FROM public.analysis_requests
  WHERE owner_user_id=account_user_id
    AND analysis_requests.idempotency_key=begin_capture_analysis_request.idempotency_key
  FOR UPDATE;
  IF existing.id IS NOT NULL THEN
    IF existing.request_hash <> begin_capture_analysis_request.request_hash THEN
      RAISE EXCEPTION 'idempotency conflict';
    END IF;
    RETURN jsonb_build_object('kind',CASE
      WHEN existing.state <> 'running' THEN 'terminal'
      WHEN existing.lease_expires_at <= now() THEN 'expired'
      ELSE 'running' END,'requestId',existing.id::text,'unitCount',existing.unit_count,
      'event',existing.terminal_event);
  END IF;
  SELECT * INTO capture FROM public.study_captures
  WHERE id=study_capture_id AND owner_user_id=account_user_id FOR UPDATE;
  IF capture.id IS NULL THEN RAISE EXCEPTION 'study capture not found'; END IF;
  IF EXISTS (SELECT 1 FROM public.analysis_requests requests
    WHERE requests.owner_user_id=account_user_id AND requests.study_capture_id=capture.id
      AND requests.state='running') THEN
    RAISE EXCEPTION 'study capture analysis busy';
  END IF;
  IF capture.revision <> expected_revision THEN
    RAISE EXCEPTION 'study capture revision conflict';
  END IF;
  IF (capture_intent='initial' AND capture.status <> 'pending') OR
    (capture_intent='reanalysis' AND capture.status <> 'analyzed') OR
    capture_intent NOT IN ('initial','reanalysis') THEN
    RAISE EXCEPTION 'study capture state conflict';
  END IF;
  INSERT INTO public.analysis_requests(id,owner_user_id,study_capture_id,capture_intent,
    idempotency_key,request_hash,unit_count,state,lease_token,lease_expires_at,recovery_ledger_id)
  VALUES(request_id,account_user_id,capture.id,capture_intent,idempotency_key,request_hash,
    unit_count,'running',lease_token,lease_expires_at,recovery_ledger_id);
  UPDATE public.study_captures SET status=CASE WHEN capture_intent='initial' THEN 'analyzing'
    ELSE status END,revision=revision+1,updated_at=now() WHERE id=capture.id;
  RETURN jsonb_build_object('kind','acquired','requestId',request_id::text,
    'leaseToken',lease_token);
END;
$$;

CREATE FUNCTION abandon_analysis_request(account_user_id uuid, request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  request public.analysis_requests%ROWTYPE;
  reserved public.quota_reservations%ROWTYPE;
  quota_limit bigint;
  quota_used bigint;
  quota_reserved bigint;
  period_start timestamptz;
  period_end timestamptz;
  event jsonb;
BEGIN
  SELECT * INTO request FROM public.analysis_requests
  WHERE id=request_id AND owner_user_id=account_user_id FOR UPDATE;
  IF request.id IS NULL THEN RAISE EXCEPTION 'analysis request not found'; END IF;
  IF request.state <> 'running' THEN RETURN request.terminal_event; END IF;
  IF request.lease_expires_at > now() THEN RAISE EXCEPTION 'analysis request active'; END IF;
  IF request.reservation_id IS NOT NULL THEN
    SELECT * INTO reserved FROM public.quota_reservations WHERE id=request.reservation_id FOR UPDATE;
    IF reserved.id IS NULL
      OR reserved.user_id <> account_user_id
      OR reserved.owner_user_id <> account_user_id
      OR reserved.request_id <> request.id THEN
      RAISE EXCEPTION 'invalid abandoned reservation';
    END IF;
    IF request.dispatched_at IS NULL THEN
      UPDATE public.quota_reservations SET status='released',updated_at=now()
      WHERE id=reserved.id AND status='active';
    ELSIF request.price_version_id IS NULL THEN
      RAISE EXCEPTION 'invalid abandoned reservation';
    ELSIF reserved.status IN ('active', 'released') THEN
      INSERT INTO public.usage_ledger (
        id, user_id, owner_user_id, request_id, call_ordinal, period_start, feature,
        price_version_id, cost_micro_usd, outcome
      ) VALUES (
        request.recovery_ledger_id, reserved.user_id, reserved.owner_user_id, reserved.request_id,
        0, reserved.period_start, 'analysis', request.price_version_id,
        reserved.reserved_micro_usd, 'failed'
      );
      UPDATE public.quota_reservations SET status='settled',updated_at=now()
      WHERE id=reserved.id;
    ELSE
      RAISE EXCEPTION 'invalid abandoned reservation';
    END IF;
  END IF;
  SELECT grants.limit_micro_usd, grants.period_start, grants.period_end,
    COALESCE((SELECT sum(cost_micro_usd) FROM public.usage_ledger
      WHERE user_id=account_user_id AND usage_ledger.period_start=grants.period_start),0),
    COALESCE((SELECT sum(reserved_micro_usd) FROM public.quota_reservations
      WHERE user_id=account_user_id AND quota_reservations.period_start=grants.period_start
      AND status='active'),0)
  INTO quota_limit,period_start,period_end,quota_used,quota_reserved
  FROM public.quota_grants grants WHERE user_id=account_user_id AND superseded_at IS NULL
  ORDER BY grants.period_start DESC LIMIT 1;
  event := jsonb_build_object('type','analysis.failed','error',jsonb_build_object(
    'code','model_unavailable','message',
    'The previous analysis did not finish. Retry with a new idempotency key.',
    'requestId',request.id::text),'quota',jsonb_build_object(
    'availableMicroUsd',GREATEST(0,quota_limit-quota_used-quota_reserved),
    'limitMicroUsd',quota_limit,'percentUsed',CASE WHEN quota_limit=0 THEN 100
      ELSE LEAST(100,(quota_used::numeric/quota_limit::numeric)*100) END,
    'periodEnd',to_char(period_end AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'periodStart',to_char(period_start AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'reservedMicroUsd',quota_reserved,'usedMicroUsd',quota_used,
    'warning',CASE WHEN quota_used+quota_reserved>=quota_limit THEN 'exhausted'
      WHEN quota_used::numeric/quota_limit::numeric>=0.8 THEN 'warning' ELSE 'available' END));
  UPDATE public.analysis_requests SET state='failed',terminal_event=event,updated_at=now()
  WHERE id=request.id;
  IF request.study_capture_id IS NOT NULL THEN
    UPDATE public.study_captures SET status=CASE WHEN request.capture_intent='initial'
      THEN 'pending' ELSE 'analyzed' END,revision=revision+1,updated_at=now()
    WHERE id=request.study_capture_id AND owner_user_id=account_user_id;
  END IF;
  RETURN event;
END;
$$;

CREATE FUNCTION attach_analysis_reservation(
  account_user_id uuid, request_id uuid, lease_token text, reservation_id uuid
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  UPDATE public.analysis_requests SET reservation_id=attach_analysis_reservation.reservation_id,
    updated_at=now() WHERE id=request_id AND owner_user_id=account_user_id
    AND state='running' AND analysis_requests.lease_token=attach_analysis_reservation.lease_token
    AND lease_expires_at > now();
  IF NOT FOUND THEN RAISE EXCEPTION 'analysis lease lost'; END IF;
  RETURN true;
END;
$$;

CREATE FUNCTION mark_analysis_dispatched(
  account_user_id uuid, request_id uuid, lease_token text, operation_time timestamptz,
  model_price_version_id uuid, model_provider text, model_name text,
  model_input_price bigint, model_cached_input_price bigint, model_output_price bigint
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  PERFORM public.require_model_price_version(
    model_price_version_id,model_provider,model_name,model_input_price,
    model_cached_input_price,model_output_price
  );
  UPDATE public.analysis_requests SET price_version_id=model_price_version_id,
    dispatched_at=operation_time,updated_at=operation_time
  WHERE id=request_id AND owner_user_id=account_user_id AND state='running'
    AND analysis_requests.lease_token=mark_analysis_dispatched.lease_token
    AND lease_expires_at>operation_time AND reservation_id IS NOT NULL
    AND dispatched_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'analysis lease lost'; END IF;
  RETURN true;
END;
$$;

CREATE FUNCTION abandon_extension_query(
  account_user_id uuid, generation_id uuid, recovery_ledger_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  generation public.extension_query_generations%ROWTYPE;
  reserved public.quota_reservations%ROWTYPE;
  quota_limit bigint; quota_used bigint; quota_reserved bigint;
  period_start timestamptz; period_end timestamptz; event jsonb;
BEGIN
  SELECT * INTO generation FROM public.extension_query_generations
  WHERE id=generation_id AND owner_user_id=account_user_id FOR UPDATE;
  IF generation.id IS NULL OR generation.state <> 'running'
    OR generation.lease_expires_at > now() THEN
    RAISE EXCEPTION 'query lease lost';
  END IF;
  IF generation.reservation_id IS NOT NULL THEN
    SELECT * INTO reserved FROM public.quota_reservations
    WHERE id=generation.reservation_id FOR UPDATE;
    IF reserved.id IS NULL OR reserved.user_id <> account_user_id
      OR reserved.request_id <> generation.id
      OR reserved.status NOT IN ('active','released') THEN
      RAISE EXCEPTION 'invalid abandoned query reservation';
    END IF;
    IF generation.dispatched_at IS NULL THEN
      UPDATE public.quota_reservations SET status='released',updated_at=now()
      WHERE id=reserved.id AND status='active';
    ELSE
      IF generation.price_version_id IS NULL THEN
        RAISE EXCEPTION 'invalid abandoned query reservation';
      END IF;
      INSERT INTO public.usage_ledger(
        id,user_id,owner_user_id,request_id,call_ordinal,period_start,feature,
        price_version_id,cost_micro_usd,outcome
      ) VALUES(
        recovery_ledger_id,account_user_id,account_user_id,generation.id,0,reserved.period_start,
        'extension-query',generation.price_version_id,reserved.reserved_micro_usd,'failed'
      );
      UPDATE public.quota_reservations SET status='settled',updated_at=now()
      WHERE id=reserved.id;
    END IF;
  END IF;
  SELECT grants.limit_micro_usd,grants.period_start,grants.period_end,
    COALESCE((SELECT sum(cost_micro_usd) FROM public.usage_ledger
      WHERE user_id=account_user_id AND usage_ledger.period_start=grants.period_start),0),
    COALESCE((SELECT sum(reserved_micro_usd) FROM public.quota_reservations
      WHERE user_id=account_user_id AND quota_reservations.period_start=grants.period_start
      AND status='active'),0)
  INTO quota_limit,period_start,period_end,quota_used,quota_reserved
  FROM public.quota_grants grants WHERE user_id=account_user_id AND superseded_at IS NULL
  ORDER BY grants.period_start DESC LIMIT 1;
  event := jsonb_build_object('type','query.failed','generationId',generation.id::text,
    'error',jsonb_build_object('code','model_unavailable','message',
      'The previous query did not finish.','requestId',generation.id::text),
    'quota',jsonb_build_object(
      'availableMicroUsd',GREATEST(0,quota_limit-quota_used-quota_reserved),
      'limitMicroUsd',quota_limit,'percentUsed',CASE WHEN quota_limit=0 THEN 100
        ELSE LEAST(100,(quota_used::numeric/quota_limit::numeric)*100) END,
      'periodEnd',to_char(period_end AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'periodStart',to_char(period_start AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'reservedMicroUsd',quota_reserved,'usedMicroUsd',quota_used,
      'warning',CASE WHEN quota_used+quota_reserved>=quota_limit THEN 'exhausted'
        WHEN quota_limit>0 AND quota_used::numeric/quota_limit::numeric>=0.8 THEN 'warning'
        ELSE 'available' END));
  UPDATE public.extension_query_generations
  SET state='failed',terminal_event=event,updated_at=now() WHERE id=generation.id;
  RETURN event;
END;
$$;

CREATE FUNCTION cleanup_extension_queries(recovery_ledger_ids uuid[])
RETURNS TABLE(abandoned_count integer, deleted_count integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE candidate record; ledger_ordinal integer := 0;
BEGIN
  IF cardinality(recovery_ledger_ids) <> 100 THEN
    RAISE EXCEPTION 'invalid extension query cleanup batch';
  END IF;
  abandoned_count := 0;
  FOR candidate IN
    SELECT generations.id,generations.owner_user_id
    FROM public.extension_query_generations generations
    WHERE generations.state='running' AND generations.lease_expires_at<=now()
    ORDER BY generations.lease_expires_at,generations.id
    FOR UPDATE SKIP LOCKED LIMIT 100
  LOOP
    ledger_ordinal := ledger_ordinal+1;
    PERFORM public.abandon_extension_query(
      candidate.owner_user_id,candidate.id,recovery_ledger_ids[ledger_ordinal]
    );
    abandoned_count := abandoned_count+1;
  END LOOP;
  WITH candidates AS (
    SELECT generations.id FROM public.extension_query_generations generations
    WHERE generations.state IN ('completed','failed') AND generations.expires_at<=now()
    ORDER BY generations.expires_at,generations.id
    FOR UPDATE SKIP LOCKED LIMIT 100
  ), deleted AS (
    DELETE FROM public.extension_query_generations generations USING candidates
    WHERE generations.id=candidates.id RETURNING generations.id
  ) SELECT count(*)::integer INTO deleted_count FROM deleted;
  RETURN NEXT;
END;
$$;

CREATE FUNCTION finish_analysis_request(
  account_user_id uuid, request_id uuid, lease_token text, final_event jsonb
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE request public.analysis_requests%ROWTYPE;
BEGIN
  SELECT * INTO request FROM public.analysis_requests WHERE id=request_id
    AND owner_user_id=account_user_id FOR UPDATE;
  IF request.id IS NULL OR request.state <> 'running' OR request.lease_token <> lease_token
    OR request.lease_expires_at <= now() THEN RAISE EXCEPTION 'analysis lease lost'; END IF;
  IF request.dispatched_at IS NULL AND request.reservation_id IS NOT NULL THEN
    UPDATE public.quota_reservations SET status='released',updated_at=now()
    WHERE id=request.reservation_id AND owner_user_id=account_user_id AND status='active';
  END IF;
  UPDATE public.analysis_requests SET state=CASE final_event->>'type'
    WHEN 'analysis.completed' THEN 'completed' ELSE 'failed' END,
    terminal_event=finish_analysis_request.final_event, updated_at=now()
  WHERE id=request.id;
  IF request.study_capture_id IS NOT NULL THEN
    UPDATE public.study_captures SET status=CASE
      WHEN final_event->>'type'='analysis.completed' THEN 'analyzed'
      WHEN request.capture_intent='initial' THEN 'pending' ELSE 'analyzed' END,
      revision=revision+1,updated_at=now()
    WHERE id=request.study_capture_id AND owner_user_id=account_user_id;
  END IF;
  RETURN true;
END;
$$;

CREATE FUNCTION require_analysis_lease(
  account_user_id uuid, request_id uuid, lease_token text
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE request public.analysis_requests%ROWTYPE;
BEGIN
  SELECT * INTO request FROM public.analysis_requests
  WHERE id=require_analysis_lease.request_id FOR UPDATE;
  IF request.id IS NULL OR request.owner_user_id <> account_user_id OR request.state <> 'running'
    OR request.lease_token <> require_analysis_lease.lease_token
    OR request.lease_expires_at <= now() THEN
    RAISE EXCEPTION 'analysis lease lost';
  END IF;
  RETURN true;
END;
$$;

CREATE FUNCTION huayi_private.analysis_public_record(record_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT jsonb_build_object(
    'archivedAt', CASE WHEN records.archived_at IS NULL THEN NULL ELSE to_char(
      records.archived_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END,
    'candidates', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'id', candidates.id::text, 'ordinal', candidates.ordinal, 'payload', candidates.payload,
      'analysisUnitId', candidates.analysis_unit_id, 'type', candidates.candidate_type
    ) ORDER BY candidates.ordinal) FROM public.analysis_candidates candidates
      WHERE candidates.analysis_id=records.id), '[]'::jsonb),
    'createdAt', to_char(records.created_at AT TIME ZONE 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), 'id', records.id::text,
    'modelMetadata', records.model_metadata, 'result', records.result,
    'reviewState', records.review_state, 'revision', records.revision,
    'selectionKind', records.selection_kind,
    'source', jsonb_strip_nulls(jsonb_build_object(
      'title', records.source_title, 'type', records.source_type,
      'userContext', records.source_context
    )),
    'sourceNormalizedHash', records.source_normalized_hash,
    'sourceText', records.source_text,
    'updatedAt', to_char(records.updated_at AT TIME ZONE 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  ) || CASE WHEN records.study_capture_id IS NULL THEN '{}'::jsonb ELSE
    jsonb_build_object('studyCaptureId',records.study_capture_id::text) END
  FROM public.analysis_records records WHERE records.id=record_id;
$$;

CREATE FUNCTION mutate_analysis_record(
  account_user_id uuid, operation_name text, idempotency_key text, request_hash text,
  analysis_id uuid, expected_revision integer, mutation_time timestamptz,
  idempotency_expires_at timestamptz
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  existing public.idempotency_records%ROWTYPE;
  record public.analysis_records%ROWTYPE;
  result jsonb;
BEGIN
  IF operation_name NOT IN ('analysis.archive','analysis.process','analysis.restore')
    OR char_length(idempotency_key) NOT BETWEEN 1 AND 128
    OR request_hash !~ '^[0-9a-f]{64}$' OR expected_revision < 1
    OR idempotency_expires_at <= mutation_time THEN
    RAISE EXCEPTION 'invalid analysis mutation';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    account_user_id::text || ':' || operation_name || ':' || idempotency_key, 2
  ));
  SELECT * INTO existing FROM public.idempotency_records
    WHERE owner_user_id=account_user_id AND operation=operation_name AND key=idempotency_key;
  IF FOUND THEN
    IF existing.request_hash <> request_hash THEN RAISE EXCEPTION 'idempotency conflict'; END IF;
    RETURN existing.response;
  END IF;
  SELECT * INTO record FROM public.analysis_records
    WHERE id=analysis_id AND owner_user_id=account_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'analysis not found'; END IF;
  IF record.revision <> expected_revision THEN RAISE EXCEPTION 'revision conflict'; END IF;
  UPDATE public.analysis_records SET
    archived_at=CASE WHEN operation_name='analysis.archive' THEN mutation_time
      WHEN operation_name='analysis.restore' THEN NULL ELSE archived_at END,
    review_state=CASE WHEN operation_name='analysis.process' THEN 'reviewed'
      ELSE review_state END,
    revision=revision+1, updated_at=mutation_time
    WHERE id=analysis_id AND owner_user_id=account_user_id;
  result := huayi_private.analysis_public_record(analysis_id);
  INSERT INTO public.idempotency_records(
    owner_user_id,operation,key,request_hash,response,expires_at
  ) VALUES (account_user_id,operation_name,idempotency_key,request_hash,result,
    idempotency_expires_at);
  RETURN result;
END;
$$;

CREATE FUNCTION delete_analysis_record(
  account_user_id uuid, idempotency_key text, request_hash text, analysis_id uuid,
  expected_revision integer, delete_study_capture boolean, mutation_time timestamptz,
  idempotency_expires_at timestamptz
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  existing public.idempotency_records%ROWTYPE;
  record public.analysis_records%ROWTYPE;
  capture_id uuid;
  latest_id uuid;
  result jsonb;
BEGIN
  IF char_length(idempotency_key) NOT BETWEEN 1 AND 128
    OR request_hash !~ '^[0-9a-f]{64}$' OR expected_revision < 1
    OR idempotency_expires_at <= mutation_time THEN RAISE EXCEPTION 'invalid analysis mutation';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(
    account_user_id::text || ':analysis.delete:' || idempotency_key,2));
  SELECT * INTO existing FROM public.idempotency_records
  WHERE owner_user_id=account_user_id AND operation='analysis.delete' AND key=idempotency_key;
  IF FOUND THEN
    IF existing.request_hash <> request_hash THEN RAISE EXCEPTION 'idempotency conflict'; END IF;
    RETURN existing.response;
  END IF;
  SELECT * INTO record FROM public.analysis_records
  WHERE id=analysis_id AND owner_user_id=account_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'analysis not found'; END IF;
  capture_id := record.study_capture_id;
  IF capture_id IS NOT NULL THEN
    PERFORM 1 FROM public.study_captures WHERE id=capture_id AND owner_user_id=account_user_id
      FOR UPDATE;
    IF EXISTS (SELECT 1 FROM public.analysis_requests requests
      WHERE requests.owner_user_id=account_user_id AND requests.study_capture_id=capture_id
        AND requests.state='running') THEN RAISE EXCEPTION 'analysis capture relationship conflict';
    END IF;
  END IF;
  SELECT * INTO record FROM public.analysis_records
  WHERE id=analysis_id AND owner_user_id=account_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'analysis not found'; END IF;
  IF record.revision <> expected_revision THEN RAISE EXCEPTION 'revision conflict'; END IF;
  IF delete_study_capture THEN
    IF capture_id IS NULL THEN RAISE EXCEPTION 'analysis capture relationship conflict'; END IF;
    SELECT id INTO latest_id FROM public.analysis_records WHERE study_capture_id=capture_id
      ORDER BY created_at DESC,id DESC LIMIT 1;
    IF latest_id IS DISTINCT FROM analysis_id THEN
      RAISE EXCEPTION 'analysis capture relationship conflict';
    END IF;
  END IF;
  result := jsonb_build_object('deleted',true,'id',analysis_id::text);
  DELETE FROM public.analysis_records WHERE id=analysis_id;
  IF capture_id IS NOT NULL THEN
    IF delete_study_capture THEN
      DELETE FROM public.study_captures WHERE id=capture_id AND owner_user_id=account_user_id;
    ELSE
      UPDATE public.study_captures SET status=CASE WHEN EXISTS(
        SELECT 1 FROM public.analysis_records WHERE study_capture_id=capture_id
      ) THEN 'analyzed' ELSE 'pending' END,revision=revision+1,updated_at=mutation_time
      WHERE id=capture_id AND owner_user_id=account_user_id;
    END IF;
  END IF;
  INSERT INTO public.idempotency_records(owner_user_id,operation,key,request_hash,response,expires_at)
  VALUES(account_user_id,'analysis.delete',idempotency_key,request_hash,result,idempotency_expires_at);
  RETURN result;
END;
$$;

CREATE FUNCTION begin_idempotent_write(
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
    'practice.delete','word.upsert','word.patch','word.delete',
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

CREATE FUNCTION request_account_deletion(
  new_job_id uuid,
  account_user_id uuid,
  account_subject_hash text,
  idempotency_key_hash text,
  request_hash text,
  presented_session_hash text,
  request_time timestamptz,
  receipt_expires_at timestamptz
) RETURNS timestamptz LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE existing public.account_deletion_jobs%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(account_user_id::text, 11));
  SELECT * INTO existing FROM public.account_deletion_jobs
  WHERE subject_user_id=account_user_id FOR UPDATE;
  IF FOUND THEN
    IF existing.request_key_hash <> idempotency_key_hash
      OR existing.request_hash <> request_hash
      OR existing.request_session_hash <> presented_session_hash
    THEN RAISE EXCEPTION 'idempotency conflict'; END IF;
    RETURN existing.requested_at;
  END IF;
  PERFORM 1 FROM public.user_profiles
  WHERE user_id=account_user_id AND status IN ('active','disabled') FOR UPDATE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  INSERT INTO public.account_deletion_jobs(
    id,subject_user_id,subject_hash,state,stage,request_key_hash,request_hash,
    request_session_hash,ack_expires_at,requested_at,updated_at
  ) VALUES(
    new_job_id,account_user_id,account_subject_hash,'requested','requested',
    idempotency_key_hash,request_hash,presented_session_hash,receipt_expires_at,
    request_time,request_time
  );
  UPDATE public.user_profiles SET status='deleting',updated_at=request_time
  WHERE user_id=account_user_id;
  UPDATE public.web_sessions SET revoked_at=request_time
  WHERE user_id=account_user_id AND revoked_at IS NULL;
  UPDATE public.extension_sessions SET revoked_at=request_time
  WHERE user_id=account_user_id AND revoked_at IS NULL;
  UPDATE public.extension_pairings SET status='expired'
  WHERE user_id=account_user_id AND status IN ('pending','approved');
  RETURN request_time;
END;
$$;

CREATE FUNCTION claim_account_export(
  new_lease_hash text, new_lease_expires_at timestamptz
) RETURNS TABLE(id uuid, owner_user_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  RETURN QUERY WITH candidate AS (
    SELECT jobs.id FROM public.account_data_export_jobs jobs
    WHERE jobs.state='pending' OR (jobs.state='running' AND jobs.lease_expires_at<=now())
    ORDER BY jobs.created_at,jobs.id FOR UPDATE SKIP LOCKED LIMIT 1
  ) UPDATE public.account_data_export_jobs jobs SET
    state='running',lease_token_hash=new_lease_hash,lease_expires_at=new_lease_expires_at,
    last_error_code=NULL,revision=revision+1,updated_at=now()
    FROM candidate WHERE jobs.id=candidate.id RETURNING jobs.id,jobs.owner_user_id;
END;
$$;

CREATE FUNCTION complete_account_export(
  export_id uuid, presented_lease_hash text, export_record_count integer,
  export_byte_length bigint, export_sha256 text, export_object_key text,
  export_expires_at timestamptz
) RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
  UPDATE public.account_data_export_jobs SET state='ready',record_count=export_record_count,
    byte_length=export_byte_length,sha256=export_sha256,object_key=export_object_key,
    expires_at=export_expires_at,lease_token_hash=NULL,lease_expires_at=NULL,
    revision=revision+1,updated_at=now()
  WHERE id=export_id AND state='running' AND lease_token_hash=presented_lease_hash
  RETURNING true;
$$;

CREATE FUNCTION fail_account_export(
  export_id uuid, presented_lease_hash text, export_error_code text
) RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
  UPDATE public.account_data_export_jobs SET state='failed',last_error_code=export_error_code,
    lease_token_hash=NULL,lease_expires_at=NULL,revision=revision+1,updated_at=now()
  WHERE id=export_id AND state='running' AND lease_token_hash=presented_lease_hash
    AND export_error_code IN ('export-build-failed','object-write-failed') RETURNING true;
$$;

CREATE FUNCTION claim_expired_account_export()
RETURNS TABLE(id uuid, object_key text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  UPDATE public.account_data_export_jobs SET state='expired',revision=revision+1,updated_at=now()
  WHERE state='ready' AND expires_at<=now();
  RETURN QUERY SELECT jobs.id,jobs.object_key FROM public.account_data_export_jobs jobs
  WHERE jobs.state='expired' AND jobs.object_key IS NOT NULL
  ORDER BY jobs.updated_at,jobs.id FOR UPDATE SKIP LOCKED LIMIT 1;
END;
$$;

CREATE FUNCTION finish_expired_account_export_cleanup(export_id uuid, expected_object_key text)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
  UPDATE public.account_data_export_jobs SET object_key=NULL,last_error_code=NULL,
    revision=revision+1,updated_at=now()
  WHERE id=export_id AND state='expired' AND object_key=expected_object_key RETURNING true;
$$;

CREATE FUNCTION fail_expired_account_export_cleanup(export_id uuid, expected_object_key text)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
  UPDATE public.account_data_export_jobs SET last_error_code='object-delete-failed',
    revision=revision+1,updated_at=now()
  WHERE id=export_id AND state='expired' AND object_key=expected_object_key RETURNING true;
$$;

CREATE FUNCTION claim_account_deletion(
  new_lease_hash text, new_lease_expires_at timestamptz
) RETURNS TABLE(job_id uuid, subject_user_id uuid, stage text, object_keys text[])
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  UPDATE public.account_deletion_jobs SET request_session_hash=NULL,updated_at=now()
  WHERE state='completed' AND completed_at+interval '24 hours'<=now()
    AND request_session_hash IS NOT NULL;
  RETURN QUERY WITH candidate AS (
    SELECT jobs.id FROM public.account_deletion_jobs jobs
    WHERE jobs.state IN ('requested','failed')
      OR (jobs.state='running' AND jobs.lease_expires_at<=now())
    ORDER BY jobs.requested_at,jobs.id FOR UPDATE SKIP LOCKED LIMIT 1
  ), claimed AS (
    UPDATE public.account_deletion_jobs jobs SET state='running',lease_token_hash=new_lease_hash,
      lease_expires_at=new_lease_expires_at,attempt_count=attempt_count+1,
      last_error_code=NULL,updated_at=now() FROM candidate WHERE jobs.id=candidate.id
    RETURNING jobs.id,jobs.subject_user_id,jobs.stage
  ) SELECT claimed.id,claimed.subject_user_id,claimed.stage,
    COALESCE((SELECT array_agg(exports.object_key ORDER BY exports.object_key)
      FROM public.account_data_export_jobs exports
      WHERE exports.owner_user_id=claimed.subject_user_id AND exports.object_key IS NOT NULL),
      ARRAY[]::text[]) FROM claimed;
END;
$$;

CREATE FUNCTION advance_account_deletion(
  deletion_job_id uuid, presented_lease_hash text, expected_stage text, next_stage text
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE account_user_id uuid;
BEGIN
  SELECT subject_user_id INTO account_user_id FROM public.account_deletion_jobs
  WHERE id=deletion_job_id AND state='running' AND stage=expected_stage
    AND lease_token_hash=presented_lease_hash FOR UPDATE;
  IF account_user_id IS NULL THEN RETURN NULL; END IF;
  IF expected_stage='exports-deleted' AND next_stage='database-deleted' THEN
    DELETE FROM public.audit_events WHERE actor_user_id=account_user_id OR subject_id=account_user_id;
    UPDATE public.runtime_controls SET updated_by=NULL WHERE updated_by=account_user_id;
    DELETE FROM public.auth_flows WHERE ticket_hash IN (
      SELECT ticket_hash FROM public.invitation_claims WHERE bound_user_id=account_user_id
        OR finalized_user_id=account_user_id
    );
    DELETE FROM public.invitation_claims WHERE bound_user_id=account_user_id
      OR finalized_user_id=account_user_id;
    DELETE FROM public.invitation_claims WHERE invitation_id IN (
      SELECT id FROM public.invitations WHERE created_by=account_user_id
    );
    DELETE FROM public.invitations WHERE created_by=account_user_id;
    PERFORM set_config('huayi.account_deletion','on',true);
    DELETE FROM public.user_profiles WHERE user_id=account_user_id;
  ELSIF NOT (expected_stage='requested' AND next_stage='exports-deleted') THEN
    RAISE EXCEPTION 'invalid deletion transition';
  END IF;
  UPDATE public.account_deletion_jobs SET stage=next_stage,updated_at=now()
  WHERE id=deletion_job_id AND lease_token_hash=presented_lease_hash;
  RETURN true;
END;
$$;

CREATE FUNCTION complete_account_deletion(deletion_job_id uuid, presented_lease_hash text)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
  UPDATE public.account_deletion_jobs SET state='completed',stage='auth-deleted',
    subject_user_id=NULL,lease_token_hash=NULL,lease_expires_at=NULL,
    completed_at=now(),updated_at=now()
  WHERE id=deletion_job_id AND state='running' AND stage='database-deleted'
    AND lease_token_hash=presented_lease_hash RETURNING true;
$$;

CREATE FUNCTION fail_account_deletion(
  deletion_job_id uuid, presented_lease_hash text, deletion_error_code text
) RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
  UPDATE public.account_deletion_jobs SET state='failed',last_error_code=deletion_error_code,
    lease_token_hash=NULL,lease_expires_at=NULL,updated_at=now()
  WHERE id=deletion_job_id AND state='running' AND lease_token_hash=presented_lease_hash
    AND deletion_error_code IN (
      'object-delete-failed','database-delete-failed','auth-delete-failed'
    ) RETURNING true;
$$;

CREATE FUNCTION request_password_recovery(
  recovery_email text,
  recovery_flow_hash text,
  protected_flow_id text,
  recovery_expires_at timestamptz,
  request_time timestamptz
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE account_user_id uuid;
BEGIN
  SELECT profiles.user_id INTO account_user_id
  FROM public.user_profiles AS profiles
  JOIN public.account_sign_in_methods AS methods
    ON methods.owner_user_id=profiles.user_id AND methods.method='password'
  WHERE profiles.email=recovery_email AND profiles.status='active'
  FOR UPDATE OF profiles;
  IF account_user_id IS NULL THEN RETURN false; END IF;
  UPDATE public.password_recovery_flows SET
    stage='failed',consumed_at=request_time,
    dispatch_lease_hash=NULL,dispatch_lease_expires_at=NULL,
    completion_lease_hash=NULL,completion_lease_expires_at=NULL,
    recovery_session_hash=NULL,csrf_hash=NULL
  WHERE owner_user_id=account_user_id AND stage NOT IN ('completed','failed');
  INSERT INTO public.password_recovery_flows(
    flow_hash,owner_user_id,stage,callback_flow_ciphertext,expires_at,created_at
  ) VALUES (
    recovery_flow_hash,account_user_id,'requested',protected_flow_id,recovery_expires_at,request_time
  );
  RETURN true;
END;
$$;

CREATE FUNCTION claim_password_recovery_dispatch(
  new_lease_hash text,
  new_lease_expires_at timestamptz,
  claim_time timestamptz
) RETURNS TABLE(flow_hash text,email text,callback_flow_ciphertext text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  UPDATE public.password_recovery_flows AS flows SET
    stage='failed',consumed_at=claim_time,
    dispatch_lease_hash=NULL,dispatch_lease_expires_at=NULL,
    completion_lease_hash=NULL,completion_lease_expires_at=NULL,
    recovery_session_hash=NULL,csrf_hash=NULL
  WHERE flows.stage NOT IN ('completed','failed') AND NOT EXISTS (
    SELECT 1 FROM public.user_profiles AS profiles
    JOIN public.account_sign_in_methods AS methods
      ON methods.owner_user_id=profiles.user_id AND methods.method='password'
    WHERE profiles.user_id=flows.owner_user_id AND profiles.status='active'
  );
  UPDATE public.password_recovery_flows SET
    stage='failed',consumed_at=claim_time,
    dispatch_lease_hash=NULL,dispatch_lease_expires_at=NULL,
    completion_lease_hash=NULL,completion_lease_expires_at=NULL,
    recovery_session_hash=NULL,csrf_hash=NULL
  WHERE stage NOT IN ('completed','failed') AND expires_at <= claim_time;
  UPDATE public.password_recovery_flows SET
    stage='failed',consumed_at=claim_time,
    dispatch_lease_hash=NULL,dispatch_lease_expires_at=NULL
  WHERE stage='requested' AND dispatch_at IS NOT NULL
    AND dispatch_lease_expires_at <= claim_time;
  RETURN QUERY
  WITH candidate AS (
    SELECT flows.flow_hash FROM public.password_recovery_flows AS flows
    WHERE flows.stage='requested' AND flows.dispatch_at IS NULL
      AND (flows.dispatch_lease_expires_at IS NULL OR flows.dispatch_lease_expires_at <= claim_time)
    ORDER BY flows.created_at,flows.flow_hash
    FOR UPDATE SKIP LOCKED LIMIT 1
  ), claimed AS (
    UPDATE public.password_recovery_flows AS flows SET
      dispatch_lease_hash=new_lease_hash,dispatch_lease_expires_at=new_lease_expires_at
    FROM candidate WHERE flows.flow_hash=candidate.flow_hash
    RETURNING flows.flow_hash,flows.owner_user_id,flows.callback_flow_ciphertext
  )
  SELECT claimed.flow_hash,profiles.email,claimed.callback_flow_ciphertext
  FROM claimed JOIN public.user_profiles AS profiles ON profiles.user_id=claimed.owner_user_id;
END;
$$;

CREATE FUNCTION mark_password_recovery_dispatched(
  recovery_flow_hash text,
  presented_lease_hash text,
  marked_at timestamptz
) RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
  UPDATE public.password_recovery_flows SET dispatch_at=marked_at
  WHERE flow_hash=recovery_flow_hash AND stage='requested' AND dispatch_at IS NULL
    AND dispatch_lease_hash=presented_lease_hash AND dispatch_lease_expires_at > marked_at
  RETURNING true;
$$;

CREATE FUNCTION save_password_recovery_sent(
  recovery_flow_hash text,
  presented_lease_hash text,
  protected_provider_state text,
  saved_at timestamptz
) RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
  UPDATE public.password_recovery_flows SET
    stage='sent',provider_state_ciphertext=protected_provider_state,
    dispatch_lease_hash=NULL,dispatch_lease_expires_at=NULL
  WHERE flow_hash=recovery_flow_hash AND stage='requested' AND dispatch_at IS NOT NULL
    AND dispatch_lease_hash=presented_lease_hash AND dispatch_lease_expires_at > saved_at
  RETURNING true;
$$;

CREATE FUNCTION fail_password_recovery_dispatch(
  recovery_flow_hash text,
  presented_lease_hash text,
  failed_at timestamptz
) RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
  UPDATE public.password_recovery_flows SET
    stage='failed',consumed_at=failed_at,
    dispatch_lease_hash=NULL,dispatch_lease_expires_at=NULL
  WHERE flow_hash=recovery_flow_hash AND stage='requested' AND dispatch_at IS NOT NULL
    AND dispatch_lease_hash=presented_lease_hash
  RETURNING true;
$$;

CREATE FUNCTION read_password_recovery_state(
  recovery_flow_hash text,
  read_time timestamptz
) RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
  SELECT flows.provider_state_ciphertext
  FROM public.password_recovery_flows AS flows
  JOIN public.user_profiles AS profiles
    ON profiles.user_id=flows.owner_user_id AND profiles.status='active'
  JOIN public.account_sign_in_methods AS methods
    ON methods.owner_user_id=flows.owner_user_id AND methods.method='password'
  WHERE flows.flow_hash=recovery_flow_hash AND flows.stage='sent' AND flows.expires_at > read_time;
$$;

CREATE FUNCTION complete_password_recovery_callback(
  recovery_flow_hash text,
  provider_user_id uuid,
  provider_email text,
  protected_provider_state text,
  new_recovery_session_hash text,
  new_csrf_hash text,
  new_browser_expires_at timestamptz,
  callback_time timestamptz
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE current_flow public.password_recovery_flows%ROWTYPE;
BEGIN
  SELECT * INTO current_flow FROM public.password_recovery_flows AS flows
  WHERE flows.flow_hash=recovery_flow_hash FOR UPDATE;
  IF current_flow.flow_hash IS NULL OR current_flow.stage <> 'sent'
    OR current_flow.expires_at <= callback_time THEN RETURN false; END IF;
  IF current_flow.owner_user_id <> provider_user_id OR NOT EXISTS (
    SELECT 1 FROM public.user_profiles AS profiles
    JOIN public.account_sign_in_methods AS methods
      ON methods.owner_user_id=profiles.user_id AND methods.method='password'
    WHERE profiles.user_id=current_flow.owner_user_id AND profiles.status='active'
      AND profiles.email=provider_email
  ) THEN
    UPDATE public.password_recovery_flows SET
      stage='failed',consumed_at=callback_time,recovery_session_hash=NULL,csrf_hash=NULL,
      completion_lease_hash=NULL,completion_lease_expires_at=NULL
    WHERE password_recovery_flows.flow_hash=current_flow.flow_hash;
    RETURN false;
  END IF;
  UPDATE public.password_recovery_flows SET
    stage='verified',provider_state_ciphertext=protected_provider_state,
    recovery_session_hash=new_recovery_session_hash,csrf_hash=new_csrf_hash,
    browser_expires_at=new_browser_expires_at
  WHERE password_recovery_flows.flow_hash=current_flow.flow_hash;
  RETURN true;
END;
$$;

CREATE FUNCTION read_password_recovery_session(
  presented_recovery_session_hash text,
  new_csrf_hash text,
  read_time timestamptz
) RETURNS TABLE(expires_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE current_flow public.password_recovery_flows%ROWTYPE;
BEGIN
  SELECT * INTO current_flow FROM public.password_recovery_flows AS flows
  WHERE flows.recovery_session_hash=presented_recovery_session_hash FOR UPDATE;
  IF current_flow.flow_hash IS NULL OR current_flow.stage NOT IN ('verified','provider-updated')
    OR current_flow.browser_expires_at <= read_time OR current_flow.expires_at <= read_time
    OR NOT EXISTS (
      SELECT 1 FROM public.user_profiles AS profiles
      JOIN public.account_sign_in_methods AS methods
        ON methods.owner_user_id=profiles.user_id AND methods.method='password'
      WHERE profiles.user_id=current_flow.owner_user_id AND profiles.status='active'
    ) THEN
    IF current_flow.flow_hash IS NOT NULL THEN
      UPDATE public.password_recovery_flows SET
        stage='failed',consumed_at=read_time,recovery_session_hash=NULL,csrf_hash=NULL,
        completion_lease_hash=NULL,completion_lease_expires_at=NULL
      WHERE password_recovery_flows.flow_hash=current_flow.flow_hash;
    END IF;
    RETURN;
  END IF;
  UPDATE public.password_recovery_flows SET csrf_hash=new_csrf_hash
  WHERE password_recovery_flows.flow_hash=current_flow.flow_hash;
  RETURN QUERY SELECT current_flow.browser_expires_at;
END;
$$;

CREATE FUNCTION claim_password_recovery_completion(
  presented_recovery_session_hash text,
  presented_csrf_hash text,
  new_lease_hash text,
  new_lease_expires_at timestamptz,
  claim_time timestamptz
) RETURNS TABLE(
  flow_hash text,stage text,provider_state_ciphertext text,callback_flow_ciphertext text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE current_flow public.password_recovery_flows%ROWTYPE;
BEGIN
  SELECT * INTO current_flow FROM public.password_recovery_flows AS flows
  WHERE flows.recovery_session_hash=presented_recovery_session_hash FOR UPDATE;
  IF current_flow.flow_hash IS NULL OR current_flow.stage NOT IN ('verified','provider-updated')
    OR current_flow.csrf_hash <> presented_csrf_hash
    OR current_flow.browser_expires_at <= claim_time OR current_flow.expires_at <= claim_time
    OR (current_flow.completion_lease_expires_at IS NOT NULL
      AND current_flow.completion_lease_expires_at > claim_time)
    OR NOT EXISTS (
      SELECT 1 FROM public.user_profiles AS profiles
      JOIN public.account_sign_in_methods AS methods
        ON methods.owner_user_id=profiles.user_id AND methods.method='password'
      WHERE profiles.user_id=current_flow.owner_user_id AND profiles.status='active'
    ) THEN RETURN; END IF;
  UPDATE public.password_recovery_flows SET
    completion_lease_hash=new_lease_hash,completion_lease_expires_at=new_lease_expires_at
  WHERE password_recovery_flows.flow_hash=current_flow.flow_hash;
  RETURN QUERY SELECT current_flow.flow_hash,current_flow.stage,
    current_flow.provider_state_ciphertext,current_flow.callback_flow_ciphertext;
END;
$$;

CREATE FUNCTION save_password_recovery_provider_updated(
  recovery_flow_hash text,
  presented_lease_hash text,
  provider_user_id uuid,
  protected_provider_state text,
  saved_at timestamptz
) RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
  UPDATE public.password_recovery_flows AS flows SET
    stage='provider-updated',provider_state_ciphertext=protected_provider_state
  WHERE flows.flow_hash=recovery_flow_hash AND flows.stage='verified'
    AND flows.owner_user_id=provider_user_id
    AND flows.completion_lease_hash=presented_lease_hash
    AND flows.completion_lease_expires_at > saved_at
    AND EXISTS (
      SELECT 1 FROM public.user_profiles AS profiles
      JOIN public.account_sign_in_methods AS methods
        ON methods.owner_user_id=profiles.user_id AND methods.method='password'
      WHERE profiles.user_id=flows.owner_user_id AND profiles.status='active'
    )
  RETURNING true;
$$;

CREATE FUNCTION complete_password_recovery(
  recovery_flow_hash text,
  presented_lease_hash text,
  notification_id uuid,
  completed_at timestamptz
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE current_flow public.password_recovery_flows%ROWTYPE;
BEGIN
  SELECT * INTO current_flow FROM public.password_recovery_flows AS flows
  WHERE flows.flow_hash=recovery_flow_hash AND flows.stage='provider-updated'
    AND flows.completion_lease_hash=presented_lease_hash
    AND flows.completion_lease_expires_at > completed_at FOR UPDATE;
  IF current_flow.flow_hash IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.user_profiles AS profiles
    JOIN public.account_sign_in_methods AS methods
      ON methods.owner_user_id=profiles.user_id AND methods.method='password'
    WHERE profiles.user_id=current_flow.owner_user_id AND profiles.status='active'
  ) THEN RETURN false; END IF;
  UPDATE public.password_recovery_flows SET
    stage='completed',consumed_at=completed_at,recovery_session_hash=NULL,csrf_hash=NULL,
    completion_lease_hash=NULL,completion_lease_expires_at=NULL
  WHERE password_recovery_flows.flow_hash=current_flow.flow_hash;
  UPDATE public.web_sessions SET revoked_at=completed_at
  WHERE owner_user_id=current_flow.owner_user_id AND revoked_at IS NULL;
  UPDATE public.extension_sessions SET revoked_at=completed_at
  WHERE owner_user_id=current_flow.owner_user_id AND revoked_at IS NULL;
  INSERT INTO public.security_notification_outbox(id,owner_user_id,kind,available_at,created_at)
  VALUES (notification_id,current_flow.owner_user_id,'password-reset-completed',completed_at,completed_at);
  RETURN true;
END;
$$;

CREATE FUNCTION claim_security_notification(
  new_lease_hash text,
  new_lease_expires_at timestamptz,
  claim_time timestamptz
) RETURNS TABLE(notification_id uuid,email text,attempt_count integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
  IF new_lease_expires_at <= claim_time THEN
    RAISE EXCEPTION 'invalid notification lease';
  END IF;
  RETURN QUERY
  WITH candidate AS (
    SELECT notifications.id,profiles.email
    FROM public.security_notification_outbox AS notifications
    JOIN public.user_profiles AS profiles ON profiles.user_id=notifications.owner_user_id
    WHERE profiles.status IN ('active','disabled') AND (
      (notifications.status='pending' AND notifications.available_at<=claim_time)
      OR (notifications.status='sending' AND notifications.lease_expires_at<=claim_time)
    )
    ORDER BY notifications.available_at,notifications.created_at,notifications.id
    FOR UPDATE OF notifications SKIP LOCKED LIMIT 1
  )
  UPDATE public.security_notification_outbox AS notifications SET
    status='sending',attempt_count=notifications.attempt_count+1,
    lease_hash=new_lease_hash,lease_expires_at=new_lease_expires_at
  FROM candidate WHERE notifications.id=candidate.id
  RETURNING notifications.id,candidate.email,notifications.attempt_count;
END;
$$;

CREATE FUNCTION complete_security_notification(
  selected_notification_id uuid,
  presented_lease_hash text,
  completed_at timestamptz
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE saved boolean;
BEGIN
  UPDATE public.security_notification_outbox AS notifications SET
    status='sent',lease_hash=NULL,lease_expires_at=NULL,sent_at=completed_at
  WHERE notifications.id=selected_notification_id AND notifications.status='sending'
    AND notifications.lease_hash=presented_lease_hash
    AND notifications.lease_expires_at>completed_at
  RETURNING true INTO saved;
  RETURN COALESCE(saved,false);
END;
$$;

CREATE FUNCTION retry_security_notification(
  selected_notification_id uuid,
  presented_lease_hash text,
  retry_available_at timestamptz,
  failed_at timestamptz
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE saved boolean;
BEGIN
  IF retry_available_at<=failed_at THEN RAISE EXCEPTION 'invalid notification retry'; END IF;
  UPDATE public.security_notification_outbox AS notifications SET
    status='pending',available_at=retry_available_at,lease_hash=NULL,lease_expires_at=NULL
  WHERE notifications.id=selected_notification_id AND notifications.status='sending'
    AND notifications.lease_hash=presented_lease_hash
    AND notifications.lease_expires_at>failed_at
  RETURNING true INTO saved;
  RETURN COALESCE(saved,false);
END;
$$;

CREATE FUNCTION cleanup_password_recovery_flows(
  cleanup_limit integer,
  cleanup_time timestamptz
) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE deleted_count integer;
BEGIN
  IF cleanup_limit < 1 OR cleanup_limit > 100 THEN RAISE EXCEPTION 'invalid cleanup limit'; END IF;
  UPDATE public.password_recovery_flows SET
    stage='failed',consumed_at=cleanup_time,recovery_session_hash=NULL,csrf_hash=NULL,
    dispatch_lease_hash=NULL,dispatch_lease_expires_at=NULL,
    completion_lease_hash=NULL,completion_lease_expires_at=NULL
  WHERE stage NOT IN ('completed','failed') AND (
    expires_at <= cleanup_time OR browser_expires_at <= cleanup_time
    OR (stage='requested' AND dispatch_at IS NOT NULL
      AND dispatch_lease_expires_at <= cleanup_time)
  );
  WITH doomed AS (
    SELECT flows.flow_hash FROM public.password_recovery_flows AS flows
    WHERE flows.stage IN ('completed','failed')
      AND flows.consumed_at <= cleanup_time-interval '24 hours'
    ORDER BY flows.consumed_at,flows.flow_hash LIMIT cleanup_limit
  ) DELETE FROM public.password_recovery_flows AS flows
    USING doomed WHERE flows.flow_hash=doomed.flow_hash;
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

REVOKE ALL ON FUNCTION claim_invitation(text, text, timestamptz) FROM PUBLIC, huayi_business;
REVOKE ALL ON FUNCTION require_claim_ticket(text) FROM PUBLIC, huayi_business;
REVOKE ALL ON FUNCTION create_auth_flow(text, text, timestamptz) FROM PUBLIC, huayi_business;
REVOKE ALL ON FUNCTION create_login_auth_flow(text, timestamptz) FROM PUBLIC, huayi_business;
REVOKE ALL ON FUNCTION consume_auth_flow(text) FROM PUBLIC, huayi_business;
REVOKE ALL ON FUNCTION save_auth_flow_state(text, text) FROM PUBLIC, huayi_business;
REVOKE ALL ON FUNCTION read_auth_flow_state(text) FROM PUBLIC, huayi_business;
REVOKE ALL ON FUNCTION create_google_reauthentication(text,text,text,timestamptz)
  FROM PUBLIC, huayi_business;
REVOKE ALL ON FUNCTION continue_google_reauthentication(text,text)
  FROM PUBLIC, huayi_business;
REVOKE ALL ON FUNCTION complete_google_reauthentication(
  text,text,uuid,uuid,text,text,text,timestamptz
) FROM PUBLIC, huayi_business;
REVOKE ALL ON FUNCTION create_google_link(text,text,text,timestamptz)
  FROM PUBLIC, huayi_business;
REVOKE ALL ON FUNCTION claim_google_link_continuation(text,text,text,timestamptz)
  FROM PUBLIC, huayi_business;
REVOKE ALL ON FUNCTION save_google_link_refresh(text,text,text,uuid,text,text)
  FROM PUBLIC, huayi_business;
REVOKE ALL ON FUNCTION save_google_link_provider_started(text,text,text,text)
  FROM PUBLIC, huayi_business;
REVOKE ALL ON FUNCTION read_google_link_state(text,text) FROM PUBLIC, huayi_business;
REVOKE ALL ON FUNCTION complete_google_link(text,text,uuid,uuid,text,text,text,timestamptz)
  FROM PUBLIC, huayi_business;
REVOKE ALL ON FUNCTION claim_password_link(text,text,text,text,timestamptz,timestamptz)
  FROM PUBLIC, huayi_business;
REVOKE ALL ON FUNCTION save_password_link_refresh(text,text,text,uuid,text,text)
  FROM PUBLIC, huayi_business;
REVOKE ALL ON FUNCTION save_password_link_provider_updated(text,text,text,uuid)
  FROM PUBLIC, huayi_business;
REVOKE ALL ON FUNCTION complete_password_link(text,text,text,uuid,text,text,timestamptz)
  FROM PUBLIC, huayi_business;
REVOKE ALL ON FUNCTION bind_auth_identity(text, uuid) FROM PUBLIC, huayi_business;
REVOKE ALL ON FUNCTION complete_auth_flow(text, uuid, text, text, integer)
  FROM PUBLIC, huayi_business;
REVOKE ALL ON FUNCTION authorize_sign_in_method(uuid, text) FROM PUBLIC, huayi_business;
REVOKE ALL ON FUNCTION create_web_session(uuid, uuid, text, text, text, timestamptz)
  FROM PUBLIC, huayi_business;
REVOKE ALL ON FUNCTION authenticate_web_session(text) FROM PUBLIC, huayi_business;
REVOKE ALL ON FUNCTION prepare_password_reauthentication(text) FROM PUBLIC, huayi_business;
REVOKE ALL ON FUNCTION require_recent_authentication(text,text) FROM PUBLIC, huayi_business;
REVOKE ALL ON FUNCTION rotate_password_reauthenticated_session(
  text, uuid, uuid, text, text, text, timestamptz
) FROM PUBLIC, huayi_business;
REVOKE ALL ON FUNCTION authenticate_data_rights_session(text) FROM PUBLIC, huayi_business;
REVOKE ALL ON FUNCTION revoke_web_session(text) FROM PUBLIC, huayi_business;
REVOKE ALL ON FUNCTION rotate_web_csrf(text, text) FROM PUBLIC, huayi_business;
REVOKE ALL ON FUNCTION consume_rate_limit(text, text, timestamptz, integer)
  FROM PUBLIC, huayi_business;
REVOKE ALL ON FUNCTION require_admin_operator(uuid) FROM PUBLIC, huayi_business;
REVOKE ALL ON FUNCTION admin_create_invitation(uuid, text, timestamptz, uuid, uuid)
  FROM PUBLIC, huayi_business;
REVOKE ALL ON FUNCTION admin_set_quota(uuid, uuid, uuid, timestamptz, timestamptz, bigint, uuid)
  FROM PUBLIC, huayi_business;
REVOKE ALL ON FUNCTION admin_set_user_status(uuid, uuid, text, uuid)
  FROM PUBLIC, huayi_business;
REVOKE ALL ON FUNCTION admin_revoke_devices(uuid, uuid, uuid)
  FROM PUBLIC, huayi_business;
REVOKE ALL ON FUNCTION admin_list_users(
  uuid, text, text, timestamptz, uuid, integer, timestamptz, timestamptz
) FROM PUBLIC, huayi_business;
REVOKE ALL ON FUNCTION admin_list_invitations(uuid, timestamptz, uuid, integer)
  FROM PUBLIC, huayi_business;
REVOKE ALL ON FUNCTION admin_list_audit_events(uuid, text, timestamptz, uuid, integer)
  FROM PUBLIC, huayi_business;
REVOKE ALL ON FUNCTION admin_usage_summary(uuid, timestamptz, timestamptz)
  FROM PUBLIC, huayi_business;
REVOKE ALL ON FUNCTION admin_execute(
  uuid, text, text, text, uuid, jsonb, text, timestamptz, timestamptz, uuid, uuid
) FROM PUBLIC, huayi_business;
REVOKE ALL ON FUNCTION replace_quota_grant(uuid, uuid, timestamptz, timestamptz, bigint, text)
  FROM PUBLIC, huayi_business;
REVOKE ALL ON FUNCTION finalize_invitation(text, uuid, text, text, integer, text)
  FROM PUBLIC, huayi_business;
REVOKE ALL ON FUNCTION create_extension_pairing(uuid, text, text, text, timestamptz)
  FROM PUBLIC, huayi_business;
REVOKE ALL ON FUNCTION approve_extension_pairing(uuid,uuid,text,integer,text,text,text)
  FROM PUBLIC, huayi_business;
REVOKE ALL ON FUNCTION get_extension_pairing(uuid) FROM PUBLIC, huayi_business;
REVOKE ALL ON FUNCTION exchange_extension_pairing(uuid, text, text, uuid, text, timestamptz)
  FROM PUBLIC, huayi_business;
REVOKE ALL ON FUNCTION list_extension_sessions(uuid) FROM PUBLIC, huayi_business;
REVOKE ALL ON FUNCTION authenticate_extension_session(text) FROM PUBLIC, huayi_business;
REVOKE ALL ON FUNCTION revoke_extension_session(uuid, uuid) FROM PUBLIC, huayi_business;
REVOKE ALL ON FUNCTION revoke_current_extension_session(text) FROM PUBLIC, huayi_business;
REVOKE ALL ON FUNCTION release_expired_quota_reservations(uuid) FROM PUBLIC, huayi_business;
REVOKE ALL ON FUNCTION reserve_quota(uuid, uuid, uuid, bigint, timestamptz)
  FROM PUBLIC, huayi_business;
REVOKE ALL ON FUNCTION settle_quota_reservation(
  uuid, uuid[], text, uuid, jsonb, text
) FROM PUBLIC, huayi_business;
REVOKE ALL ON FUNCTION begin_duplicate_suggestion_request(
  uuid,uuid,uuid,uuid,text,text,uuid,integer,jsonb,bigint,text,timestamptz,timestamptz,
  timestamptz,uuid,text,text,bigint,bigint,bigint
) FROM PUBLIC, huayi_business;
REVOKE ALL ON FUNCTION mark_duplicate_suggestion_dispatched(
  uuid,uuid,text,uuid,timestamptz,uuid,text,text,bigint,bigint,bigint
) FROM PUBLIC, huayi_business;
REVOKE ALL ON FUNCTION finish_duplicate_suggestion_request(
  uuid,uuid,text,uuid,uuid,jsonb,jsonb,text,timestamptz
) FROM PUBLIC, huayi_business;
REVOKE ALL ON FUNCTION cleanup_duplicate_suggestion_requests(uuid[],timestamptz)
  FROM PUBLIC, huayi_business;
REVOKE ALL ON FUNCTION require_model_price_version(uuid, text, text, bigint, bigint, bigint)
  FROM PUBLIC, huayi_business;
REVOKE ALL ON FUNCTION begin_analysis_request(uuid, uuid, text, text, integer, text, timestamptz, uuid)
  FROM PUBLIC, huayi_business;
REVOKE ALL ON FUNCTION begin_capture_analysis_request(
  uuid, uuid, integer, text, uuid, text, text, integer, text, timestamptz, uuid
) FROM PUBLIC, huayi_business;
REVOKE ALL ON FUNCTION abandon_analysis_request(uuid, uuid) FROM PUBLIC, huayi_business;
REVOKE ALL ON FUNCTION abandon_extension_query(uuid, uuid, uuid) FROM PUBLIC, huayi_business;
REVOKE ALL ON FUNCTION cleanup_extension_queries(uuid[]) FROM PUBLIC, huayi_business;
REVOKE ALL ON FUNCTION attach_analysis_reservation(uuid, uuid, text, uuid)
  FROM PUBLIC, huayi_business;
REVOKE ALL ON FUNCTION mark_analysis_dispatched(
  uuid, uuid, text, timestamptz, uuid, text, text, bigint, bigint, bigint
) FROM PUBLIC, huayi_business;
REVOKE ALL ON FUNCTION finish_analysis_request(uuid, uuid, text, jsonb)
  FROM PUBLIC, huayi_business;
REVOKE ALL ON FUNCTION require_analysis_lease(uuid, uuid, text) FROM PUBLIC, huayi_business;
REVOKE ALL ON FUNCTION huayi_private.analysis_public_record(uuid) FROM PUBLIC, huayi_business;
REVOKE ALL ON FUNCTION mutate_analysis_record(uuid, text, text, text, uuid, integer, timestamptz, timestamptz)
  FROM PUBLIC, huayi_business;
REVOKE ALL ON FUNCTION delete_analysis_record(
  uuid, text, text, uuid, integer, boolean, timestamptz, timestamptz
) FROM PUBLIC, huayi_business;
REVOKE ALL ON FUNCTION begin_idempotent_write(uuid, text, text, text)
  FROM PUBLIC, huayi_business;
REVOKE ALL ON FUNCTION request_account_deletion(uuid, uuid, text, text, text, text, timestamptz, timestamptz)
  FROM PUBLIC, huayi_business;
REVOKE ALL ON FUNCTION claim_account_export(text, timestamptz) FROM PUBLIC, huayi_business;
REVOKE ALL ON FUNCTION complete_account_export(uuid, text, integer, bigint, text, text, timestamptz) FROM PUBLIC, huayi_business;
REVOKE ALL ON FUNCTION fail_account_export(uuid, text, text) FROM PUBLIC, huayi_business;
REVOKE ALL ON FUNCTION claim_expired_account_export() FROM PUBLIC, huayi_business;
REVOKE ALL ON FUNCTION finish_expired_account_export_cleanup(uuid, text) FROM PUBLIC, huayi_business;
REVOKE ALL ON FUNCTION fail_expired_account_export_cleanup(uuid, text) FROM PUBLIC, huayi_business;
REVOKE ALL ON FUNCTION claim_account_deletion(text, timestamptz) FROM PUBLIC, huayi_business;
REVOKE ALL ON FUNCTION advance_account_deletion(uuid, text, text, text) FROM PUBLIC, huayi_business;
REVOKE ALL ON FUNCTION complete_account_deletion(uuid, text) FROM PUBLIC, huayi_business;
REVOKE ALL ON FUNCTION fail_account_deletion(uuid, text, text) FROM PUBLIC, huayi_business;
REVOKE ALL ON FUNCTION request_password_recovery(text,text,text,timestamptz,timestamptz)
  FROM PUBLIC, huayi_business;
REVOKE ALL ON FUNCTION claim_password_recovery_dispatch(text,timestamptz,timestamptz)
  FROM PUBLIC, huayi_business;
REVOKE ALL ON FUNCTION mark_password_recovery_dispatched(text,text,timestamptz)
  FROM PUBLIC, huayi_business;
REVOKE ALL ON FUNCTION save_password_recovery_sent(text,text,text,timestamptz)
  FROM PUBLIC, huayi_business;
REVOKE ALL ON FUNCTION fail_password_recovery_dispatch(text,text,timestamptz)
  FROM PUBLIC, huayi_business;
REVOKE ALL ON FUNCTION read_password_recovery_state(text,timestamptz)
  FROM PUBLIC, huayi_business;
REVOKE ALL ON FUNCTION complete_password_recovery_callback(
  text,uuid,text,text,text,text,timestamptz,timestamptz
) FROM PUBLIC, huayi_business;
REVOKE ALL ON FUNCTION read_password_recovery_session(text,text,timestamptz)
  FROM PUBLIC, huayi_business;
REVOKE ALL ON FUNCTION claim_password_recovery_completion(
  text,text,text,timestamptz,timestamptz
) FROM PUBLIC, huayi_business;
REVOKE ALL ON FUNCTION save_password_recovery_provider_updated(
  text,text,uuid,text,timestamptz
) FROM PUBLIC, huayi_business;
REVOKE ALL ON FUNCTION complete_password_recovery(text,text,uuid,timestamptz)
  FROM PUBLIC, huayi_business;
REVOKE ALL ON FUNCTION claim_security_notification(text,timestamptz,timestamptz)
  FROM PUBLIC, huayi_business;
REVOKE ALL ON FUNCTION complete_security_notification(uuid,text,timestamptz)
  FROM PUBLIC, huayi_business;
REVOKE ALL ON FUNCTION retry_security_notification(uuid,text,timestamptz,timestamptz)
  FROM PUBLIC, huayi_business;
REVOKE ALL ON FUNCTION cleanup_password_recovery_flows(integer,timestamptz)
  FROM PUBLIC, huayi_business;
GRANT EXECUTE ON FUNCTION claim_invitation(text, text, timestamptz) TO huayi_context_setter;
GRANT EXECUTE ON FUNCTION require_claim_ticket(text) TO huayi_context_setter;
GRANT EXECUTE ON FUNCTION create_auth_flow(text, text, timestamptz) TO huayi_context_setter;
GRANT EXECUTE ON FUNCTION create_login_auth_flow(text, timestamptz) TO huayi_context_setter;
GRANT EXECUTE ON FUNCTION consume_auth_flow(text) TO huayi_context_setter;
GRANT EXECUTE ON FUNCTION save_auth_flow_state(text, text) TO huayi_context_setter;
GRANT EXECUTE ON FUNCTION read_auth_flow_state(text) TO huayi_context_setter;
GRANT EXECUTE ON FUNCTION create_google_reauthentication(text,text,text,timestamptz)
  TO huayi_context_setter;
GRANT EXECUTE ON FUNCTION continue_google_reauthentication(text,text)
  TO huayi_context_setter;
GRANT EXECUTE ON FUNCTION complete_google_reauthentication(
  text,text,uuid,uuid,text,text,text,timestamptz
) TO huayi_context_setter;
GRANT EXECUTE ON FUNCTION create_google_link(text,text,text,timestamptz)
  TO huayi_context_setter;
GRANT EXECUTE ON FUNCTION claim_google_link_continuation(text,text,text,timestamptz)
  TO huayi_context_setter;
GRANT EXECUTE ON FUNCTION save_google_link_refresh(text,text,text,uuid,text,text)
  TO huayi_context_setter;
GRANT EXECUTE ON FUNCTION save_google_link_provider_started(text,text,text,text)
  TO huayi_context_setter;
GRANT EXECUTE ON FUNCTION read_google_link_state(text,text) TO huayi_context_setter;
GRANT EXECUTE ON FUNCTION complete_google_link(text,text,uuid,uuid,text,text,text,timestamptz)
  TO huayi_context_setter;
GRANT EXECUTE ON FUNCTION claim_password_link(text,text,text,text,timestamptz,timestamptz)
  TO huayi_context_setter;
GRANT EXECUTE ON FUNCTION save_password_link_refresh(text,text,text,uuid,text,text)
  TO huayi_context_setter;
GRANT EXECUTE ON FUNCTION save_password_link_provider_updated(text,text,text,uuid)
  TO huayi_context_setter;
GRANT EXECUTE ON FUNCTION complete_password_link(text,text,text,uuid,text,text,timestamptz)
  TO huayi_context_setter;
GRANT EXECUTE ON FUNCTION bind_auth_identity(text, uuid) TO huayi_context_setter;
GRANT EXECUTE ON FUNCTION complete_auth_flow(text, uuid, text, text, integer)
  TO huayi_context_setter;
GRANT EXECUTE ON FUNCTION authorize_sign_in_method(uuid, text) TO huayi_context_setter;
GRANT EXECUTE ON FUNCTION create_web_session(uuid, uuid, text, text, text, timestamptz)
  TO huayi_context_setter;
GRANT EXECUTE ON FUNCTION authenticate_web_session(text) TO huayi_context_setter;
GRANT EXECUTE ON FUNCTION prepare_password_reauthentication(text) TO huayi_context_setter;
GRANT EXECUTE ON FUNCTION require_recent_authentication(text,text) TO huayi_context_setter;
GRANT EXECUTE ON FUNCTION rotate_password_reauthenticated_session(
  text, uuid, uuid, text, text, text, timestamptz
) TO huayi_context_setter;
GRANT EXECUTE ON FUNCTION authenticate_data_rights_session(text) TO huayi_context_setter;
GRANT EXECUTE ON FUNCTION revoke_web_session(text) TO huayi_context_setter;
GRANT EXECUTE ON FUNCTION rotate_web_csrf(text, text) TO huayi_context_setter;
GRANT EXECUTE ON FUNCTION consume_rate_limit(text, text, timestamptz, integer)
  TO huayi_context_setter;
GRANT EXECUTE ON FUNCTION require_admin_operator(uuid) TO huayi_context_setter;
GRANT EXECUTE ON FUNCTION admin_list_users(
  uuid, text, text, timestamptz, uuid, integer, timestamptz, timestamptz
) TO huayi_context_setter;
GRANT EXECUTE ON FUNCTION admin_list_invitations(uuid, timestamptz, uuid, integer)
  TO huayi_context_setter;
GRANT EXECUTE ON FUNCTION admin_list_audit_events(uuid, text, timestamptz, uuid, integer)
  TO huayi_context_setter;
GRANT EXECUTE ON FUNCTION admin_usage_summary(uuid, timestamptz, timestamptz)
  TO huayi_context_setter;
GRANT EXECUTE ON FUNCTION admin_execute(
  uuid, text, text, text, uuid, jsonb, text, timestamptz, timestamptz, uuid, uuid
) TO huayi_context_setter;
GRANT EXECUTE ON FUNCTION replace_quota_grant(uuid, uuid, timestamptz, timestamptz, bigint, text)
  TO huayi_context_setter;
GRANT EXECUTE ON FUNCTION finalize_invitation(text, uuid, text, text, integer, text)
  TO huayi_context_setter;
GRANT EXECUTE ON FUNCTION create_extension_pairing(uuid, text, text, text, timestamptz)
  TO huayi_context_setter;
GRANT EXECUTE ON FUNCTION approve_extension_pairing(uuid,uuid,text,integer,text,text,text)
  TO huayi_context_setter;
GRANT EXECUTE ON FUNCTION get_extension_pairing(uuid) TO huayi_context_setter;
GRANT EXECUTE ON FUNCTION exchange_extension_pairing(uuid, text, text, uuid, text, timestamptz)
  TO huayi_context_setter;
GRANT EXECUTE ON FUNCTION list_extension_sessions(uuid) TO huayi_context_setter;
GRANT EXECUTE ON FUNCTION authenticate_extension_session(text) TO huayi_context_setter;
GRANT EXECUTE ON FUNCTION revoke_extension_session(uuid, uuid) TO huayi_context_setter;
GRANT EXECUTE ON FUNCTION revoke_current_extension_session(text) TO huayi_context_setter;
GRANT EXECUTE ON FUNCTION release_expired_quota_reservations(uuid) TO huayi_context_setter;
GRANT EXECUTE ON FUNCTION reserve_quota(uuid, uuid, uuid, bigint, timestamptz)
  TO huayi_context_setter;
GRANT EXECUTE ON FUNCTION settle_quota_reservation(
  uuid, uuid[], text, uuid, jsonb, text
) TO huayi_context_setter;
GRANT EXECUTE ON FUNCTION begin_duplicate_suggestion_request(
  uuid,uuid,uuid,uuid,text,text,uuid,integer,jsonb,bigint,text,timestamptz,timestamptz,
  timestamptz,uuid,text,text,bigint,bigint,bigint
) TO huayi_context_setter;
GRANT EXECUTE ON FUNCTION mark_duplicate_suggestion_dispatched(
  uuid,uuid,text,uuid,timestamptz,uuid,text,text,bigint,bigint,bigint
) TO huayi_context_setter;
GRANT EXECUTE ON FUNCTION finish_duplicate_suggestion_request(
  uuid,uuid,text,uuid,uuid,jsonb,jsonb,text,timestamptz
) TO huayi_context_setter;
GRANT EXECUTE ON FUNCTION cleanup_duplicate_suggestion_requests(uuid[],timestamptz)
  TO huayi_context_setter;
GRANT EXECUTE ON FUNCTION require_model_price_version(uuid, text, text, bigint, bigint, bigint)
  TO huayi_context_setter;
GRANT EXECUTE ON FUNCTION begin_analysis_request(uuid, uuid, text, text, integer, text, timestamptz, uuid)
  TO huayi_context_setter;
GRANT EXECUTE ON FUNCTION begin_capture_analysis_request(
  uuid, uuid, integer, text, uuid, text, text, integer, text, timestamptz, uuid
) TO huayi_context_setter;
GRANT EXECUTE ON FUNCTION abandon_analysis_request(uuid, uuid) TO huayi_context_setter;
GRANT EXECUTE ON FUNCTION abandon_extension_query(uuid, uuid, uuid) TO huayi_context_setter;
GRANT EXECUTE ON FUNCTION cleanup_extension_queries(uuid[]) TO huayi_context_setter;
GRANT EXECUTE ON FUNCTION attach_analysis_reservation(uuid, uuid, text, uuid)
  TO huayi_context_setter;
GRANT EXECUTE ON FUNCTION mark_analysis_dispatched(
  uuid, uuid, text, timestamptz, uuid, text, text, bigint, bigint, bigint
) TO huayi_context_setter;
GRANT EXECUTE ON FUNCTION finish_analysis_request(uuid, uuid, text, jsonb)
  TO huayi_context_setter;
GRANT EXECUTE ON FUNCTION require_analysis_lease(uuid, uuid, text) TO huayi_context_setter;
GRANT EXECUTE ON FUNCTION mutate_analysis_record(uuid, text, text, text, uuid, integer, timestamptz, timestamptz)
  TO huayi_context_setter;
GRANT EXECUTE ON FUNCTION delete_analysis_record(
  uuid, text, text, uuid, integer, boolean, timestamptz, timestamptz
) TO huayi_context_setter;
GRANT EXECUTE ON FUNCTION begin_idempotent_write(uuid, text, text, text)
  TO huayi_context_setter;
GRANT EXECUTE ON FUNCTION request_account_deletion(uuid, uuid, text, text, text, text, timestamptz, timestamptz)
  TO huayi_context_setter;
GRANT EXECUTE ON FUNCTION claim_account_export(text, timestamptz) TO huayi_context_setter;
GRANT EXECUTE ON FUNCTION complete_account_export(uuid, text, integer, bigint, text, text, timestamptz) TO huayi_context_setter;
GRANT EXECUTE ON FUNCTION fail_account_export(uuid, text, text) TO huayi_context_setter;
GRANT EXECUTE ON FUNCTION claim_expired_account_export() TO huayi_context_setter;
GRANT EXECUTE ON FUNCTION finish_expired_account_export_cleanup(uuid, text) TO huayi_context_setter;
GRANT EXECUTE ON FUNCTION fail_expired_account_export_cleanup(uuid, text) TO huayi_context_setter;
GRANT EXECUTE ON FUNCTION claim_account_deletion(text, timestamptz) TO huayi_context_setter;
GRANT EXECUTE ON FUNCTION advance_account_deletion(uuid, text, text, text) TO huayi_context_setter;
GRANT EXECUTE ON FUNCTION complete_account_deletion(uuid, text) TO huayi_context_setter;
GRANT EXECUTE ON FUNCTION fail_account_deletion(uuid, text, text) TO huayi_context_setter;
GRANT EXECUTE ON FUNCTION request_password_recovery(text,text,text,timestamptz,timestamptz)
  TO huayi_context_setter;
GRANT EXECUTE ON FUNCTION claim_password_recovery_dispatch(text,timestamptz,timestamptz)
  TO huayi_context_setter;
GRANT EXECUTE ON FUNCTION mark_password_recovery_dispatched(text,text,timestamptz)
  TO huayi_context_setter;
GRANT EXECUTE ON FUNCTION save_password_recovery_sent(text,text,text,timestamptz)
  TO huayi_context_setter;
GRANT EXECUTE ON FUNCTION fail_password_recovery_dispatch(text,text,timestamptz)
  TO huayi_context_setter;
GRANT EXECUTE ON FUNCTION read_password_recovery_state(text,timestamptz)
  TO huayi_context_setter;
GRANT EXECUTE ON FUNCTION complete_password_recovery_callback(
  text,uuid,text,text,text,text,timestamptz,timestamptz
) TO huayi_context_setter;
GRANT EXECUTE ON FUNCTION read_password_recovery_session(text,text,timestamptz)
  TO huayi_context_setter;
GRANT EXECUTE ON FUNCTION claim_password_recovery_completion(
  text,text,text,timestamptz,timestamptz
) TO huayi_context_setter;
GRANT EXECUTE ON FUNCTION save_password_recovery_provider_updated(
  text,text,uuid,text,timestamptz
) TO huayi_context_setter;
GRANT EXECUTE ON FUNCTION complete_password_recovery(text,text,uuid,timestamptz)
  TO huayi_context_setter;
GRANT EXECUTE ON FUNCTION claim_security_notification(text,timestamptz,timestamptz)
  TO huayi_context_setter;
GRANT EXECUTE ON FUNCTION complete_security_notification(uuid,text,timestamptz)
  TO huayi_context_setter;
GRANT EXECUTE ON FUNCTION retry_security_notification(uuid,text,timestamptz,timestamptz)
  TO huayi_context_setter;
GRANT EXECUTE ON FUNCTION cleanup_password_recovery_flows(integer,timestamptz)
  TO huayi_context_setter;

ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_profiles FORCE ROW LEVEL SECURITY;
CREATE POLICY user_profiles_owner ON user_profiles USING (owner_user_id = huayi_private.current_owner_user_id()) WITH CHECK (owner_user_id = huayi_private.current_owner_user_id());
ALTER TABLE account_sign_in_methods ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_sign_in_methods FORCE ROW LEVEL SECURITY;
CREATE POLICY account_sign_in_methods_owner ON account_sign_in_methods USING (owner_user_id = huayi_private.current_owner_user_id()) WITH CHECK (owner_user_id = huayi_private.current_owner_user_id());
ALTER TABLE password_recovery_flows ENABLE ROW LEVEL SECURITY;
ALTER TABLE password_recovery_flows FORCE ROW LEVEL SECURITY;
CREATE POLICY password_recovery_flows_owner ON password_recovery_flows USING (owner_user_id = huayi_private.current_owner_user_id()) WITH CHECK (owner_user_id = huayi_private.current_owner_user_id());
ALTER TABLE security_notification_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE security_notification_outbox FORCE ROW LEVEL SECURITY;
CREATE POLICY security_notification_outbox_owner ON security_notification_outbox USING (owner_user_id = huayi_private.current_owner_user_id()) WITH CHECK (owner_user_id = huayi_private.current_owner_user_id());
ALTER TABLE web_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE web_sessions FORCE ROW LEVEL SECURITY;
CREATE POLICY web_sessions_owner ON web_sessions USING (owner_user_id = huayi_private.current_owner_user_id()) WITH CHECK (owner_user_id = huayi_private.current_owner_user_id());
ALTER TABLE account_data_export_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_data_export_jobs FORCE ROW LEVEL SECURITY;
CREATE POLICY account_data_export_jobs_owner ON account_data_export_jobs USING (owner_user_id = huayi_private.current_owner_user_id()) WITH CHECK (owner_user_id = huayi_private.current_owner_user_id());
ALTER TABLE extension_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE extension_sessions FORCE ROW LEVEL SECURITY;
CREATE POLICY extension_sessions_owner ON extension_sessions USING (owner_user_id = huayi_private.current_owner_user_id()) WITH CHECK (owner_user_id = huayi_private.current_owner_user_id());
ALTER TABLE extension_pairings ENABLE ROW LEVEL SECURITY;
ALTER TABLE extension_pairings FORCE ROW LEVEL SECURITY;
CREATE POLICY extension_pairings_owner ON extension_pairings USING (owner_user_id = huayi_private.current_owner_user_id()) WITH CHECK (owner_user_id = huayi_private.current_owner_user_id());
ALTER TABLE study_captures ENABLE ROW LEVEL SECURITY;
ALTER TABLE study_captures FORCE ROW LEVEL SECURITY;
CREATE POLICY study_captures_owner ON study_captures USING (owner_user_id = huayi_private.current_owner_user_id()) WITH CHECK (owner_user_id = huayi_private.current_owner_user_id());
ALTER TABLE analysis_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE analysis_records FORCE ROW LEVEL SECURITY;
CREATE POLICY analysis_records_owner ON analysis_records USING (owner_user_id = huayi_private.current_owner_user_id()) WITH CHECK (owner_user_id = huayi_private.current_owner_user_id());
ALTER TABLE analysis_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE analysis_candidates FORCE ROW LEVEL SECURITY;
CREATE POLICY analysis_candidates_owner ON analysis_candidates USING (owner_user_id = huayi_private.current_owner_user_id()) WITH CHECK (owner_user_id = huayi_private.current_owner_user_id());
ALTER TABLE idempotency_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE idempotency_records FORCE ROW LEVEL SECURITY;
CREATE POLICY idempotency_records_owner ON idempotency_records USING (owner_user_id = huayi_private.current_owner_user_id()) WITH CHECK (owner_user_id = huayi_private.current_owner_user_id());
ALTER TABLE analysis_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE analysis_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY analysis_requests_owner ON analysis_requests USING (owner_user_id = huayi_private.current_owner_user_id()) WITH CHECK (owner_user_id = huayi_private.current_owner_user_id());
ALTER TABLE extension_query_generations ENABLE ROW LEVEL SECURITY;
ALTER TABLE extension_query_generations FORCE ROW LEVEL SECURITY;
CREATE POLICY extension_query_generations_owner ON extension_query_generations USING (owner_user_id = huayi_private.current_owner_user_id()) WITH CHECK (owner_user_id = huayi_private.current_owner_user_id());
ALTER TABLE learning_duplicate_suggestion_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE learning_duplicate_suggestion_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY learning_duplicate_suggestion_requests_owner ON learning_duplicate_suggestion_requests USING (owner_user_id = huayi_private.current_owner_user_id()) WITH CHECK (owner_user_id = huayi_private.current_owner_user_id());
ALTER TABLE learning_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE learning_items FORCE ROW LEVEL SECURITY;
CREATE POLICY learning_items_owner ON learning_items USING (owner_user_id = huayi_private.current_owner_user_id()) WITH CHECK (owner_user_id = huayi_private.current_owner_user_id());
ALTER TABLE source_examples ENABLE ROW LEVEL SECURITY;
ALTER TABLE source_examples FORCE ROW LEVEL SECURITY;
CREATE POLICY source_examples_owner ON source_examples USING (owner_user_id = huayi_private.current_owner_user_id()) WITH CHECK (owner_user_id = huayi_private.current_owner_user_id());
ALTER TABLE tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE tags FORCE ROW LEVEL SECURITY;
CREATE POLICY tags_owner ON tags USING (owner_user_id = huayi_private.current_owner_user_id()) WITH CHECK (owner_user_id = huayi_private.current_owner_user_id());
ALTER TABLE learning_item_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE learning_item_tags FORCE ROW LEVEL SECURITY;
CREATE POLICY learning_item_tags_owner ON learning_item_tags USING (owner_user_id = huayi_private.current_owner_user_id()) WITH CHECK (owner_user_id = huayi_private.current_owner_user_id());
ALTER TABLE schedule_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE schedule_states FORCE ROW LEVEL SECURITY;
CREATE POLICY schedule_states_owner ON schedule_states USING (owner_user_id = huayi_private.current_owner_user_id()) WITH CHECK (owner_user_id = huayi_private.current_owner_user_id());
ALTER TABLE word_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE word_entries FORCE ROW LEVEL SECURITY;
CREATE POLICY word_entries_owner ON word_entries USING (owner_user_id = huayi_private.current_owner_user_id()) WITH CHECK (owner_user_id = huayi_private.current_owner_user_id());
ALTER TABLE context_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE context_observations FORCE ROW LEVEL SECURITY;
CREATE POLICY context_observations_owner ON context_observations USING (owner_user_id = huayi_private.current_owner_user_id()) WITH CHECK (owner_user_id = huayi_private.current_owner_user_id());
ALTER TABLE external_wordbook_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE external_wordbook_jobs FORCE ROW LEVEL SECURITY;
CREATE POLICY external_wordbook_jobs_owner ON external_wordbook_jobs USING (owner_user_id = huayi_private.current_owner_user_id()) WITH CHECK (owner_user_id = huayi_private.current_owner_user_id());
ALTER TABLE external_wordbook_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE external_wordbook_items FORCE ROW LEVEL SECURITY;
CREATE POLICY external_wordbook_items_owner ON external_wordbook_items USING (owner_user_id = huayi_private.current_owner_user_id()) WITH CHECK (owner_user_id = huayi_private.current_owner_user_id());
ALTER TABLE practice_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE practice_sessions FORCE ROW LEVEL SECURITY;
CREATE POLICY practice_sessions_owner ON practice_sessions USING (owner_user_id = huayi_private.current_owner_user_id()) WITH CHECK (owner_user_id = huayi_private.current_owner_user_id());
ALTER TABLE practice_session_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE practice_session_items FORCE ROW LEVEL SECURITY;
CREATE POLICY practice_session_items_owner ON practice_session_items USING (owner_user_id = huayi_private.current_owner_user_id()) WITH CHECK (owner_user_id = huayi_private.current_owner_user_id());
ALTER TABLE practice_turns ENABLE ROW LEVEL SECURITY;
ALTER TABLE practice_turns FORCE ROW LEVEL SECURITY;
CREATE POLICY practice_turns_owner ON practice_turns USING (owner_user_id = huayi_private.current_owner_user_id()) WITH CHECK (owner_user_id = huayi_private.current_owner_user_id());
ALTER TABLE practice_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE practice_attempts FORCE ROW LEVEL SECURITY;
CREATE POLICY practice_attempts_owner ON practice_attempts USING (owner_user_id = huayi_private.current_owner_user_id()) WITH CHECK (owner_user_id = huayi_private.current_owner_user_id());
ALTER TABLE practice_generation_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE practice_generation_tasks FORCE ROW LEVEL SECURITY;
CREATE POLICY practice_generation_tasks_owner ON practice_generation_tasks USING (owner_user_id = huayi_private.current_owner_user_id()) WITH CHECK (owner_user_id = huayi_private.current_owner_user_id());
ALTER TABLE quota_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE quota_grants FORCE ROW LEVEL SECURITY;
CREATE POLICY quota_grants_owner ON quota_grants USING (owner_user_id = huayi_private.current_owner_user_id()) WITH CHECK (owner_user_id = huayi_private.current_owner_user_id());
ALTER TABLE quota_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE quota_reservations FORCE ROW LEVEL SECURITY;
CREATE POLICY quota_reservations_owner ON quota_reservations USING (owner_user_id = huayi_private.current_owner_user_id()) WITH CHECK (owner_user_id = huayi_private.current_owner_user_id());
ALTER TABLE usage_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_ledger FORCE ROW LEVEL SECURITY;
CREATE POLICY usage_ledger_owner ON usage_ledger USING (owner_user_id = huayi_private.current_owner_user_id()) WITH CHECK (owner_user_id = huayi_private.current_owner_user_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON
  user_profiles, web_sessions, account_data_export_jobs, extension_sessions, extension_pairings,
  study_captures, analysis_records,
  analysis_candidates, idempotency_records, analysis_requests, extension_query_generations,
  learning_items, source_examples, tags,
  learning_item_tags, schedule_states, word_entries, context_observations,
  external_wordbook_jobs, external_wordbook_items, practice_sessions,
  practice_session_items, practice_turns, practice_attempts, practice_generation_tasks
TO huayi_business;
GRANT SELECT ON account_sign_in_methods TO huayi_business;
GRANT SELECT ON quota_grants, quota_reservations, usage_ledger TO huayi_business;
GRANT SELECT ON model_price_versions TO huayi_business;
REVOKE ALL ON password_recovery_flows, security_notification_outbox
  FROM PUBLIC, huayi_business;
REVOKE ALL ON learning_duplicate_suggestion_requests FROM PUBLIC, huayi_business;

COMMIT;
