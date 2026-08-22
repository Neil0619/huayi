import { analysisRecordSchema, contractFixtures } from "@huayi/cloud-contracts";

interface TestDatabase {
  query<Row>(text: string, parameters?: unknown[]): Promise<{ rows: Row[] }>;
}

export const accountDataExportAnalysisId = "50000000-0000-4000-8000-000000000001";
const candidateId = "51000000-0000-4000-8000-000000000001";
const captureId = "30000000-0000-4000-8000-000000000001";

export async function insertAccountDataExportAnalysisFixture(
  database: TestDatabase,
  ownerUserId: string,
): Promise<void> {
  const analysis = analysisRecordSchema.parse({
    ...contractFixtures.analysis,
    candidates: [{ ...contractFixtures.analysis.candidates[0], id: candidateId }],
    id: accountDataExportAnalysisId,
    result: {
      ...contractFixtures.analysis.result,
      sentences: [
        {
          ...contractFixtures.analysis.result.sentences[0],
          candidateIds: [candidateId],
        },
      ],
    },
    source: { title: "Writing notes", type: "study-capture" },
    studyCaptureId: captureId,
  });
  await database.query(
    `INSERT INTO analysis_records(
      id,owner_user_id,study_capture_id,review_state,archived_at,source_type,source_title,
      source_context,source_text,source_normalized_hash,selection_kind,result,model_metadata,
      revision,created_at,updated_at
    ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb,$14,$15,$16)`,
    [
      analysis.id,
      ownerUserId,
      analysis.studyCaptureId,
      analysis.reviewState,
      analysis.archivedAt,
      analysis.source.type,
      analysis.source.title ?? null,
      analysis.source.userContext ?? null,
      analysis.sourceText,
      analysis.sourceNormalizedHash,
      analysis.selectionKind,
      JSON.stringify(analysis.result),
      JSON.stringify(analysis.modelMetadata),
      analysis.revision,
      analysis.createdAt,
      analysis.updatedAt,
    ],
  );
  for (const candidate of analysis.candidates) {
    await database.query(
      `INSERT INTO analysis_candidates(
        id,analysis_id,owner_user_id,candidate_type,payload,analysis_unit_id,ordinal
      ) VALUES($1,$2,$3,$4,$5::jsonb,$6,$7)`,
      [
        candidate.id,
        analysis.id,
        ownerUserId,
        candidate.type,
        JSON.stringify(candidate.payload),
        candidate.analysisUnitId,
        candidate.ordinal,
      ],
    );
  }
}
