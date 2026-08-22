DROP FUNCTION exchange_extension_pairing(uuid, text, text, uuid, text, timestamptz);

CREATE FUNCTION exchange_extension_pairing(
  pairing_id uuid,
  presented_state_hash text,
  presented_pkce_challenge text,
  new_session_id uuid,
  new_token_hash text,
  session_expires_at timestamptz
) RETURNS TABLE(
  id uuid,
  extension_query_model_mode text,
  study_capture_mode text,
  cloud_word_copy_mode text,
  preferences_revision integer,
  preferences_updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  approved public.extension_pairings%ROWTYPE;
  profile_snapshot public.user_profiles%ROWTYPE;
BEGIN
  UPDATE public.extension_pairings AS pairings
  SET status = 'consumed'
  WHERE pairings.id = pairing_id
    AND pairings.status = 'approved'
    AND pairings.expires_at > now()
    AND pairings.state_hash = presented_state_hash
    AND pairings.pkce_challenge = presented_pkce_challenge
  RETURNING pairings.* INTO approved;
  IF approved.id IS NULL THEN RETURN; END IF;
  SELECT * INTO profile_snapshot FROM public.user_profiles
  WHERE user_id=approved.user_id AND owner_user_id=approved.owner_user_id AND status='active'
  FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'profile unavailable'; END IF;
  INSERT INTO public.extension_sessions (
    id, user_id, owner_user_id, install_id_hash, token_hash, device_label, expires_at
  ) VALUES (
    new_session_id, approved.user_id, approved.owner_user_id, approved.install_id_hash,
    new_token_hash, approved.device_label, session_expires_at
  );
  RETURN QUERY SELECT new_session_id, profile_snapshot.extension_query_model_mode,
    profile_snapshot.study_capture_mode, profile_snapshot.cloud_word_copy_mode,
    profile_snapshot.preferences_revision, profile_snapshot.updated_at;
END;
$$;

REVOKE ALL ON FUNCTION exchange_extension_pairing(uuid, text, text, uuid, text, timestamptz)
  FROM PUBLIC, huayi_business;
GRANT EXECUTE ON FUNCTION exchange_extension_pairing(uuid, text, text, uuid, text, timestamptz)
  TO huayi_context_setter;
