import {
  analysisRecordSchema,
  confirmCandidatesResponseSchema,
  learningItemResponseSchema,
} from "@huayi/cloud-contracts";

import type { AnalysisDatabase, AnalysisQuery } from "./analysis-database.js";
import { CloudFault } from "./cloud-fault.js";
import type { ConfirmCandidatesCommand } from "./analysis-ports.js";

interface AnalysisRow {
  archived_at: Date | null;
  created_at: Date;
  id: string;
  model_metadata: unknown;
  result: unknown;
  review_state: "pendingReview" | "reviewed";
  revision: number;
  selection_kind: "passage" | "phrase" | "sentence" | "word";
  source_context: string | null;
  source_normalized_hash: string;
  source_text: string;
  source_title: string | null;
  source_type: "manual" | "study-capture";
  study_capture_id: string | null;
  updated_at: Date;
}

export async function confirmPostgresCandidates(
  database: AnalysisDatabase,
  command: ConfirmCandidatesCommand,
) {
  try {
    return await database.transaction(command.userId, async ({ tenant, trusted }) => {
      const replay = await trusted.rows<{ response: unknown }>(
        "SELECT begin_idempotent_write($1,'analysis.confirm',$2,$3) AS response",
        [command.userId, command.idempotencyKey, command.requestHash],
      );
      if (replay[0]?.response != null) {
        return confirmCandidatesResponseSchema.parse(replay[0].response);
      }
      const rows = await tenant.rows<AnalysisRow>(
        `SELECT id::text,review_state,archived_at,source_type,source_title,source_context,
         source_text,source_normalized_hash,study_capture_id::text,selection_kind,result,
         model_metadata,revision,created_at,updated_at
         FROM analysis_records WHERE id=$1 FOR UPDATE`,
        [command.analysisId],
      );
      const row = rows[0];
      if (row === undefined) throw new CloudFault("not_found", "Analysis not found.");
      if (row.revision !== command.expectedRevision || row.review_state !== "pendingReview") {
        throw new CloudFault("revision_conflict", "The analysis revision has changed.");
      }
      const candidates = await tenant.rows<{ candidate_type: string; id: string }>(
        "SELECT id::text,candidate_type FROM analysis_candidates WHERE analysis_id=$1",
        [command.analysisId],
      );
      const candidateTypes = new Map(
        candidates.map((candidate) => [candidate.id, candidate.candidate_type]),
      );
      const results = [];
      for (const entry of command.entries) {
        if (candidateTypes.get(entry.candidateId) !== entry.type) {
          throw new CloudFault("invalid_request", "A selected candidate is invalid.");
        }
        const item = await confirmLearningItem(tenant, command, entry);
        results.push({
          action: entry.action,
          candidateId: entry.candidateId,
          item,
          type: "learning-item",
        });
      }
      await tenant.rows(
        "UPDATE analysis_records SET review_state='reviewed',revision=revision+1,updated_at=$2 WHERE id=$1",
        [command.analysisId, command.updatedAt],
      );
      const analysis = analysisRecordSchema.parse({
        archivedAt: row.archived_at?.toISOString() ?? null,
        candidates: await candidateResources(tenant, command.analysisId),
        createdAt: row.created_at.toISOString(),
        id: row.id,
        modelMetadata: row.model_metadata,
        result: row.result,
        reviewState: "reviewed",
        revision: row.revision + 1,
        selectionKind: row.selection_kind,
        source: {
          ...(row.source_title === null ? {} : { title: row.source_title }),
          type: row.source_type,
          ...(row.source_context === null ? {} : { userContext: row.source_context }),
        },
        sourceNormalizedHash: row.source_normalized_hash,
        sourceText: row.source_text,
        ...(row.study_capture_id === null ? {} : { studyCaptureId: row.study_capture_id }),
        updatedAt: command.updatedAt,
      });
      const response = confirmCandidatesResponseSchema.parse({ analysis, results });
      await tenant.rows(
        `INSERT INTO idempotency_records(owner_user_id,operation,key,request_hash,response,expires_at)
         VALUES($1,'analysis.confirm',$2,$3,$4::jsonb,$5)`,
        [
          command.userId,
          command.idempotencyKey,
          command.requestHash,
          JSON.stringify(response),
          new Date(Date.parse(command.updatedAt) + 7 * 24 * 60 * 60 * 1_000),
        ],
      );
      return response;
    });
  } catch (error) {
    if (error instanceof CloudFault) throw error;
    const message = error instanceof Error ? error.message : "";
    if (message.includes("idempotency conflict"))
      throw new CloudFault("idempotency_conflict", "The idempotency key was reused.");
    if (
      message.includes("word_entries_owner_user_id_canonical_key_key") ||
      message.includes("learning_items_owner_user_id_type_canonical_key_key")
    ) {
      throw new CloudFault("exact_duplicate", "An exact learning target already exists.");
    }
    throw error;
  }
}

