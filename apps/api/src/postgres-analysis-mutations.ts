import type { AnalysisDatabase } from "./analysis-database.js";
import { CloudFault } from "./cloud-fault.js";
import type { AnalysisHistoryMutation } from "./analysis-ports.js";

export async function deletePostgresAnalysis(
  database: AnalysisDatabase,
  command: AnalysisHistoryMutation,
): Promise<unknown> {
  const updatedAt = new Date(command.updatedAt);
  try {
    const rows = await database.trusted((query) =>
      query.rows<{ result: unknown }>(
        "SELECT delete_analysis_record($1,$2,$3,$4,$5,$6,$7,$8)::jsonb AS result",
        [
          command.userId,
          command.idempotencyKey,
          command.requestHash,
          command.id,
          command.expectedRevision,
          command.deleteStudyCapture ?? false,
          updatedAt,
          new Date(updatedAt.getTime() + 7 * 24 * 60 * 60 * 1_000),
        ],
      ),
    );
    return rows[0]?.result;
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("analysis capture relationship conflict")) {
      throw new CloudFault("study_capture_in_use", "The StudyCapture relationship changed.");
    }
    return translateMutationError(error);
  }
}

export async function mutatePostgresAnalysis(
  database: AnalysisDatabase,
  operation: string,
  command: AnalysisHistoryMutation,
): Promise<unknown> {
  try {
    const updatedAt = new Date(command.updatedAt);
    const rows = await database.trusted((query) =>
      query.rows<{ result: unknown }>(
        "SELECT mutate_analysis_record($1,$2,$3,$4,$5,$6,$7,$8)::jsonb AS result",
        [
          command.userId,
          operation,
          command.idempotencyKey,
          command.requestHash,
          command.id,
          command.expectedRevision,
          updatedAt,
          new Date(updatedAt.getTime() + 7 * 24 * 60 * 60 * 1_000),
        ],
      ),
    );
    return rows[0]?.result;
  } catch (error) {
    return translateMutationError(error);
  }
}

function translateMutationError(error: unknown): never {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("idempotency conflict")) {
    throw new CloudFault("idempotency_conflict", "The idempotency key was reused.");
  }
  if (message.includes("revision conflict")) {
    throw new CloudFault("revision_conflict", "The analysis revision has changed.");
  }
  if (message.includes("analysis not found")) {
    throw new CloudFault("not_found", "Analysis not found.");
  }
  throw error;
}
