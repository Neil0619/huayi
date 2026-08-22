import {
  studyCaptureCreateResponseSchema,
  studyCaptureDeleteResponseSchema,
  studyCaptureDetailResponseSchema,
  normalizeWhitespaceAndQuotes,
  studyCapturePatchResponseSchema,
} from "@huayi/cloud-contracts";

import type { AnalysisDatabase, AnalysisQuery } from "./analysis-database.js";
import { CloudFault } from "./cloud-fault.js";
import type { StudyCaptureRepository } from "./study-capture-module.js";

interface CaptureRow {
  capture_count: number;
  created_at: Date;
  first_captured_at: Date;
  id: string;
  last_captured_at: Date;
  normalized_text_hash: string;
  revision: number;
  selection_kind: "passage" | "phrase" | "sentence";
  source_text: string;
  status: "analyzed" | "analyzing" | "pending";
  title: string | null;
  updated_at: Date;
  user_context: string | null;
}

interface DetailRow extends CaptureRow {
  active_analysis_request_id: string | null;
  latest_analysis_created_at: Date | null;
  latest_analysis_id: string | null;
  latest_analysis_review_state: "pendingReview" | "reviewed" | null;
  latest_analysis_revision: number | null;
}

const detailSelect = `SELECT captures.*,
  latest.id::text AS latest_analysis_id,latest.created_at AS latest_analysis_created_at,
  latest.review_state AS latest_analysis_review_state,latest.revision AS latest_analysis_revision,
  active_request.id::text AS active_analysis_request_id
  FROM study_captures captures LEFT JOIN LATERAL (
    SELECT id,created_at,review_state,revision FROM analysis_records
    WHERE study_capture_id=captures.id ORDER BY created_at DESC,id DESC LIMIT 1
  ) latest ON true LEFT JOIN LATERAL (
    SELECT id FROM analysis_requests WHERE study_capture_id=captures.id AND state='running'
    ORDER BY created_at DESC,id DESC LIMIT 1
  ) active_request ON true`;

function capture(row: CaptureRow) {
  return {
    captureCount: row.capture_count,
    createdAt: row.created_at.toISOString(),
    firstCapturedAt: row.first_captured_at.toISOString(),
    id: row.id,
    kind: row.selection_kind,
    lastCapturedAt: row.last_captured_at.toISOString(),
    normalizedTextHash: row.normalized_text_hash,
    revision: row.revision,
    sourceText: row.source_text,
    status: row.status,
    ...(row.title === null ? {} : { title: row.title }),
    updatedAt: row.updated_at.toISOString(),
    ...(row.user_context === null ? {} : { userContext: row.user_context }),
  };
}

function detail(row: DetailRow) {
  return studyCaptureDetailResponseSchema.parse({
    activeAnalysisRequest:
      row.active_analysis_request_id === null
        ? null
        : { requestId: row.active_analysis_request_id, state: "running" },
    capture: capture(row),
    latestAnalysis:
      row.latest_analysis_id === null ||
      row.latest_analysis_created_at === null ||
      row.latest_analysis_review_state === null ||
      row.latest_analysis_revision === null
        ? null
        : {
            createdAt: row.latest_analysis_created_at.toISOString(),
            id: row.latest_analysis_id,
            reviewState: row.latest_analysis_review_state,
            revision: row.latest_analysis_revision,
          },
  });
}

function escapeLike(value: string) {
  return value
    .toLocaleLowerCase()
    .replaceAll("\\", "\\\\")
    .replaceAll("%", "\\%")
    .replaceAll("_", "\\_");
}

async function save(
  tenant: AnalysisQuery,
  command: {
    idempotencyKey: string;
    now: string;
    ownerUserId: string;
    requestHash: string;
  },
  response: unknown,
  operation = "study-capture.create",
) {
  await tenant.rows(
    `INSERT INTO idempotency_records(owner_user_id,operation,key,request_hash,response,expires_at)
      VALUES($1,$2,$3,$4,$5::jsonb,$6::timestamptz)`,
    [
      command.ownerUserId,
      operation,
      command.idempotencyKey,
      command.requestHash,
      JSON.stringify(response),
      new Date(Date.parse(command.now) + 7 * 24 * 60 * 60 * 1_000).toISOString(),
    ],
  );
}

function translate(error: unknown): never {
  if (error instanceof CloudFault) throw error;
  if (error instanceof Error && error.message.includes("idempotency conflict")) {
    throw new CloudFault("idempotency_conflict", "The idempotency key is already in use.");
  }
  throw error;
}