async function confirmLearningItem(
  tenant: AnalysisQuery,
  command: ConfirmCandidatesCommand,
  entry: ConfirmCandidatesCommand["entries"][number],
) {
  const exact = await tenant.rows<{ id: string }>(
    `SELECT id::text FROM learning_items
      WHERE type=$1 AND canonical_key=$2 AND deleted_at IS NULL`,
    [entry.type, entry.canonicalKey],
  );
  if (entry.action === "created" && exact.length > 0)
    throw new CloudFault("exact_duplicate", "An exact learning item already exists.");
  if (entry.action === "created") {
    await tenant.rows(
      `INSERT INTO learning_items(id,owner_user_id,type,canonical_key,content,system_attributes,
       created_at,updated_at) VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,$7)`,
      [
        entry.targetId,
        command.userId,
        entry.type,
        entry.canonicalKey,
        JSON.stringify(entry.content),
        JSON.stringify(entry.systemAttributes),
        command.updatedAt,
      ],
    );
    await tenant.rows(
      "INSERT INTO schedule_states(learning_item_id,owner_user_id,level,due_at,created_at,updated_at) VALUES($1,$2,-1,NULL,$3,$3)",
      [entry.targetId, command.userId, command.updatedAt],
    );
  } else {
    const targets = await tenant.rows<{
      canonical_key: string;
      system_attributes: string[];
      type: string;
    }>(
      "SELECT type,canonical_key,system_attributes FROM learning_items WHERE id=$1 AND deleted_at IS NULL FOR UPDATE",
      [entry.targetId],
    );
    const target = targets[0];
    if (target?.type !== entry.type || target.canonical_key !== entry.canonicalKey)
      throw new CloudFault("invalid_request", "The learning item merge target is invalid.");
    await tenant.rows(
      `UPDATE learning_items SET system_attributes=$2::jsonb,revision=revision+1,updated_at=$3
       WHERE id=$1`,
      [
        entry.targetId,
        JSON.stringify([...new Set([...target.system_attributes, ...entry.systemAttributes])]),
        command.updatedAt,
      ],
    );
  }
  await tenant.rows(
    `INSERT INTO source_examples(id,owner_user_id,learning_item_id,analysis_id,analysis_unit_id,
     source_text,translation_zh,source_type,source_title,created_at,updated_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10)`,
    [
      entry.sourceExampleId,
      command.userId,
      entry.targetId,
      entry.source.analysisId,
      entry.source.analysisUnitId,
      entry.source.sourceText,
      entry.source.translationZh ?? null,
      entry.source.sourceType,
      entry.source.sourceTitle ?? null,
      command.updatedAt,
    ],
  );
  for (const tag of entry.tags) {
    await tenant.rows(
      `INSERT INTO tags(id,owner_user_id,normalized_name,display_name,created_at,updated_at)
       VALUES($1,$2,$3,$4,$5,$5) ON CONFLICT(owner_user_id,normalized_name) DO NOTHING`,
      [tag.id, command.userId, tag.normalizedName, tag.displayName, command.updatedAt],
    );
    await tenant.rows(
      `INSERT INTO learning_item_tags(learning_item_id,tag_id,owner_user_id)
       SELECT $1,id,$2 FROM tags WHERE normalized_name=$3 ON CONFLICT DO NOTHING`,
      [entry.targetId, command.userId, tag.normalizedName],
    );
  }
  return loadLearningItem(tenant, entry.targetId);
}

async function candidateResources(tenant: AnalysisQuery, analysisId: string) {
  const rows = await tenant.rows<{
    candidate_type: string;
    id: string;
    ordinal: number;
    payload: unknown;
    analysis_unit_id: string;
  }>(
    `SELECT id::text,candidate_type,payload,analysis_unit_id,ordinal FROM analysis_candidates
     WHERE analysis_id=$1 ORDER BY ordinal`,
    [analysisId],
  );
  return rows.map((row) => ({
    id: row.id,
    ordinal: row.ordinal,
    payload: row.payload,
    analysisUnitId: row.analysis_unit_id,
    type: row.candidate_type,
  }));
}

async function loadLearningItem(tenant: AnalysisQuery, id: string) {
  const rows = await tenant.rows<{
    canonical_key: string;
    content: unknown;
    created_at: Date;
    revision: number;
    system_attributes: string[];
    type: string;
    updated_at: Date;
  }>(
    "SELECT type,canonical_key,content,system_attributes,revision,created_at,updated_at FROM learning_items WHERE id=$1 AND deleted_at IS NULL",
    [id],
  );
  const row = rows[0];
  if (row === undefined) throw new CloudFault("invalid_request", "The learning target is invalid.");
  const sources = await tenant.rows<{
    analysis_id: string | null;
    id: string;
    analysis_unit_id: string | null;
    source_text: string;
    source_title: string | null;
    source_type: string;
    translation_zh: string | null;
  }>(
    `SELECT id::text,analysis_id::text,analysis_unit_id,source_text,source_title,source_type,translation_zh
     FROM source_examples WHERE learning_item_id=$1 ORDER BY created_at,id`,
    [id],
  );
  const tags = await tenant.rows<{ display_name: string }>(
    `SELECT tags.display_name FROM tags JOIN
    learning_item_tags links ON links.tag_id=tags.id WHERE links.learning_item_id=$1 ORDER BY tags.created_at,tags.id`,
    [id],
  );
  return learningItemResponseSchema.parse({
    canonicalKey: row.canonical_key,
    content: row.content,
    createdAt: row.created_at.toISOString(),
    id,
    revision: row.revision,
    sourceExamples: sources.map((source) => ({
      ...(source.analysis_id === null ? {} : { analysisId: source.analysis_id }),
      id: source.id,
      ...(source.analysis_unit_id === null ? {} : { analysisUnitId: source.analysis_unit_id }),
      sourceText: source.source_text,
      ...(source.source_title === null ? {} : { sourceTitle: source.source_title }),
      sourceType: source.source_type,
      ...(source.translation_zh === null ? {} : { translationZh: source.translation_zh }),
    })),
    systemAttributes: row.system_attributes,
    tags: tags.map((tag) => tag.display_name),
    type: row.type,
    updatedAt: row.updated_at.toISOString(),
  });
}
