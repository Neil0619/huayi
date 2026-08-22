CREATE OR REPLACE FUNCTION huayi_private.analysis_public_record(record_id uuid)
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
  FROM public.analysis_records records
  WHERE records.id=record_id
    AND records.owner_user_id=huayi_private.current_owner_user_id();
$$;

REVOKE ALL ON FUNCTION huayi_private.analysis_public_record(uuid) FROM PUBLIC, huayi_business;
GRANT EXECUTE ON FUNCTION huayi_private.analysis_public_record(uuid) TO huayi_context_setter;