export function createPostgresStudyCapture(
  database: AnalysisDatabase,
  options: { id(): string } = { id: () => crypto.randomUUID() },
): StudyCaptureRepository {
  return {
    async create(command) {
      try {
        return await database.transaction(command.ownerUserId, async ({ tenant, trusted }) => {
          const replay = await trusted.rows<{ response: unknown }>(
            "SELECT begin_idempotent_write($1,'study-capture.create',$2,$3) AS response",
            [command.ownerUserId, command.idempotencyKey, command.requestHash],
          );
          if (replay[0]?.response !== null && replay[0]?.response !== undefined) {
            return studyCaptureCreateResponseSchema.parse(replay[0].response);
          }
          const inserted = await tenant.rows<CaptureRow>(
            `INSERT INTO study_captures(
              id,owner_user_id,selection_kind,source_text,normalized_text_hash,
              first_captured_at,last_captured_at,created_at,updated_at
            ) VALUES($1,$2,$3,$4,$5,$6,$6,$6,$6)
            ON CONFLICT(owner_user_id,selection_kind,normalized_text_hash) DO NOTHING
            RETURNING *`,
            [
              options.id(),
              command.ownerUserId,
              command.request.kind,
              command.request.sourceText,
              command.normalizedTextHash,
              command.now,
            ],
          );
          let row = inserted[0];
          let outcome: "created" | "existing" | "linked-analysis" = "created";
          if (row === undefined) {
            const existing = await tenant.rows<CaptureRow>(
              `SELECT * FROM study_captures
                WHERE selection_kind=$1 AND normalized_text_hash=$2 FOR UPDATE`,
              [command.request.kind, command.normalizedTextHash],
            );
            row = existing[0];
            if (
              row === undefined ||
              normalizeWhitespaceAndQuotes(row.source_text) !== command.normalizedSourceText
            ) {
              throw new CloudFault(
                "capture_hash_collision",
                "StudyCapture identity is unavailable.",
              );
            }
            const linked = await tenant.rows<{ linked: boolean }>(
              "SELECT EXISTS(SELECT 1 FROM analysis_records WHERE study_capture_id=$1) AS linked",
              [row.id],
            );
            const updated = await tenant.rows<CaptureRow>(
              `UPDATE study_captures SET last_captured_at=$2,capture_count=capture_count+1,
                revision=revision+1,updated_at=$2 WHERE id=$1 RETURNING *`,
              [row.id, command.now],
            );
            row = updated[0];
            outcome = linked[0]?.linked === true ? "linked-analysis" : "existing";
          } else {
            const manual = await tenant.rows<{ id: string; source_text: string }>(
              `SELECT id::text,source_text FROM analysis_records
               WHERE source_type='manual' AND study_capture_id IS NULL
                 AND selection_kind=$1 AND source_normalized_hash=$2
               ORDER BY created_at DESC,id DESC LIMIT 1 FOR UPDATE`,
              [command.request.kind, command.normalizedTextHash],
            );
            const match = manual[0];
            if (
              match !== undefined &&
              normalizeWhitespaceAndQuotes(match.source_text) === command.normalizedSourceText
            ) {
              await tenant.rows("UPDATE analysis_records SET study_capture_id=$1 WHERE id=$2", [
                row.id,
                match.id,
              ]);
              const analyzed = await tenant.rows<CaptureRow>(
                "UPDATE study_captures SET status='analyzed' WHERE id=$1 RETURNING *",
                [row.id],
              );
              row = analyzed[0];
              outcome = "linked-analysis";
            }
          }
          if (row === undefined) throw new CloudFault("invalid_request", "Capture was not saved.");
          const response = studyCaptureCreateResponseSchema.parse({
            capture: capture(row),
            outcome,
            ...(outcome === "created"
              ? { undo: { captureId: row.id, expectedRevision: row.revision } }
              : {}),
          });
          await save(tenant, command, response);
          return response;
        });
      } catch (error) {
        return translate(error);
      }
    },
    async delete(command) {
      try {
        return await database.transaction(command.ownerUserId, async ({ tenant, trusted }) => {
          const replay = await trusted.rows<{ response: unknown }>(
            "SELECT begin_idempotent_write($1,'study-capture.delete',$2,$3) AS response",
            [command.ownerUserId, command.idempotencyKey, command.requestHash],
          );
          if (replay[0]?.response !== null && replay[0]?.response !== undefined) {
            return studyCaptureDeleteResponseSchema.parse(replay[0].response);
          }
          const rows = await tenant.rows<{ revision: number; status: string }>(
            "SELECT revision,status FROM study_captures WHERE id=$1 FOR UPDATE",
            [command.captureId],
          );
          const current = rows[0];
          if (current === undefined) throw new CloudFault("not_found", "StudyCapture not found.");
          if (current.revision !== command.expectedRevision || current.status !== "pending") {
            throw new CloudFault("study_capture_in_use", "StudyCapture can no longer be deleted.");
          }
          const linked = await tenant.rows<{ linked: boolean }>(
            "SELECT EXISTS(SELECT 1 FROM analysis_records WHERE study_capture_id=$1) AS linked",
            [command.captureId],
          );
          if (linked[0]?.linked === true) {
            throw new CloudFault("study_capture_in_use", "StudyCapture can no longer be deleted.");
          }
          const response = studyCaptureDeleteResponseSchema.parse({
            deleted: true,
            id: command.captureId,
          });
          await tenant.rows("DELETE FROM study_captures WHERE id=$1", [command.captureId]);
          await save(tenant, command, response, "study-capture.delete");
          return response;
        });
      } catch (error) {
        return translate(error);
      }
    },
    async find(ownerUserId, captureId) {
      const rows = await database.transaction(ownerUserId, ({ tenant }) =>
        tenant.rows<DetailRow>(`${detailSelect} WHERE captures.id=$1`, [captureId]),
      );
      return rows[0] === undefined ? null : detail(rows[0]);
    },
    async list(ownerUserId, query) {
      const rows = await database.transaction(ownerUserId, ({ tenant }) =>
        tenant.rows<DetailRow>(
          `${detailSelect} WHERE captures.status=$1
           AND ($2::text IS NULL OR captures.selection_kind=$2)
           AND ($3::text IS NULL OR lower(captures.source_text COLLATE "C") LIKE $3 ESCAPE '\\'
             OR lower(COALESCE(captures.title,'') COLLATE "C") LIKE $3 ESCAPE '\\'
             OR lower(COALESCE(captures.user_context,'') COLLATE "C") LIKE $3 ESCAPE '\\')
           AND ($4::timestamptz IS NULL OR (captures.updated_at,captures.id)<($4::timestamptz,$5::uuid))
           ORDER BY captures.updated_at DESC,captures.id DESC LIMIT $6`,
          [
            query.status,
            query.kind ?? null,
            query.query === undefined ? null : `%${escapeLike(query.query)}%`,
            query.boundary?.updatedAt ?? null,
            query.boundary?.id ?? null,
            query.limit + 1,
          ],
        ),
      );
      return {
        hasMore: rows.length > query.limit,
        items: rows.slice(0, query.limit).map(detail),
      };
    },
    async patch(command) {
      try {
        return await database.transaction(command.ownerUserId, async ({ tenant, trusted }) => {
          const replay = await trusted.rows<{ response: unknown }>(
            "SELECT begin_idempotent_write($1,'study-capture.patch',$2,$3) AS response",
            [command.ownerUserId, command.idempotencyKey, command.requestHash],
          );
          if (replay[0]?.response !== null && replay[0]?.response !== undefined) {
            return studyCapturePatchResponseSchema.parse(replay[0].response);
          }
          const current = await tenant.rows<CaptureRow>(
            "SELECT * FROM study_captures WHERE id=$1 FOR UPDATE",
            [command.captureId],
          );
          const row = current[0];
          if (row === undefined) throw new CloudFault("not_found", "StudyCapture not found.");
          if (row.revision !== command.input.expectedRevision) {
            throw new CloudFault("revision_conflict", "StudyCapture revision changed.");
          }
          if (row.status !== "pending") {
            throw new CloudFault("study_capture_in_use", "StudyCapture is already being analyzed.");
          }
          if (command.input.kind !== undefined && command.input.kind !== row.selection_kind) {
            const duplicate = await tenant.rows<{ id: string }>(
              `SELECT id::text FROM study_captures WHERE selection_kind=$1
               AND normalized_text_hash=$2 AND id<>$3 LIMIT 1`,
              [command.input.kind, row.normalized_text_hash, command.captureId],
            );
            if (duplicate[0] !== undefined) {
              throw new CloudFault("exact_duplicate", "An exact StudyCapture already exists.");
            }
          }
          await tenant.rows(
            `UPDATE study_captures SET selection_kind=COALESCE($2,selection_kind),
             title=CASE WHEN $3 THEN $4 ELSE title END,
             user_context=CASE WHEN $5 THEN $6 ELSE user_context END,
             revision=revision+1,updated_at=$7 WHERE id=$1`,
            [
              command.captureId,
              command.input.kind ?? null,
              command.input.title !== undefined,
              command.input.title ?? null,
              command.input.userContext !== undefined,
              command.input.userContext ?? null,
              command.now,
            ],
          );
          const updated = await tenant.rows<DetailRow>(`${detailSelect} WHERE captures.id=$1`, [
            command.captureId,
          ]);
          if (updated[0] === undefined) throw new Error("StudyCapture update disappeared.");
          const response = detail(updated[0]);
          await save(tenant, command, response, "study-capture.patch");
          return response;
        });
      } catch (error) {
        return translate(error);
      }
    },
  };
}
